"""
EXTRACTOR DE CONTENIDO
======================
Detecta la naturaleza del PDF y extrae texto + tablas de forma robusta.

Estrategia por naturaleza:
  DIGITAL  → pdfplumber (texto + tablas perfectas)
  SCANNED  → pdf2image + Tesseract OCR (español)
  HYBRID   → página a página, método óptimo para cada una
  ENCRYPTED → pikepdf para desencriptar primero
"""

import io
import logging
from typing import Optional

import fitz as pymupdf  # PyMuPDF — fallback para PDFs que pdfminer no parsea
import pikepdf
import pdfplumber
import pdf2image
import pytesseract
from PIL import Image, ImageFilter, ImageEnhance

from .pdf_pipeline import ContentExtractor, PageContent, PDFNature, PipelineConfig

logger = logging.getLogger(__name__)

# Umbral de texto mínimo para considerar una página "digital"
MIN_CHARS_DIGITAL = 50
# Confianza mínima de OCR para considerar resultado válido
MIN_OCR_CONFIDENCE = 0.6


class PDFNatureDetector:
    """Determina si un PDF es digital, escaneado, híbrido o encriptado."""

    async def detect(self, pdf_bytes: bytes) -> PDFNature:
        try:
            # Intentar abrir — si falla, está encriptado
            with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
                if pdf.is_encrypted:
                    return PDFNature.ENCRYPTED
        except pikepdf.PasswordError:
            return PDFNature.ENCRYPTED
        except Exception as e:
            logger.warning(f"Error detectando naturaleza: {e}")

        # Muestrear páginas distribuidas (inicio, medio, final) para
        # detectar naturaleza con precisión — evita falsos SCANNED cuando
        # solo la portada/índice carecen de texto extraíble.
        digital_pages = 0
        scanned_pages = 0

        try:
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                n = len(pdf.pages)
                if n <= 10:
                    sample_indices = list(range(n))
                else:
                    # 3 del inicio, 2 del medio, 2 del final
                    mid = n // 2
                    sample_indices = sorted(set([
                        0, 1, 2,
                        mid - 1, mid,
                        n - 2, n - 1,
                    ]))
                for idx in sample_indices:
                    text = pdf.pages[idx].extract_text() or ""
                    if len(text.strip()) >= MIN_CHARS_DIGITAL:
                        digital_pages += 1
                    else:
                        scanned_pages += 1
                logger.info(
                    f"Nature detection: {n} pages, sampled {len(sample_indices)} "
                    f"(digital={digital_pages}, scanned={scanned_pages})"
                )
        except Exception:
            return PDFNature.SCANNED

        # Fallback PyMuPDF: si pdfplumber no extrajo texto de ninguna página,
        # intentar con PyMuPDF (MuPDF) que soporta más codificaciones de fonts.
        # Esto evita clasificar erróneamente como SCANNED PDFs digitales que
        # usan CMap/Type3 fonts que pdfminer no puede decodificar.
        if digital_pages == 0 and scanned_pages > 0:
            try:
                doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
                fitz_digital = 0
                for idx in sample_indices:
                    text = doc[idx].get_text() or ""
                    if len(text.strip()) >= MIN_CHARS_DIGITAL:
                        fitz_digital += 1
                doc.close()
                if fitz_digital > 0:
                    logger.info(
                        f"Nature detection PyMuPDF fallback: "
                        f"{fitz_digital}/{len(sample_indices)} pages have text"
                    )
                    digital_pages = fitz_digital
                    scanned_pages = len(sample_indices) - fitz_digital
            except Exception as e:
                logger.warning(f"PyMuPDF fallback detection failed: {e}")

        total = digital_pages + scanned_pages
        if total == 0:
            return PDFNature.SCANNED
        if scanned_pages == 0:
            return PDFNature.DIGITAL
        if digital_pages == 0:
            return PDFNature.SCANNED
        return PDFNature.HYBRID


