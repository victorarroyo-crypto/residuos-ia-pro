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
from typing import Optional

from anthropic import AsyncAnthropic

from .pdf_pipeline import (
    DocType, DocumentChunk, PageContent, PDFNature, PipelineConfig
)

logger = logging.getLogger(__name__)

# Tokens por chunk según tipo de documento
CHUNK_CONFIG = {
    DocType.AAI:           {"size": 800,  "overlap": 200},  # secciones largas
    DocType.CONTRATO:      {"size": 600,  "overlap": 150},  # cláusulas medianas
    DocType.FACTURA:       {"size": 300,  "overlap": 50},   # líneas cortas
    DocType.REGISTRO:      {"size": 400,  "overlap": 100},
    DocType.DARI:          {"size": 500,  "overlap": 100},
    DocType.NORMATIVA:     {"size": 1000, "overlap": 250},  # artículos largos
    DocType.ANALISIS:      {"size": 500,  "overlap": 100},  # resultados + interpretación
    DocType.CERTIFICACION: {"size": 600,  "overlap": 150},  # secciones certificado
    DocType.RFQ:           {"size": 400,  "overlap": 80},   # especificaciones cortas
    DocType.FDS:           {"size": 600,  "overlap": 150},  # secciones SDS 1-16
    DocType.INFORME:       {"size": 700,  "overlap": 180},  # secciones técnicas
    DocType.PLAN_GESTION:  {"size": 700,  "overlap": 180},  # capítulos plan
    DocType.DESCONOCIDO:   {"size": 600,  "overlap": 150},
}

# Señales en nombre de archivo
FILENAME_SIGNALS = {
    DocType.AAI:      ["aai", "autorizacion_ambiental", "ippc", "aia", "permiso_ambiental"],
    DocType.DARI:     ["dari", "declaracion_anual", "memoria_anual"],
    DocType.CONTRATO: ["contrato", "acuerdo", "convenio", "servicio"],
    DocType.FACTURA:  ["factura", "fra", "invoice", "alb"],
    DocType.REGISTRO: ["libro_registro", "registro_residuos", "control_residuos"],
    DocType.NORMATIVA:[
        "ley", "decreto", "dl_", "orden", "boe", "dogc", "bopv",
        "bref", "directiva", "reglamento", "normativa",
        "real_decreto", "uwwtd", "nca", "bat_", "mtd",
        "pemar", "pniec", "plan_nacional", "plan_estatal",
        "estrategia", "circular_economy", "economia_circular",
    ],
    DocType.ANALISIS: [
        "analisis", "análisis", "caracterizacion", "laboratorio",
        "ensayo", "lixiviado", "cromatografia", "icp", "toxicidad",
    ],
    DocType.CERTIFICACION: [
        "certificado", "certificacion", "certificación", "homologacion",
        "end_of_waste", "fin_residuo", "no_peligrosidad",
    ],
    DocType.RFQ: [
        "rfq", "cotizacion", "cotización", "solicitud_oferta", "peticion_oferta",
        "petición_oferta", "presupuesto_gestor", "request_for_quotation",
    ],
    DocType.FDS: [
        "fds", "sds", "msds", "ficha_seguridad", "ficha_datos_seguridad",
        "safety_data", "hoja_seguridad",
    ],
    DocType.INFORME: [
        "informe", "auditoria", "auditoría", "diagnostico", "diagnóstico",
        "estudio", "dictamen", "peritaje", "ficha",
    ],
    DocType.PLAN_GESTION: [
        "plan_gestion", "plan_gestión", "plan_minimizacion", "plan_minimización",
        "plan_prevencion", "plan_prevención", "pgr", "estudio_minimizacion",
    ],
}

