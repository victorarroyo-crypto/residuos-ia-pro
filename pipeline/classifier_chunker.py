"""
CLASIFICADOR Y CHUNKER SEMÁNTICO
=================================
- Clasificador: determina el tipo de documento (AAI, contrato, factura...)
  usando un LLM con las primeras páginas + señales del nombre de archivo.

- Chunker semántico: fragmenta el documento de forma inteligente según su tipo.
  No hace chunking ciego por tokens — entiende la estructura del documento.

  Estrategias por tipo:
    AAI      → por sección (Condiciones, Límites, Obligaciones, LERs autorizados)
    Contrato → por cláusula
    Factura  → por línea de servicio / concepto
    Registro → por entrada del libro de registro
    DARI     → por apartado del formulario
"""

import logging
import re
from anthropic import AsyncAnthropic

from .pdf_pipeline import (
    DocType, DocumentChunk, PageContent, PDFNature, PipelineConfig
)

logger = logging.getLogger(__name__)

# Tokens por chunk según tipo de documento
CHUNK_CONFIG = {
    DocType.AAI:        {"size": 800,  "overlap": 200},  # secciones largas
    DocType.CONTRATO:   {"size": 600,  "overlap": 150},  # cláusulas medianas
    DocType.FACTURA:    {"size": 300,  "overlap": 50},   # líneas cortas
    DocType.REGISTRO:   {"size": 400,  "overlap": 100},
    DocType.DARI:       {"size": 500,  "overlap": 100},
    DocType.NORMATIVA:  {"size": 1000, "overlap": 250},  # artículos largos
    DocType.DESCONOCIDO:{"size": 600,  "overlap": 150},
}

# Señales en nombre de archivo
FILENAME_SIGNALS = {
    DocType.AAI:      ["aai", "autorizacion_ambiental", "ippc", "aia", "permiso_ambiental"],
    DocType.DARI:     ["dari", "declaracion_anual", "memoria_anual"],
    DocType.CONTRATO: ["contrato", "acuerdo", "convenio", "servicio"],
    DocType.FACTURA:  ["factura", "fra", "invoice", "alb"],
    DocType.REGISTRO: ["libro_registro", "registro_residuos", "control_residuos"],
    DocType.NORMATIVA:[
        "ley", "decreto", "orden", "boe", "dogc", "bopv",
        "bref", "directiva", "reglamento", "normativa",
        "real_decreto", "uwwtd", "nca", "bat_", "mtd",
    ],
}

# Señales en contenido de texto
CONTENT_SIGNALS = {
    DocType.AAI: [
        "autorización ambiental integrada", "ippc", "mejores técnicas disponibles",
        "condiciones de la autorización", "ler autorizados", "límites de emisión",
        "código ler", "operaciones autorizadas",
    ],
    DocType.DARI: [
        "declaración anual de residuos", "dari", "productor de residuos",
        "gestión de residuos industriales", "cantidad producida",
    ],
    DocType.CONTRATO: [
        "contrato de prestación", "el gestor se compromete", "cláusula",
        "precio por tonelada", "condiciones generales", "penalización",
        "contraprestación económica",
    ],
    DocType.FACTURA: [
        "factura", "importe total", "base imponible", "iva", "nif",
        "número de factura", "fecha de emisión", "concepto",
    ],
    DocType.REGISTRO: [
        "libro registro", "fecha de entrega", "cantidad entregada",
        "gestor autorizado", "documento de aceptación", "e-dasri",
    ],
    DocType.NORMATIVA: [
        "mejores técnicas disponibles", "best available techniques",
        "bref", "bat conclusions", "bat-ael",
        "directiva", "directive", "reglamento", "regulation",
        "diario oficial", "official journal",
        "artículo", "considerando", "transposición",
        "estado miembro", "member state",
        "valores límite de emisión", "emission limit values",
    ],
}