class ContentExtractorImpl(ContentExtractor):
    """
    Extrae texto y tablas de cualquier tipo de PDF.
    Aplica OCR automáticamente cuando es necesario.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        # Configuración Tesseract para documentos administrativos españoles
        self.tesseract_config = (
            "--oem 3 --psm 6 "           # modo automático, bloque de texto
            "-l spa+eng "                 # español + inglés (códigos LER en inglés a veces)
            "--dpi 300"
        )

    async def detect(self, pdf_bytes: bytes) -> PDFNature:
        return await PDFNatureDetector().detect(pdf_bytes)

    async def decrypt(self, pdf_bytes: bytes, password: str) -> bytes:
        """Desencripta PDF con contraseña proporcionada."""
        try:
            with pikepdf.open(io.BytesIO(pdf_bytes), password=password) as pdf:
                output = io.BytesIO()
                pdf.save(output)
                logger.info("PDF desencriptado correctamente")
                return output.getvalue()
        except pikepdf.PasswordError:
            raise ValueError("Contraseña incorrecta para este PDF")

    async def try_unlock(self, pdf_bytes: bytes) -> tuple[bytes, bool]:
        """
        Intenta desencriptar sin contraseña.
        Algunos PDFs tienen permisos de impresión/copia restringidos
        pero no contraseña real — pikepdf los abre igualmente.
        """
        try:
            with pikepdf.open(io.BytesIO(pdf_bytes), suppress_warnings=True) as pdf:
                output = io.BytesIO()
                pdf.save(output)
                return output.getvalue(), True
        except pikepdf.PasswordError:
            return pdf_bytes, False

    async def extract(
        self, pdf_bytes: bytes, nature: PDFNature
    ) -> tuple[list[PageContent], bool, float]:
        """
        Extrae contenido completo del PDF.
        Retorna: (páginas, ocr_aplicado, confianza_promedio_ocr)
        """
        if nature == PDFNature.DIGITAL:
            pages = await self._extract_digital(pdf_bytes)
            return pages, False, 1.0

        elif nature == PDFNature.SCANNED:
            pages, confidence = await self._extract_scanned(pdf_bytes)
            return pages, True, confidence

        elif nature == PDFNature.HYBRID:
            pages, ocr_conf = await self._extract_hybrid(pdf_bytes)
            ocr_used = any(p.nature == PDFNature.SCANNED for p in pages)
            return pages, ocr_used, ocr_conf

        else:
            raise ValueError(f"No se puede extraer PDF con naturaleza: {nature}")

    async def _extract_digital(self, pdf_bytes: bytes) -> list[PageContent]:
        """Extrae texto y tablas de PDF digital con pdfplumber, fallback PyMuPDF."""
        pages = []
        fitz_doc = None
        fitz_fallback_count = 0

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for i, page in enumerate(pdf.pages):
                text = page.extract_text(x_tolerance=3, y_tolerance=3) or ""

                # Fallback PyMuPDF si pdfplumber no extrajo texto suficiente
                if len(text.strip()) < MIN_CHARS_DIGITAL:
                    if fitz_doc is None:
                        fitz_doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
                    fitz_text = fitz_doc[i].get_text() or ""
                    if len(fitz_text.strip()) >= MIN_CHARS_DIGITAL:
                        text = fitz_text
                        fitz_fallback_count += 1

                # Extracción de tablas con configuración optimizada para docs administrativos
                tables = self._extract_tables_from_page(page)

                pages.append(PageContent(
                    page_num=i + 1,
                    text=text,
                    tables=tables,
                    images=[],
                    nature=PDFNature.DIGITAL,
                    confidence=1.0,
                ))

        if fitz_doc is not None:
            fitz_doc.close()
        if fitz_fallback_count > 0:
            logger.info(
                f"Digital extraction: PyMuPDF fallback used for "
                f"{fitz_fallback_count}/{len(pages)} pages"
            )
        return pages

    async def _extract_scanned(
        self, pdf_bytes: bytes
    ) -> tuple[list[PageContent], float]:
        """Convierte páginas a imagen y aplica OCR (página a página para evitar OOM)."""
        # Contar páginas sin cargar imágenes
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            total_pages = len(pdf.pages)

        pages_to_process = total_pages
        logger.info(f"Scanned PDF: processing all {total_pages} pages (page-by-page OCR)")

        pages = []
        confidences = []

        for i in range(pages_to_process):
            page_num = i + 1
            try:
                images = pdf2image.convert_from_bytes(
                    pdf_bytes, dpi=300, fmt="PNG",
                    first_page=page_num, last_page=page_num,
                    thread_count=2,
                )
                if not images:
                    continue

                img_processed = self._preprocess_for_ocr(images[0])
                ocr_data = pytesseract.image_to_data(
                    img_processed,
                    config=self.tesseract_config,
                    output_type=pytesseract.Output.DICT,
                )

                text_parts = []
                conf_values = []
                for j, word in enumerate(ocr_data["text"]):
                    conf = int(ocr_data["conf"][j])
                    if conf > 0 and word.strip():
                        text_parts.append(word)
                        conf_values.append(conf)

                text = " ".join(text_parts)
                avg_conf = (sum(conf_values) / len(conf_values) / 100) if conf_values else 0.0
                confidences.append(avg_conf)

                if avg_conf < MIN_OCR_CONFIDENCE:
                    logger.warning(
                        f"Página {page_num}: confianza OCR baja ({avg_conf:.2f}). "
                        "El documento puede estar muy deteriorado."
                    )

                pages.append(PageContent(
                    page_num=page_num,
                    text=text,
                    tables=[],
                    images=[],
                    nature=PDFNature.SCANNED,
                    confidence=avg_conf,
                ))

                del images, img_processed
            except Exception as e:
                logger.warning(f"OCR failed for page {page_num}: {e}")
                continue

        global_confidence = sum(confidences) / len(confidences) if confidences else 0.0
        return pages, global_confidence

    async def _extract_hybrid(
        self, pdf_bytes: bytes
    ) -> tuple[list[PageContent], float]:
        """Procesa cada página con el método óptimo."""
        pages_digital = await self._extract_digital(pdf_bytes)
        scanned_indices = [
            i for i, p in enumerate(pages_digital)
            if len(p.text.strip()) < MIN_CHARS_DIGITAL
        ]

        if not scanned_indices:
            return pages_digital, 1.0

        logger.info(
            f"Hybrid PDF: {len(scanned_indices)} scanned pages to OCR "
            f"out of {len(pages_digital)} total (page-by-page)"
        )

        # OCR página a página (evita cargar todas las imágenes en RAM)
        ocr_confidences = []
        for idx in scanned_indices:
            page_num = idx + 1  # pdf2image usa 1-based
            try:
                images = pdf2image.convert_from_bytes(
                    pdf_bytes, dpi=300, fmt="PNG",
                    first_page=page_num, last_page=page_num,
                    thread_count=2,
                )
                if not images:
                    continue

                img_processed = self._preprocess_for_ocr(images[0])
                ocr_data = pytesseract.image_to_data(
                    img_processed,
                    config=self.tesseract_config,
                    output_type=pytesseract.Output.DICT,
                )
                text_parts, conf_values = [], []
                for j, word in enumerate(ocr_data["text"]):
                    conf = int(ocr_data["conf"][j])
                    if conf > 0 and word.strip():
                        text_parts.append(word)
                        conf_values.append(conf)

                pages_digital[idx].text = " ".join(text_parts)
                pages_digital[idx].nature = PDFNature.SCANNED
                avg_conf = (sum(conf_values) / len(conf_values) / 100) if conf_values else 0.0
                pages_digital[idx].confidence = avg_conf
                ocr_confidences.append(avg_conf)

                # Liberar memoria
                del images, img_processed
            except Exception as e:
                logger.warning(f"OCR failed for page {page_num}: {e}")
                continue

        avg_ocr = sum(ocr_confidences) / len(ocr_confidences) if ocr_confidences else 1.0
        return pages_digital, avg_ocr

    def _preprocess_for_ocr(self, img: Image.Image) -> Image.Image:
        """
        Preprocesamiento de imagen para mejorar calidad del OCR.
        Especialmente útil para documentos administrativos escaneados con baja calidad.
        """
        # Convertir a escala de grises
        img = img.convert("L")

        # Aumentar contraste (documentos viejos o de baja calidad)
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(2.0)

        # Nitidez
        img = img.filter(ImageFilter.SHARPEN)

        # Binarización adaptativa (mejor que umbral fijo para iluminación no uniforme)
        # Threshold simple — para docs muy degradados usar opencv
        threshold = 128
        img = img.point(lambda x: 255 if x > threshold else 0, "1")

        return img

    def _extract_tables_from_page(self, page) -> list[dict]:
        """
        Extrae tablas de una página con configuración optimizada
        para documentos administrativos españoles (AAIs, contratos).
        """
        tables = []
        try:
            # Configuración para tablas con bordes explícitos (docs oficiales)
            table_settings = {
                "vertical_strategy": "lines",
                "horizontal_strategy": "lines",
                "snap_tolerance": 3,
                "join_tolerance": 3,
                "edge_min_length": 10,
            }
            raw_tables = page.extract_tables(table_settings)

            for t in raw_tables:
                if not t:
                    continue
                # Limpiar celdas vacías y normalizar
                cleaned = []
                for row in t:
                    cleaned_row = [
                        (cell.strip() if cell else "") for cell in row
                    ]
                    if any(cleaned_row):  # ignorar filas completamente vacías
                        cleaned.append(cleaned_row)

                if len(cleaned) > 1:  # al menos cabecera + 1 fila
                    tables.append({
                        "headers": cleaned[0],
                        "rows": cleaned[1:],
                        "raw": t,
                    })
        except Exception as e:
            logger.warning(f"Error extrayendo tablas: {e}")

        return tables
