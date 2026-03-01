"""
PROCESADOR DE EXCEL - ResidusIA Pro
=====================================
Convierte Excel/CSV con costes, inventarios y tablas de residuos
en chunks embebibles para Supabase RAG.

Casos que maneja:
  - Costes anuales por LER (una fila por residuo)
  - Facturas en Excel (multi-hoja)
  - Inventarios de residuos exportados de ERP
  - Comparativas de gestores (varios en columnas)
  - Registros de producción en formato tabla
  - Hojas múltiples con datos heterogéneos

El reto del Excel vs PDF:
  Los Excels NO son texto → hay que convertir cada hoja en
  representaciones textuales ricas que el LLM entienda en contexto.
"""

import io
import json
import logging
import math
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import openpyxl
import pandas as pd
from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)


def _sanitize_for_json(obj):
    """Convierte tipos numpy/pandas a tipos nativos Python para JSON válido."""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if hasattr(obj, 'item'):  # numpy scalar (int64, float64, etc.)
        val = obj.item()
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
            return None
        return val
    if isinstance(obj, (bytes, bytearray)):
        return obj.decode('utf-8', errors='replace')
    return obj


# ─────────────────────────────────────────────
# TIPOS DE EXCEL POR CONTENIDO
# ─────────────────────────────────────────────
class ExcelType(str, Enum):
    COSTES_ANUALES      = "costes_anuales"         # €/t por LER, año, gestor
    INVENTARIO_LER      = "inventario_ler"          # listado de residuos generados
    COMPARATIVA_GESTORES= "comparativa_gestores"    # varios gestores en columnas
    REGISTRO_PRODUCCION = "registro_produccion"     # libro registro en Excel
    FACTURAS_AGREGADAS  = "facturas_agregadas"      # resumen de facturas
    PRESUPUESTO         = "presupuesto"             # presupuesto de gestión
    DESCONOCIDO         = "desconocido"


@dataclass
class SheetAnalysis:
    sheet_name: str
    excel_type: ExcelType
    num_rows: int
    num_cols: int
    headers: list[str]
    ler_codes: list[str]          # códigos LER detectados
    date_range: Optional[str]     # "2023-01 a 2024-12"
    total_eur: Optional[float]    # si hay columna de costes
    summary_text: str             # representación textual para embedding
    structured_data: dict         # datos estructurados para Supabase
    metadata: dict = field(default_factory=dict)


@dataclass
class ProcessedExcel:
    doc_id: str
    client_id: str
    filename: str
    excel_type: ExcelType         # tipo dominante
    sheets: list[SheetAnalysis]
    chunks: list                  # DocumentChunk compatibles con el pipeline PDF
    metadata: dict
    storage_path: Optional[str] = None
    supabase_doc_id: Optional[str] = None
    warnings: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────
# PATRÓN LER
# ─────────────────────────────────────────────
LER_RE = re.compile(r"\b(\d{2}[\s\-]?\d{2}[\s\-]?\d{2}\*?)\b")