# ── Señales para documentos de proyecto (flujo completo) ──
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
    DocType.ANALISIS: [
        "informe de análisis", "resultados analíticos", "ensayo de laboratorio",
        "concentración", "mg/kg", "mg/l", "ppm", "lixiviado",
        "método de ensayo", "límite de detección", "muestra",
        "cromatografía", "icp", "espectrometría", "ph", "conductividad",
        "parámetro", "valor límite", "test de lixiviación",
    ],
    DocType.CERTIFICACION: [
        "certificado de gestión", "certificado de tratamiento",
        "certificado de valorización", "certificado de eliminación",
        "fin de condición de residuo", "end of waste",
        "declaración de no peligrosidad", "certificado de destrucción",
        "se certifica que", "hace constar",
    ],
    DocType.RFQ: [
        "solicitud de cotización", "solicitud de oferta",
        "petición de oferta", "request for quotation",
        "condiciones de servicio solicitadas", "frecuencia de recogida",
        "volumen estimado", "precio por tonelada solicitado",
        "descripción del residuo a gestionar",
    ],
    DocType.FDS: [
        "ficha de datos de seguridad", "safety data sheet",
        "sección 1", "sección 2", "sección 3",
        "identificación de la sustancia", "identificación de peligros",
        "composición", "primeros auxilios", "medidas de lucha contra incendios",
        "pictograma", "h-statement", "p-statement", "ghs", "clp",
        "palabra de advertencia", "indicaciones de peligro",
    ],
    DocType.INFORME: [
        "informe técnico", "informe de auditoría", "informe de diagnóstico",
        "estudio de minimización", "conclusiones y recomendaciones",
        "alcance del estudio", "metodología", "hallazgos",
        "plan de acción", "mejora continua",
    ],
    DocType.PLAN_GESTION: [
        "plan de gestión de residuos", "plan de minimización",
        "plan de prevención", "estudio de minimización",
        "objetivos de reducción", "medidas de prevención",
        "indicadores de seguimiento", "plan director",
        "jerarquía de residuos", "economía circular",
    ],
}

# ── Señales para Knowledge Base (RAG General, sin proyecto) ──
# Flujo separado: sin LLM, default NORMATIVA.
# Orden: FDS antes de INFORME para que "ficha_seguridad" no matchee "ficha".
KB_FILENAME_SIGNALS = {
    DocType.FDS: [
        "fds", "sds", "msds", "ficha_seguridad", "ficha_datos_seguridad",
        "safety_data", "hoja_seguridad",
    ],
    DocType.ANALISIS: [
        "analisis", "análisis", "caracterizacion", "laboratorio",
        "ensayo", "lixiviado", "cromatografia", "icp", "toxicidad",
    ],
    DocType.CERTIFICACION: [
        "certificado", "certificacion", "certificación", "homologacion",
        "end_of_waste", "fin_residuo", "no_peligrosidad",
    ],
    DocType.PLAN_GESTION: [
        "plan_gestion", "plan_gestión", "plan_minimizacion", "plan_minimización",
        "plan_prevencion", "plan_prevención", "pgr", "estudio_minimizacion",
        "plan_director", "pircan", "girapec", "perpa",
    ],
    DocType.NORMATIVA: [
        "ley", "decreto", "dl_", "orden", "boe", "dogc", "bopv",
        "bref", "directiva", "reglamento", "normativa",
        "real_decreto", "uwwtd", "nca", "bat_", "mtd",
        "pemar", "pniec", "plan_nacional", "plan_estatal",
        "estrategia", "circular_economy", "economia_circular",
        "rd_", "suelos_contaminados",
    ],
    DocType.INFORME: [
        "informe", "auditoria", "auditoría", "diagnostico", "diagnóstico",
        "estudio", "dictamen", "peritaje", "ficha", "guia", "guía",
        "manual", "protocolo",
        # Fichas de gestores, instalaciones y perfiles locales
        "gestores", "vertedero", "ecoparque", "coprocesamiento",
        "biometanizacion", "mapa_destinos", "subcategorias",
        "recicla", "recycling", "planta_", "plantas_",
    ],
}

KB_CONTENT_SIGNALS = {
    DocType.NORMATIVA: CONTENT_SIGNALS[DocType.NORMATIVA],
    DocType.ANALISIS: CONTENT_SIGNALS[DocType.ANALISIS],
    DocType.CERTIFICACION: CONTENT_SIGNALS[DocType.CERTIFICACION],
    DocType.FDS: CONTENT_SIGNALS[DocType.FDS],
    DocType.INFORME: CONTENT_SIGNALS[DocType.INFORME],
    DocType.PLAN_GESTION: CONTENT_SIGNALS[DocType.PLAN_GESTION],
}


