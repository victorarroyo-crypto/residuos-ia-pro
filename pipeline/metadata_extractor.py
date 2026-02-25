"""
EXTRACTOR DE METADATOS ESTRUCTURADOS
=====================================
El paso más valioso del pipeline: extraer datos estructurados de los documentos
para poblar directamente las tablas de Supabase.

Por tipo de documento extrae:
  AAI      → LERs autorizados, cantidades máximas, fecha vencimiento, condiciones
  Contrato → gestor, LERs contratados, precio €/t, fecha vencimiento
  Factura  → gestor, LERs facturados, importe total, fecha, desviación vs contrato
  Registro → entradas con fecha/LER/cantidad/gestor para cada movimiento
  DARI     → resumen anual por LER con totales
"""

import logging
import re
from anthropic import AsyncAnthropic

from .pdf_pipeline import DocType, PageContent, PipelineConfig

logger = logging.getLogger(__name__)

# Patrón LER: XX XX XX (con espacios) o XXXXXX (sin espacios) o XX 00 00*
LER_PATTERN = re.compile(
    r"\b(\d{2}[\s\-]?\d{2}[\s\-]?\d{2}\*?)\b"
)


class MetadataExtractor:
    """
    Extrae metadatos estructurados usando combinación de:
    1. Regex para datos tabulares predecibles (LERs, precios, fechas)
    2. Claude para datos complejos o en prosa (condiciones de AAI)
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.claude = AsyncAnthropic(api_key=config.anthropic_api_key, max_retries=4)

    async def extract(
        self,
        pages: list[PageContent],
        doc_type: DocType,
        client_id: str,
    ) -> dict:
        """Extrae metadatos según el tipo de documento."""

        full_text = "\n".join(p.text for p in pages)
        all_tables = [t for p in pages for t in p.tables]

        # Extracción rápida con regex (siempre)
        base_metadata = {
            "client_id": client_id,
            "doc_type": doc_type.value,
            "ler_codes_found": self._extract_ler_codes(full_text),
            "dates_found": self._extract_dates(full_text),
            "amounts_eur": self._extract_amounts(full_text),
            "num_pages": len(pages),
            "num_tables": len(all_tables),
        }

        # Extracción estructurada con LLM según tipo
        extractor_map = {
            DocType.AAI:      self._extract_aai_metadata,
            DocType.CONTRATO: self._extract_contract_metadata,
            DocType.FACTURA:  self._extract_invoice_metadata,
            DocType.REGISTRO: self._extract_registry_metadata,
            DocType.DARI:     self._extract_dari_metadata,
        }

        extractor = extractor_map.get(doc_type)
        if extractor:
            specific = await extractor(full_text, all_tables)
            base_metadata.update(specific)

        logger.info(
            f"Metadatos extraídos: {len(base_metadata.get('ler_codes_found', []))} LERs, "
            f"{len(base_metadata.get('dates_found', []))} fechas"
        )
        return base_metadata

    # ──────────────────────────────────────────────────────
    # EXTRACTORES POR TIPO DE DOCUMENTO
    # ──────────────────────────────────────────────────────

    async def _extract_aai_metadata(self, text: str, tables: list[dict]) -> dict:
        """
        Extrae de la AAI:
        - Número de expediente
        - Fecha de concesión y vencimiento
        - Actividad IPPC autorizada
        - LERs autorizados con cantidades máximas
        - Condiciones específicas de gestión
        """
        prompt = f"""Eres un experto en autorizaciones ambientales integradas (AAI) en España.
Extrae la siguiente información del texto de la AAI y devuelve JSON válido:

{{
  "numero_expediente": "string o null",
  "fecha_concesion": "YYYY-MM-DD o null",
  "fecha_vencimiento": "YYYY-MM-DD o null",
  "actividad_ippc": "descripción de la actividad autorizada",
  "lers_autorizados": [
    {{
      "codigo_ler": "XX XX XX",
      "descripcion": "string",
      "cantidad_max_toneladas": numero o null,
      "operacion": "D1/R1/etc o null",
      "condiciones_especiales": "string o null"
    }}
  ],
  "condiciones_almacenamiento": "resumen de condiciones clave",
  "obligaciones_reporte": ["lista de obligaciones de seguimiento"],
  "gestor_residuos_peligrosos_requerido": true/false
}}

TEXTO DE LA AAI (primeros 4000 caracteres):
{text[:4000]}

Responde SOLO con el JSON, sin texto adicional."""

        return await self._call_claude_json(prompt, "aai_metadata")

    async def _extract_contract_metadata(self, text: str, tables: list[dict]) -> dict:
        """Extrae datos clave del contrato con el gestor."""
        prompt = f"""Extrae información de este contrato de gestión de residuos y devuelve JSON:

{{
  "nombre_gestor": "string",
  "nif_gestor": "string o null",
  "numero_autorizacion_gestor": "string o null",
  "fecha_inicio": "YYYY-MM-DD o null",
  "fecha_vencimiento": "YYYY-MM-DD o null",
  "preaviso_dias": numero o null,
  "servicios_contratados": [
    {{
      "codigo_ler": "XX XX XX",
      "descripcion_residuo": "string",
      "precio_eur_tonelada": numero o null,
      "precio_eur_recogida": numero o null,
      "frecuencia_recogida": "string o null",
      "cantidad_minima_toneladas": numero o null,
      "operacion": "D1/R1/etc"
    }}
  ],
  "penalizaciones": "descripción de cláusulas de penalización o null",
  "exclusividad": true/false,
  "renovacion_automatica": true/false,
  "importe_total_anual_estimado": numero o null
}}