class ExcelProcessor:
    """
    Procesa archivos Excel y los convierte en chunks embebibles.
    
    Estrategia: cada hoja se convierte en una o varias representaciones
    textuales contextualizadas. Las tablas de costes se convierten en
    texto estructurado que el LLM puede razonar sobre ellas.
    """

    def __init__(self, config):
        self.config = config
        self.claude = AsyncAnthropic(api_key=config.anthropic_api_key, max_retries=4)

    async def process(
        self,
        excel_bytes: bytes,
        client_id: str,
        filename: str,
        project_id: Optional[str] = None,
        rag_scope: str = "project",   # "project" o "general"
    ) -> ProcessedExcel:
        """
        Punto de entrada. Procesa el Excel completo y genera chunks para RAG.
        """
        import hashlib
        doc_id = "xls_" + hashlib.sha256(excel_bytes + client_id.encode()).hexdigest()[:12]
        warnings = []

        # Detectar extensión
        ext = filename.lower().split(".")[-1]
        if ext == "csv":
            sheets_data = self._read_csv(excel_bytes, filename)
        else:
            sheets_data = self._read_excel(excel_bytes, filename, warnings)

        if not sheets_data:
            warnings.append("No se pudo leer ninguna hoja del archivo.")
            return ProcessedExcel(
                doc_id=doc_id, client_id=client_id, filename=filename,
                excel_type=ExcelType.DESCONOCIDO, sheets=[], chunks=[],
                metadata={}, warnings=warnings,
            )

        # Analizar cada hoja
        analyses = []
        for sheet_name, df in sheets_data.items():
            if df.empty or df.shape[0] < 2:
                continue
            analysis = await self._analyze_sheet(sheet_name, df, filename)
            analyses.append(analysis)
            logger.info(f"Hoja '{sheet_name}': {analysis.excel_type}, {len(analysis.ler_codes)} LERs")

        # Tipo dominante del archivo
        dominant_type = self._dominant_type(analyses)

        # Generar chunks para RAG
        chunks = await self._generate_chunks(analyses, doc_id, client_id, rag_scope)

        # Metadatos globales del archivo
        all_ler_codes = list(set(c for a in analyses for c in a.ler_codes))
        total_eur = sum(a.total_eur or 0 for a in analyses)

        metadata = _sanitize_for_json({
            "filename": filename,
            "excel_type": dominant_type.value,
            "rag_scope": rag_scope,
            "project_id": project_id,
            "client_id": client_id,
            "sheets": [a.sheet_name for a in analyses],
            "ler_codes_found": all_ler_codes,
            "total_eur_detected": total_eur if total_eur > 0 else None,
            "structured_data": {a.sheet_name: a.structured_data for a in analyses},
        })

        return ProcessedExcel(
            doc_id=doc_id,
            client_id=client_id,
            filename=filename,
            excel_type=dominant_type,
            sheets=analyses,
            chunks=chunks,
            metadata=metadata,
            warnings=warnings,
        )

    # ──────────────────────────────────────────────────────
    # LECTURA DEL ARCHIVO
    # ──────────────────────────────────────────────────────

    def _read_excel(
        self, excel_bytes: bytes, filename: str, warnings: list
    ) -> dict[str, pd.DataFrame]:
        """Lee todas las hojas del Excel, limpiando hojas vacías y ocultas."""
        sheets = {}
        try:
            wb = openpyxl.load_workbook(io.BytesIO(excel_bytes), data_only=True)
            visible_sheets = [s for s in wb.sheetnames if wb[s].sheet_state == "visible"]

            xl = pd.ExcelFile(io.BytesIO(excel_bytes))
            for sheet_name in visible_sheets:
                try:
                    # Detectar automáticamente la fila de cabeceras
                    df_raw = pd.read_excel(xl, sheet_name=sheet_name, header=None)
                    header_row = self._detect_header_row(df_raw)
                    df = pd.read_excel(xl, sheet_name=sheet_name, header=header_row)

                    # Limpiar: quitar columnas y filas completamente vacías
                    df = df.dropna(how="all", axis=0).dropna(how="all", axis=1)
                    df.columns = [str(c).strip() for c in df.columns]

                    if not df.empty and df.shape[0] >= 1:
                        sheets[sheet_name] = df
                except Exception as e:
                    warnings.append(f"Hoja '{sheet_name}' no procesada: {e}")
        except Exception as e:
            warnings.append(f"Error leyendo Excel: {e}")

        return sheets

    def _read_csv(self, csv_bytes: bytes, filename: str) -> dict[str, pd.DataFrame]:
        """Lee CSV detectando el separador automáticamente."""
        try:
            # Intentar separadores comunes (;, ,, \t)
            for sep in [";", ",", "\t"]:
                df = pd.read_csv(io.BytesIO(csv_bytes), sep=sep, encoding="utf-8-sig")
                if df.shape[1] > 1:
                    return {filename: df}
        except Exception as e:
            logger.debug("CSV parse fallido para %s: %s", filename, e)
        return {}

    def _detect_header_row(self, df: pd.DataFrame) -> int:
        """
        Detecta en qué fila están las cabeceras reales.
        Los Excels de costes a menudo tienen títulos y logos en las primeras filas.
        """
        for i, row in df.iterrows():
            non_null = row.dropna()
            if len(non_null) >= 3:  # al menos 3 columnas con datos
                # Si la mayoría son strings, probablemente es la cabecera
                str_count = sum(1 for v in non_null if isinstance(v, str) and len(str(v)) < 60)
                if str_count >= len(non_null) * 0.6:
                    return i
        return 0

    # ──────────────────────────────────────────────────────
    # ANÁLISIS DE HOJA
    # ──────────────────────────────────────────────────────

    async def _analyze_sheet(
        self, sheet_name: str, df: pd.DataFrame, filename: str
    ) -> SheetAnalysis:
        """Analiza una hoja y genera su representación textual."""

        headers = list(df.columns)
        excel_type = self._classify_sheet(headers, df, sheet_name, filename)

        # Extraer LERs de todo el contenido de la hoja
        full_text = df.to_string()
        ler_codes = list(set(LER_RE.findall(full_text.replace(" ", ""))))

        # Detectar rango de fechas
        date_range = self._extract_date_range(df)

        # Calcular total en euros si hay columna de costes
        total_eur = self._extract_total_eur(df)

        # Datos estructurados para Supabase
        structured_data = self._extract_structured_data(df, excel_type, ler_codes)

        # Representación textual para embedding (el más importante)
        summary_text = await self._generate_summary_text(
            df, sheet_name, excel_type, ler_codes, date_range, total_eur, filename
        )

        return SheetAnalysis(
            sheet_name=sheet_name,
            excel_type=excel_type,
            num_rows=df.shape[0],
            num_cols=df.shape[1],
            headers=headers,
            ler_codes=ler_codes,
            date_range=date_range,
            total_eur=total_eur,
            summary_text=summary_text,
            structured_data=structured_data,
        )

    def _classify_sheet(
        self, headers: list, df: pd.DataFrame, sheet_name: str, filename: str
    ) -> ExcelType:
        """Clasifica el tipo de hoja por sus cabeceras y contenido."""
        headers_lower = " ".join(str(h).lower() for h in headers)
        sheet_lower = sheet_name.lower()
        file_lower = filename.lower()

        signals = {
            ExcelType.COSTES_ANUALES: [
                "coste", "costo", "€", "eur", "precio", "importe",
                "tonelada", "total anual", "gasto",
            ],
            ExcelType.INVENTARIO_LER: [
                "ler", "residuo", "cantidad", "toneladas", "tipo", "peligroso",
                "gestor", "operacion", "operación",
            ],
            ExcelType.COMPARATIVA_GESTORES: [
                "gestor", "oferta", "comparativa", "alternativa", "proveedor",
            ],
            ExcelType.REGISTRO_PRODUCCION: [
                "fecha", "entrega", "aceptación", "aceptacion", "documento",
                "movimiento", "registro",
            ],
            ExcelType.FACTURAS_AGREGADAS: [
                "factura", "número", "numero", "emisor", "base imponible", "iva",
            ],
            ExcelType.PRESUPUESTO: [
                "presupuesto", "propuesta", "oferta", "estimado",
            ],
        }

        scores = {t: 0 for t in ExcelType}
        for excel_type, keywords in signals.items():
            for kw in keywords:
                if kw in headers_lower or kw in sheet_lower or kw in file_lower:
                    scores[excel_type] += 1

        best = max(scores, key=scores.get)
        return best if scores[best] >= 1 else ExcelType.DESCONOCIDO

    def _extract_date_range(self, df: pd.DataFrame) -> Optional[str]:
        """Detecta el rango temporal del Excel."""
        date_cols = [c for c in df.columns if any(
            kw in str(c).lower() for kw in ["fecha", "año", "year", "mes", "period"]
        )]
        if not date_cols:
            return None
        try:
            dates = pd.to_datetime(df[date_cols[0]], errors="coerce").dropna()
            if len(dates) > 0:
                return f"{dates.min().strftime('%Y-%m')} a {dates.max().strftime('%Y-%m')}"
        except Exception as e:
            logger.debug("Extraccion de rango de fechas fallida: %s", e)
        return None

    def _extract_total_eur(self, df: pd.DataFrame) -> Optional[float]:
        """Suma columnas que parecen importes en euros."""
        eur_cols = [c for c in df.columns if any(
            kw in str(c).lower() for kw in ["€", "eur", "coste", "importe", "total", "precio"]
        )]
        total = 0.0
        for col in eur_cols:
            try:
                numeric = pd.to_numeric(df[col], errors="coerce").dropna()
                total += numeric.sum()
            except Exception as e:
                logger.debug("Columna '%s' no se pudo sumar como EUR: %s", col, e)
        return total if total > 0 else None

    def _extract_structured_data(
        self, df: pd.DataFrame, excel_type: ExcelType, ler_codes: list
    ) -> dict:
        """Extrae datos tabulares en formato estructurado para Supabase."""
        data = {"rows": _sanitize_for_json(df.fillna("").to_dict(orient="records"))}

        if excel_type == ExcelType.COSTES_ANUALES:
            # Intentar mapear columnas estándar
            col_map = self._map_columns(df.columns, {
                "codigo_ler": ["ler", "código ler", "codigo"],
                "descripcion": ["descripcion", "descripción", "residuo", "tipo"],
                "cantidad_ton": ["toneladas", "cantidad", "ton", "kg"],
                "precio_eur_ton": ["€/t", "eur/t", "precio", "€/ton"],
                "importe_eur": ["importe", "coste", "total", "€"],
                "gestor": ["gestor", "empresa", "proveedor"],
                "año": ["año", "year", "ejercicio"],
            })
            data["column_mapping"] = col_map

            # Extraer filas de costes limpias
            cost_rows = []
            for _, row in df.iterrows():
                clean_row = {}
                for field_name, col_name in col_map.items():
                    if col_name and col_name in df.columns:
                        clean_row[field_name] = row.get(col_name)
                if clean_row.get("codigo_ler") or clean_row.get("importe_eur"):
                    cost_rows.append(clean_row)
            data["cost_rows"] = cost_rows

        return data

    def _map_columns(
        self, columns: list, mapping: dict[str, list[str]]
    ) -> dict[str, Optional[str]]:
        """Mapea columnas reales a nombres estándar por similitud."""
        result = {}
        cols_lower = {str(c).lower(): str(c) for c in columns}

        for field_name, candidates in mapping.items():
            found = None
            for candidate in candidates:
                for col_lower, col_real in cols_lower.items():
                    if candidate in col_lower:
                        found = col_real
                        break
                if found:
                    break
            result[field_name] = found
        return result

    async def _generate_summary_text(
        self,
        df: pd.DataFrame,
        sheet_name: str,
        excel_type: ExcelType,
        ler_codes: list,
        date_range: Optional[str],
        total_eur: Optional[float],
        filename: str,
    ) -> str:
        """
        Genera la representación textual de la hoja para embedding.
        
        Esta es la clave: no embedimos el Excel crudo (que el LLM no entiende)
        sino una descripción contextualizada que incluye:
        - Qué contiene la hoja
        - Los datos en formato tabla markdown
        - Un resumen en lenguaje natural generado por Claude
        """

        # Limitar a primeras 50 filas para el prompt (evitar tokens excesivos)
        df_sample = df.head(50)

        # Cabecera contextual
        context_header = f"""[EXCEL - {filename} | Hoja: {sheet_name}]
Tipo: {excel_type.value}
{f"Período: {date_range}" if date_range else ""}
{f"Total costes detectados: {total_eur:,.2f}€" if total_eur else ""}
{f"Códigos LER: {', '.join(ler_codes)}" if ler_codes else ""}
Filas de datos: {df.shape[0]} | Columnas: {df.shape[1]}

"""
        # Tabla en markdown
        try:
            table_md = df_sample.fillna("").to_markdown(index=False)
        except Exception as e:
            logger.debug("to_markdown fallido, usando to_string: %s", e)
            table_md = df_sample.fillna("").to_string(index=False)

        # Para tablas de costes, añadir resumen LLM (muy valioso para el RAG)
        if excel_type in (ExcelType.COSTES_ANUALES, ExcelType.INVENTARIO_LER, ExcelType.COMPARATIVA_GESTORES):
            llm_summary = await self._llm_summarize(df_sample, sheet_name, excel_type, filename)
            return context_header + table_md + "\n\n---\nRESUMEN:\n" + llm_summary
        else:
            return context_header + table_md

    async def _llm_summarize(
        self,
        df: pd.DataFrame,
        sheet_name: str,
        excel_type: ExcelType,
        filename: str,
    ) -> str:
        """
        Claude genera un resumen en lenguaje natural de los datos.
        Esto hace que el RAG pueda responder preguntas como:
        "¿Cuánto pagó este cliente por gestión de residuos peligrosos en 2023?"
        """
        table_str = df.fillna("").to_string()

        prompt = f"""Eres un experto en gestión de residuos industriales.
Analiza esta tabla de datos de gestión de residuos y genera un resumen conciso
en español que capture los datos más relevantes para un consultor ambiental.

Archivo: {filename} | Hoja: {sheet_name} | Tipo: {excel_type.value}

DATOS:
{table_str[:3000]}

Genera un párrafo de 3-5 frases que resuma:
- Qué residuos aparecen (códigos LER si los hay)
- Los costes o cantidades principales
- Cualquier anomalía o dato destacable
- El período temporal si está disponible

Sé preciso con los números. No inventes datos que no estén en la tabla."""

        try:
            response = await self.claude.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text.strip()
        except Exception as e:
            logger.warning(f"Error generando resumen LLM: {e}")
            return ""

    # ──────────────────────────────────────────────────────
    # GENERACIÓN DE CHUNKS
    # ──────────────────────────────────────────────────────

    async def _generate_chunks(
        self,
        analyses: list[SheetAnalysis],
        doc_id: str,
        client_id: str,
        rag_scope: str,
    ) -> list:
        """
        Genera chunks desde las hojas analizadas.
        Cada hoja genera 1-N chunks según su tamaño.
        """
        from .pdf_pipeline import DocumentChunk

        chunks = []
        chunk_index = 0

        for analysis in analyses:
            # Para hojas pequeñas: un solo chunk con todo
            if analysis.num_rows <= 100:
                chunks.append(DocumentChunk(
                    chunk_id=f"{doc_id}_sheet_{chunk_index:04d}",
                    doc_id=doc_id,
                    content=analysis.summary_text,
                    chunk_index=chunk_index,
                    page_start=1,
                    page_end=1,
                    chunk_type="excel_sheet",
                    metadata={
                        "sheet_name": analysis.sheet_name,
                        "excel_type": analysis.excel_type.value,
                        "ler_codes": analysis.ler_codes,
                        "total_eur": analysis.total_eur,
                        "date_range": analysis.date_range,
                        "rag_scope": rag_scope,
                        "client_id": client_id,
                    },
                ))
                chunk_index += 1

            else:
                # Para hojas grandes: dividir en bloques de 50 filas
                # pero siempre incluir el contexto de cabecera en cada chunk
                header_context = f"[EXCEL - {analysis.sheet_name} | {analysis.excel_type.value}]\n"
                if analysis.ler_codes:
                    header_context += f"LERs: {', '.join(analysis.ler_codes)}\n"

                # Simulamos el df desde structured_data
                rows = analysis.structured_data.get("rows", [])
                block_size = 50

                for i in range(0, len(rows), block_size):
                    block = rows[i:i + block_size]
                    block_df = pd.DataFrame(block)
                    try:
                        block_text = block_df.fillna("").to_markdown(index=False)
                    except Exception as e:
                        logger.debug("Block to_markdown fallido: %s", e)
                        block_text = block_df.fillna("").to_string(index=False)

                    content = header_context + f"[Filas {i+1}-{i+len(block)}]\n" + block_text

                    chunks.append(DocumentChunk(
                        chunk_id=f"{doc_id}_sheet_{chunk_index:04d}",
                        doc_id=doc_id,
                        content=content,
                        chunk_index=chunk_index,
                        page_start=1,
                        page_end=1,
                        chunk_type="excel_sheet_block",
                        metadata={
                            "sheet_name": analysis.sheet_name,
                            "excel_type": analysis.excel_type.value,
                            "ler_codes": analysis.ler_codes,
                            "block_rows": f"{i+1}-{i+len(block)}",
                            "rag_scope": rag_scope,
                            "client_id": client_id,
                        },
                    ))
                    chunk_index += 1

        logger.info(f"Excel: {len(chunks)} chunks generados desde {len(analyses)} hojas")
        return chunks

    def _dominant_type(self, analyses: list[SheetAnalysis]) -> ExcelType:
        if not analyses:
            return ExcelType.DESCONOCIDO
        types = [a.excel_type for a in analyses if a.excel_type != ExcelType.DESCONOCIDO]
        if not types:
            return ExcelType.DESCONOCIDO
        return max(set(types), key=types.count)