class DocumentClassifier:
    """
    Clasifica el tipo de documento usando señales rápidas primero,
    y LLM como fallback para casos ambiguos.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.claude = AsyncAnthropic(api_key=config.anthropic_api_key, max_retries=4)

    async def classify(
        self,
        pages: list[PageContent],
        filename: str,
        project_id: Optional[str] = None,
    ) -> DocType:
        """Router: KB (simple, sin LLM) vs proyecto (completa con LLM)."""
        if project_id is None:
            return self._classify_kb(pages, filename)
        return await self._classify_project(pages, filename)

    def _classify_kb(
        self,
        pages: list[PageContent],
        filename: str,
    ) -> DocType:
        """
        Clasificación para Knowledge Base (RAG General).
        Sin LLM — solo señales de filename y contenido.
        Default: NORMATIVA (la mayoría de docs KB son normativa/legislación).
        """
        filename_lower = filename.lower().replace(" ", "_")

        # 1. Señales de nombre de archivo
        for doc_type, signals in KB_FILENAME_SIGNALS.items():
            if any(s in filename_lower for s in signals):
                logger.info(f"KB clasificado por filename: {doc_type}")
                return doc_type

        # 2. Señales de contenido en primeras 3 páginas
        sample_text = " ".join(p.text.lower() for p in pages[:3])
        scores = {dt: 0 for dt in KB_CONTENT_SIGNALS}
        for doc_type, signals in KB_CONTENT_SIGNALS.items():
            for signal in signals:
                if signal in sample_text:
                    scores[doc_type] += 1

        best_type = max(scores, key=scores.get)
        if scores[best_type] >= 2:
            logger.info(f"KB clasificado por contenido: {best_type} (score={scores[best_type]})")
            return best_type

        # 3. Default: NORMATIVA (sin LLM para KB)
        logger.info(f"KB sin señales claras, default NORMATIVA: {filename}")
        return DocType.NORMATIVA

    async def _classify_project(
        self,
        pages: list[PageContent],
        filename: str,
    ) -> DocType:
        """
        Clasificación para documentos de proyecto.
        Flujo completo: filename → contenido → LLM fallback.
        Todos los tipos disponibles.
        """
        # 1. Señales de nombre de archivo
        filename_lower = filename.lower().replace(" ", "_")
        for doc_type, signals in FILENAME_SIGNALS.items():
            if any(s in filename_lower for s in signals):
                logger.info(f"Proyecto clasificado por filename: {doc_type}")
                return doc_type

        # 2. Señales de contenido en primeras 3 páginas
        sample_text = " ".join(p.text.lower() for p in pages[:3])
        scores = {dt: 0 for dt in DocType}
        for doc_type, signals in CONTENT_SIGNALS.items():
            for signal in signals:
                if signal in sample_text:
                    scores[doc_type] += 1

        best_type = max(scores, key=scores.get)
        if scores[best_type] >= 2:
            logger.info(f"Proyecto clasificado por contenido: {best_type} (score={scores[best_type]})")
            return best_type

        # 3. Fallback: LLM
        logger.info("Clasificación de proyecto ambigua, usando LLM...")
        return await self._classify_with_llm(pages[:2], filename)

    async def _classify_with_llm(
        self, pages: list[PageContent], filename: str,
    ) -> DocType:
        """Usa Claude para clasificar documentos de proyecto ambiguos."""
        text_sample = "\n".join(p.text[:3000] for p in pages[:3])
        valid_types = [dt.value for dt in DocType if dt != DocType.DESCONOCIDO]

        prompt = f"""Eres un experto en gestión de residuos industriales en España.
Clasifica este documento en UNO de estos tipos:
{chr(10).join(f"- {t}" for t in valid_types)}