TEXTO DEL CONTRATO:
{text[:4000]}

Responde SOLO con el JSON."""

        return await self._call_claude_json(prompt, "contract_metadata")

    async def _extract_invoice_metadata(self, text: str, tables: list[dict]) -> dict:
        """Extrae datos de factura para detectar desviaciones vs contrato."""
        prompt = f"""Extrae información de esta factura de gestión de residuos y devuelve JSON:

{{
  "numero_factura": "string",
  "fecha_factura": "YYYY-MM-DD o null",
  "fecha_servicio": "YYYY-MM-DD o null",
  "emisor_nombre": "string",
  "emisor_nif": "string o null",
  "receptor_nombre": "string o null",
  "lineas_servicio": [
    {{
      "descripcion": "string",
      "codigo_ler": "XX XX XX o null",
      "cantidad_toneladas": numero o null,
      "precio_unitario_eur": numero o null,
      "importe_eur": numero o null
    }}
  ],
  "base_imponible": numero o null,
  "iva_porcentaje": numero o null,
  "total_factura_eur": numero o null,
  "forma_pago": "string o null"
}}

TEXTO DE LA FACTURA:
{text[:3000]}

Responde SOLO con el JSON."""

        return await self._call_claude_json(prompt, "invoice_metadata")

    async def _extract_registry_metadata(self, text: str, tables: list[dict]) -> dict:
        """Extrae entradas del libro de registro de residuos."""
        prompt = f"""Extrae las entradas del libro registro de residuos industriales y devuelve JSON:

{{
  "periodo_inicio": "YYYY-MM-DD o null",
  "periodo_fin": "YYYY-MM-DD o null",
  "entradas": [
    {{
      "fecha": "YYYY-MM-DD o null",
      "codigo_ler": "XX XX XX",
      "descripcion": "string",
      "cantidad_kg": numero o null,
      "gestor_destino": "string o null",
      "numero_documento_aceptacion": "string o null",
      "operacion_destino": "D/R codigo"
    }}
  ],
  "total_residuos_peligrosos_kg": numero o null,
  "total_residuos_no_peligrosos_kg": numero o null,
  "alertas_almacenamiento": ["LERs que pueden estar almacenados más de 6 meses"]
}}

TEXTO DEL REGISTRO:
{text[:4000]}

Responde SOLO con el JSON."""

        return await self._call_claude_json(prompt, "registry_metadata")

    async def _extract_dari_metadata(self, text: str, tables: list[dict]) -> dict:
        """Extrae datos de la Declaración Anual de Residuos."""
        prompt = f"""Extrae información de esta Declaración Anual de Residuos (DARI) y devuelve JSON:

{{
  "año_declaracion": numero,
  "fecha_presentacion": "YYYY-MM-DD o null",
  "comunidad_autonoma": "string",
  "numero_inscripcion_registro": "string o null",
  "residuos_declarados": [
    {{
      "codigo_ler": "XX XX XX",
      "descripcion": "string",
      "peligroso": true/false,
      "cantidad_producida_toneladas": numero,
      "operacion_gestion": "D/R codigo",
      "gestor_utilizado": "string o null"
    }}
  ],
  "total_peligrosos_t": numero o null,
  "total_no_peligrosos_t": numero o null,
  "coste_total_gestion_eur": numero o null
}}

TEXTO DE LA DARI:
{text[:4000]}

Responde SOLO con el JSON."""

        return await self._call_claude_json(prompt, "dari_metadata")

    # ──────────────────────────────────────────────────────
    # EXTRACTORES CON REGEX (rápidos, sin LLM)
    # ──────────────────────────────────────────────────────

    def _extract_ler_codes(self, text: str) -> list[str]:
        """Extrae todos los códigos LER del texto."""
        matches = LER_PATTERN.findall(text)
        # Normalizar formato: quitar espacios, añadir espacios estándar
        normalized = []
        seen = set()
        for m in matches:
            code = re.sub(r"[\s\-]", "", m)
            if len(code) in (6, 7) and code not in seen:  # 7 si tiene *
                normalized.append(code)
                seen.add(code)
        return normalized

    def _extract_dates(self, text: str) -> list[str]:
        """Extrae fechas en formatos españoles comunes."""
        patterns = [
            r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b",
            r"\b(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})\b",
            r"\b(\d{4}-\d{2}-\d{2})\b",
        ]
        dates = []
        for pattern in patterns:
            dates.extend(re.findall(pattern, text, re.IGNORECASE))
        return list(set(dates))[:20]  # máximo 20 fechas

    def _extract_amounts(self, text: str) -> list[float]:
        """Extrae importes monetarios."""
        pattern = r"\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|EUR|euros?)\b"
        matches = re.findall(pattern, text, re.IGNORECASE)
        amounts = []
        for m in matches:
            try:
                clean = m.replace(".", "").replace(",", ".")
                amounts.append(float(clean))
            except ValueError:
                pass
        return sorted(set(amounts), reverse=True)[:10]

    # ──────────────────────────────────────────────────────
    # HELPER LLM
    # ──────────────────────────────────────────────────────

    async def _call_claude_json(self, prompt: str, context: str) -> dict:
        """Llama a Claude y parsea la respuesta como JSON."""
        import json
        try:
            response = await self.claude.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            # Limpiar posibles backticks
            raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
            return json.loads(raw)
        except Exception as e:
            logger.warning(f"Error extrayendo metadatos {context}: {e}")
            return {}