class DocumentClassifier:
    """
    Clasifica el tipo de documento usando señales rápidas primero,
    y LLM como fallback para casos ambiguos.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.claude = AsyncAnthropic(api_key=config.anthropic_api_key)

    async def classify(
        self, pages: list[PageContent], filename: str
    ) -> DocType:
        # 1. Señales de nombre de archivo (rápido, sin LLM)
        filename_lower = filename.lower().replace(" ", "_")
        for doc_type, signals in FILENAME_SIGNALS.items():
            if any(s in filename_lower for s in signals):
                logger.info(f"Clasificado por nombre de archivo: {doc_type}")
                return doc_type

        # 2. Señales de contenido en primeras 3 páginas (sin LLM)
        sample_text = " ".join(
            p.text.lower() for p in pages[:3]
        )
        scores = {dt: 0 for dt in DocType}
        for doc_type, signals in CONTENT_SIGNALS.items():
            for signal in signals:
                if signal in sample_text:
                    scores[doc_type] += 1

        best_type = max(scores, key=scores.get)
        if scores[best_type] >= 2:
            logger.info(f"Clasificado por señales de contenido: {best_type} (score={scores[best_type]})")
            return best_type

        # 3. Fallback: LLM con las primeras 2 páginas
        logger.info("Clasificación ambigua, usando LLM...")
        return await self._classify_with_llm(pages[:2], filename)

    async def _classify_with_llm(
        self, pages: list[PageContent], filename: str
    ) -> DocType:
        """Usa Claude para clasificar documentos ambiguos."""
        text_sample = "\n".join(p.text[:3000] for p in pages[:3])
        valid_types = [dt.value for dt in DocType if dt != DocType.DESCONOCIDO]

        prompt = f"""Eres un experto en gestión de residuos industriales en España.
Clasifica este documento en UNO de estos tipos:
{chr(10).join(f"- {t}" for t in valid_types)}

Guía de clasificación:
- normativa: BREFs (Best Available Techniques Reference Documents), Directivas EU, \
Reglamentos EU, Leyes, Decretos, Órdenes ministeriales, cualquier texto legislativo o regulatorio.
- factura: Facturas de pago con importes, IVA, NIF. NO clasificar como factura si no tiene importes económicos.
- autorizacion_ambiental_integrada: AAIs, permisos IPPC con condiciones y LERs autorizados.
- contrato_gestor: Contratos de servicios de gestión de residuos con cláusulas.
- declaracion_anual_residuos: DARIs, memorias anuales de producción de residuos.

Nombre del archivo: {filename}
Primeras páginas del documento:
---
{text_sample[:6000]}
---