Guía de clasificación:
- normativa: BREFs, Directivas EU, Reglamentos EU, Leyes, Decretos, Órdenes ministeriales, texto legislativo o regulatorio.
- factura: Facturas de pago con importes, IVA, NIF. NO clasificar como factura si no tiene importes económicos.
- autorizacion_ambiental_integrada: AAIs, permisos IPPC con condiciones y LERs autorizados.
- contrato_gestor: Contratos de servicios de gestión de residuos con cláusulas.
- declaracion_anual_residuos: DARIs, memorias anuales de producción de residuos.
- analisis_residuos: Informes de laboratorio, análisis químicos, caracterizaciones de residuos, ensayos de lixiviación, resultados con concentraciones (mg/kg, ppm).
- informe_certificacion: Certificados de gestión, valorización, eliminación, destrucción, declaraciones de no peligrosidad, fin de condición de residuo.
- solicitud_cotizacion: RFQ, solicitudes de oferta/cotización a gestores, peticiones de precio para servicios de gestión.
- ficha_seguridad: FDS/SDS/MSDS, fichas de datos de seguridad con secciones 1-16, pictogramas, frases H/P.
- informe_tecnico: Informes técnicos, auditorías ambientales, diagnósticos, estudios, dictámenes, peritajes.
- plan_gestion: Planes de gestión de residuos, minimización, prevención, planes directores, estudios de minimización.

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

    Contextual Embeddings: cada chunk se prefija con un resumen del
    documento padre generado por Claude Haiku, para que el embedding
    capture el contexto global (título, tipo de norma, ámbito, fecha).
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.claude = AsyncAnthropic(api_key=config.anthropic_api_key, max_retries=4)

    async def _generate_doc_context(
        self,
        pages: list[PageContent],
        doc_type: DocType,
        filename: str,
    ) -> str:
        """
        Genera un resumen contextual del documento usando Claude Haiku.
        Se llama UNA sola vez por documento y se prefija a todos los chunks.
        Esto permite que el embedding capture: qué documento es, de qué trata,
        y cuáles son sus referencias clave.
        """
        # Extraer muestra de texto de las primeras 3 páginas
        sample_text = "\n".join(p.text[:2000] for p in pages[:3])

        prompt = f"""Eres un experto en gestión de residuos industriales y normativa ambiental.
Genera un contexto breve (3-4 frases) de este documento que capture:
- Qué tipo de documento es (ley, directiva, BREF, real decreto, contrato, etc.)
- Su título o nombre oficial completo
- Su ámbito (qué regula, a qué sector aplica)
- Referencias clave (número de ley/directiva, fecha de publicación, códigos LER si aplica)

Archivo: {filename}
Tipo clasificado: {doc_type.value}

PRIMERAS PÁGINAS:
{sample_text[:4000]}

Responde SOLO con el párrafo de contexto, sin explicación ni encabezado."""

        try:
            response = await self.claude.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            context = response.content[0].text.strip()
            logger.info(f"Contexto generado para {filename}: {len(context)} chars")
            return context
        except Exception as e:
            logger.warning(f"Error generando contexto para {filename}: {e}")
            # Fallback: contexto mínimo sin LLM
            return f"Documento: {filename} | Tipo: {doc_type.value}"

    async def chunk(
        self,
        pages: list[PageContent],
        doc_type: DocType,
        doc_id: str,
        filename: str = "",
    ) -> list[DocumentChunk]:
        """Selecciona estrategia de chunking según tipo de documento."""

        # ── Contextual Embeddings: generar contexto del documento ──
        doc_context = await self._generate_doc_context(pages, doc_type, filename or doc_id)

        strategy_map = {
            DocType.AAI:           self._chunk_by_section,
            DocType.CONTRATO:      self._chunk_by_clause,
            DocType.FACTURA:       self._chunk_by_line_item,
            DocType.REGISTRO:      self._chunk_by_entry,
            DocType.DARI:          self._chunk_by_section,
            DocType.NORMATIVA:     self._chunk_by_article,
            DocType.ANALISIS:      self._chunk_by_section,
            DocType.CERTIFICACION: self._chunk_by_section,
            DocType.RFQ:           self._chunk_by_section,
            DocType.FDS:           self._chunk_by_sds_section,
            DocType.INFORME:       self._chunk_by_section,
            DocType.PLAN_GESTION:  self._chunk_by_section,
        }

        strategy = strategy_map.get(doc_type, self._chunk_sliding_window)
        chunks = await strategy(pages, doc_id, doc_type)

        # ── Prefijar contexto a todos los chunks ──
        self._prepend_context(chunks, doc_context, doc_type)

        # Siempre añadir chunks de tablas por separado (son más valiosas)
        table_chunks = self._chunk_tables(pages, doc_id, doc_type, len(chunks))
        self._prepend_context(table_chunks, doc_context, doc_type)
        chunks.extend(table_chunks)

        logger.info(f"Chunking {doc_type}: {len(chunks)} chunks ({len(table_chunks)} de tablas)")
        return chunks

    def _prepend_context(
        self,
        chunks: list[DocumentChunk],
        doc_context: str,
        doc_type: DocType,
    ) -> None:
        """Prefija el contexto del documento a cada chunk (in-place)."""
        if not doc_context:
            return
        prefix = f"[{doc_type.value.upper()}]\n{doc_context}\n---\n"
        for chunk in chunks:
            chunk.content = prefix + chunk.content

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

    async def _chunk_by_sds_section(
        self, pages: list[PageContent], doc_id: str, doc_type: DocType
    ) -> list[DocumentChunk]:
        """
        Para fichas de datos de seguridad (FDS/SDS): divide por las 16 secciones
        estandarizadas del Reglamento REACH / formato GHS.
        """
        config = CHUNK_CONFIG[doc_type]
        full_text = "\n".join(p.text for p in pages)

        sds_patterns = [
            r"(?:^|\n)(SECCI[ÓO]N\s+\d+[^\n]*)",
            r"(?:^|\n)(Secci[óo]n\s+\d+[^\n]*)",
            r"(?:^|\n)(\d+\.\s+(?:Identificaci|Composici|Primeros|Medidas|Manipulaci|Controles|Propiedades|Estabilidad|Informaci|Consideraciones)[^\n]*)",
        ]

        splits = self._split_by_patterns(full_text, sds_patterns)
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

    # Máximo de filas por chunk de tabla — previene embeddings oversized.
    # 50 filas × ~40 words/fila = ~2000 words + headers + contexto ≈ 3000 words.
    MAX_TABLE_ROWS = 50

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
        Tablas grandes se subdividen en grupos de MAX_TABLE_ROWS filas.
        """
        table_chunks = []
        chunk_index = start_index

        for page in pages:
            for table in page.tables:
                headers = table.get("headers", [])
                rows = table.get("rows", [])
                if not headers or not rows:
                    continue

                # Header Markdown (compartido por todos los sub-chunks)
                header_lines = [
                    " | ".join(str(h) for h in headers),
                    " | ".join("---" for _ in headers),
                ]

                total_parts = (len(rows) + self.MAX_TABLE_ROWS - 1) // self.MAX_TABLE_ROWS

                for group_start in range(0, len(rows), self.MAX_TABLE_ROWS):
                    group_rows = rows[group_start:group_start + self.MAX_TABLE_ROWS]

                    lines = list(header_lines)
                    for row in group_rows:
                        lines.append(" | ".join(str(c) for c in row))

                    # Indicar parte si la tabla fue dividida
                    suffix = ""
                    if total_parts > 1:
                        part_num = group_start // self.MAX_TABLE_ROWS + 1
                        suffix = f" (parte {part_num}/{total_parts})"

                    content = f"[TABLA - Página {page.page_num}{suffix}]\n" + "\n".join(lines)

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
                            "num_rows": len(group_rows),
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
        global_index = 0
        for split in splits:
            # Si el split es muy largo, subdividir con ventana deslizante
            words = split.split()
            if len(words) > config["size"] * 1.5:
                sub_chunks = self._subdivide(split, doc_id, doc_type, config, global_index)
                chunks.extend(sub_chunks)
                global_index += len(sub_chunks)
            else:
                chunks.append(DocumentChunk(
                    chunk_id=f"{doc_id}_chunk_{global_index:04d}",
                    doc_id=doc_id,
                    content=split,
                    chunk_index=global_index,
                    page_start=1,
                    page_end=len(pages),
                    chunk_type="seccion",
                    metadata={"doc_type": doc_type.value},
                ))
                global_index += 1
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