Responde ÚNICAMENTE con el tipo exacto de la lista, sin explicación."""

        response = await self.claude.messages.create(
            model="claude-haiku-4-5-20251001",  # modelo rápido para clasificación
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}],
        )

        result = response.content[0].text.strip().lower()
        for dt in DocType:
            if dt.value in result:
                return dt

        return DocType.DESCONOCIDO


class SemanticChunker:
    """
    Chunking inteligente que respeta la estructura del documento.
    
    En lugar de cortar cada N tokens ciegamente, detecta secciones
    naturales del documento (artículos, cláusulas, entradas del registro)
    y las usa como unidades de chunking.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config

    async def chunk(
        self,
        pages: list[PageContent],
        doc_type: DocType,
        doc_id: str,
    ) -> list[DocumentChunk]:
        """Selecciona estrategia de chunking según tipo de documento."""

        strategy_map = {
            DocType.AAI:      self._chunk_by_section,
            DocType.CONTRATO: self._chunk_by_clause,
            DocType.FACTURA:  self._chunk_by_line_item,
            DocType.REGISTRO: self._chunk_by_entry,
            DocType.DARI:     self._chunk_by_section,
            DocType.NORMATIVA:self._chunk_by_article,
        }

        strategy = strategy_map.get(doc_type, self._chunk_sliding_window)
        chunks = await strategy(pages, doc_id, doc_type)

        # Siempre añadir chunks de tablas por separado (son más valiosas)
        table_chunks = self._chunk_tables(pages, doc_id, doc_type, len(chunks))
        chunks.extend(table_chunks)

        logger.info(f"Chunking {doc_type}: {len(chunks)} chunks ({len(table_chunks)} de tablas)")
        return chunks

    async def _chunk_by_section(
        self, pages: list[PageContent], doc_id: str, doc_type: DocType
    ) -> list[DocumentChunk]:
        """
        Para AAIs y DARIs: detecta secciones por patrones de cabecera típicos.
        Las AAIs tienen estructura: CAPÍTULO X, Condición X.X, Apartado...
        """
        config = CHUNK_CONFIG[doc_type]
        full_text = "\n".join(p.text for p in pages)

        # Patrones de sección en documentos administrativos españoles
        section_patterns = [
            r"(?:^|\n)(CAPÍTULO\s+\w+[^\n]+)",
            r"(?:^|\n)(CONDICIÓN\s+\d+[^\n]+)",
            r"(?:^|\n)(APARTADO\s+\w+[^\n]+)",
            r"(?:^|\n)(\d+\.\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{5,50})",
            r"(?:^|\n)(Artículo\s+\d+[^\n]+)",
        ]

        splits = self._split_by_patterns(full_text, section_patterns)
        return self._build_chunks(splits, pages, doc_id, doc_type, config)

    async def _chunk_by_clause(
        self, pages: list[PageContent], doc_id: str, doc_type: DocType
    ) -> list[DocumentChunk]:
        """Para contratos: divide por cláusulas."""
        config = CHUNK_CONFIG[doc_type]
        full_text = "\n".join(p.text for p in pages)

        clause_patterns = [
            r"(?:^|\n)(CLÁUSULA\s+\w+[^\n]*)",
            r"(?:^|\n)(Cláusula\s+\d+[^\n]*)",
            r"(?:^|\n)(\d+[°ª]?\s*[-–]\s*[A-ZÁÉÍÓÚÑ][^\n]{5,50})",
            r"(?:^|\n)(ESTIPULACIÓN\s+\w+[^\n]*)",
        ]

        splits = self._split_by_patterns(full_text, clause_patterns)
        return self._build_chunks(splits, pages, doc_id, doc_type, config)

    async def _chunk_by_line_item(
        self, pages: list[PageContent], doc_id: str, doc_type: DocType
    ) -> list[DocumentChunk]:
        """
        Para facturas: cada línea de servicio es un chunk.
        Incluye contexto del emisor y receptor en cada chunk (crítico para RAG).
        """
        config = CHUNK_CONFIG[doc_type]
        full_text = "\n".join(p.text for p in pages)

        # Extraer cabecera de la factura (emisor, receptor, fecha, número)
        header_match = re.search(
            r"(.{0,500}(?:FECHA|fecha|Fecha).{0,200}(?:TOTAL|Total|total))",
            full_text, re.DOTALL
        )
        header_context = header_match.group(0)[:400] if header_match else ""

        # Líneas de concepto
        line_patterns = [r"(?:^|\n)(\d+\s+Gestión|Recogida|Tratamiento|Transporte[^\n]+)"]
        splits = self._split_by_patterns(full_text, line_patterns)

        chunks = []
        for i, split in enumerate(splits):
            # Prefixar cada chunk con contexto de la factura
            content = f"[Factura] {header_context}\n---\n{split}" if header_context else split
            chunk_id = f"{doc_id}_chunk_{i:04d}"
            chunks.append(DocumentChunk(
                chunk_id=chunk_id,
                doc_id=doc_id,
                content=content,
                chunk_index=i,
                page_start=1,
                page_end=len(pages),
                chunk_type="linea_factura",
                metadata={"doc_type": doc_type.value},
            ))

        return chunks if chunks else await self._chunk_sliding_window(pages, doc_id, doc_type)

    async def _chunk_by_entry(
        self, pages: list[PageContent], doc_id: str, doc_type: DocType
    ) -> list[DocumentChunk]:
        """Para registros de producción: cada entrada del libro es un chunk."""
        config = CHUNK_CONFIG[doc_type]
        full_text = "\n".join(p.text for p in pages)

        entry_patterns = [
            r"(?:^|\n)(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[^\n]+)",  # por fecha
            r"(?:^|\n)(Entrada\s+\d+[^\n]*)",
        ]

        splits = self._split_by_patterns(full_text, entry_patterns)
        return self._build_chunks(splits, pages, doc_id, doc_type, config)

    async def _chunk_by_article(
        self, pages: list[PageContent], doc_id: str, doc_type: DocType
    ) -> list[DocumentChunk]:
        """Para normativa: divide por artículos o headers Markdown."""
        config = CHUNK_CONFIG[doc_type]
        full_text = "\n".join(p.text for p in pages)

        article_patterns = [
            r"(?:^|\n)(Artículo\s+\d+[^\n]*)",
            r"(?:^|\n)(ARTÍCULO\s+\d+[^\n]*)",
            r"(?:^|\n)(Art\.\s+\d+[^\n]*)",
        ]

        splits = self._split_by_patterns(full_text, article_patterns)

        # Si no hay artículos (ej: Markdown), intentar con headers Markdown
        if len(splits) <= 1:
            md_patterns = [
                r"(?:^|\n)(#{1,3}\s+[^\n]+)",   # # Title, ## Section, ### Sub
            ]
            md_splits = self._split_by_patterns(full_text, md_patterns)
            if len(md_splits) > 1:
                splits = md_splits

        # Si aún no hay splits útiles, fallback a ventana deslizante
        if len(splits) <= 1:
            return await self._chunk_sliding_window(pages, doc_id, doc_type)

        return self._build_chunks(splits, pages, doc_id, doc_type, config)

    async def _chunk_sliding_window(
        self, pages: list[PageContent], doc_id: str, doc_type: DocType
    ) -> list[DocumentChunk]:
        """Fallback: ventana deslizante por tokens para documentos no estructurados."""
        config = CHUNK_CONFIG.get(doc_type, CHUNK_CONFIG[DocType.DESCONOCIDO])
        full_text = "\n".join(p.text for p in pages)
        words = full_text.split()
        size = config["size"]
        overlap = config["overlap"]

        chunks = []
        i = 0
        chunk_index = 0
        while i < len(words):
            chunk_words = words[i:i + size]
            content = " ".join(chunk_words)
            if content.strip():
                chunks.append(DocumentChunk(
                    chunk_id=f"{doc_id}_chunk_{chunk_index:04d}",
                    doc_id=doc_id,
                    content=content,
                    chunk_index=chunk_index,
                    page_start=1,
                    page_end=len(pages),
                    chunk_type="texto",
                    metadata={"doc_type": doc_type.value},
                ))
                chunk_index += 1
            i += size - overlap

        return chunks

    def _chunk_tables(
        self,
        pages: list[PageContent],
        doc_id: str,
        doc_type: DocType,
        start_index: int,
    ) -> list[DocumentChunk]:
        """
        Convierte tablas extraídas en chunks textuales estructurados.
        Las tablas de AAIs (lista de LERs autorizados) son críticas para el RAG.
        """
        table_chunks = []
        chunk_index = start_index

        for page in pages:
            for table in page.tables:
                headers = table.get("headers", [])
                rows = table.get("rows", [])
                if not headers or not rows:
                    continue

                # Formatear tabla como markdown (mejor para el LLM)
                lines = [" | ".join(str(h) for h in headers)]
                lines.append(" | ".join("---" for _ in headers))
                for row in rows:
                    lines.append(" | ".join(str(c) for c in row))

                content = f"[TABLA - Página {page.page_num}]\n" + "\n".join(lines)

                table_chunks.append(DocumentChunk(
                    chunk_id=f"{doc_id}_table_{chunk_index:04d}",
                    doc_id=doc_id,
                    content=content,
                    chunk_index=chunk_index,
                    page_start=page.page_num,
                    page_end=page.page_num,
                    chunk_type="tabla",
                    metadata={
                        "doc_type": doc_type.value,
                        "table_headers": headers,
                        "num_rows": len(rows),
                    },
                ))
                chunk_index += 1

        return table_chunks

    def _split_by_patterns(
        self, text: str, patterns: list[str]
    ) -> list[str]:
        """Divide texto por patrones de sección, manteniendo las cabeceras."""
        combined = "|".join(patterns)
        parts = re.split(combined, text, flags=re.MULTILINE)
        return [p.strip() for p in parts if p and len(p.strip()) > 100]

    def _build_chunks(
        self,
        splits: list[str],
        pages: list[PageContent],
        doc_id: str,
        doc_type: DocType,
        config: dict,
    ) -> list[DocumentChunk]:
        """Construye objetos DocumentChunk desde splits de texto."""
        chunks = []
        for i, split in enumerate(splits):
            # Si el split es muy largo, subdividir con ventana deslizante
            words = split.split()
            if len(words) > config["size"] * 1.5:
                sub_chunks = self._subdivide(split, doc_id, doc_type, config, i * 100)
                chunks.extend(sub_chunks)
            else:
                chunks.append(DocumentChunk(
                    chunk_id=f"{doc_id}_chunk_{i:04d}",
                    doc_id=doc_id,
                    content=split,
                    chunk_index=i,
                    page_start=1,
                    page_end=len(pages),
                    chunk_type="seccion",
                    metadata={"doc_type": doc_type.value},
                ))
        return chunks

    def _subdivide(
        self, text: str, doc_id: str, doc_type: DocType, config: dict, base_index: int
    ) -> list[DocumentChunk]:
        """Subdivide un fragmento muy largo con ventana deslizante."""
        words = text.split()
        size, overlap = config["size"], config["overlap"]
        sub_chunks = []
        i = 0
        sub_index = 0
        while i < len(words):
            content = " ".join(words[i:i + size])
            if content.strip():
                sub_chunks.append(DocumentChunk(
                    chunk_id=f"{doc_id}_chunk_{base_index + sub_index:04d}",
                    doc_id=doc_id,
                    content=content,
                    chunk_index=base_index + sub_index,
                    page_start=1,
                    page_end=1,
                    chunk_type="seccion_larga",
                    metadata={"doc_type": doc_type.value},
                ))
                sub_index += 1
            i += size - overlap
        return sub_chunks
