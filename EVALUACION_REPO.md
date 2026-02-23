# Evaluación técnica del repositorio `residuos-ia-pro` (revisión corregida)

Fecha: 2026-02-23

## Resumen ejecutivo

Tras revisar el código real del pipeline y contrastarlo contra el flujo funcional esperado, la conclusión es:

- La base actual es **sólida pero parcial** para el flujo descrito.
- Hay componentes implementados (detección de naturaleza PDF, OCR, chunking con overlap, persistencia en Supabase).
- Hay diferencias importantes respecto a lo esperado (descarga por URL con retry, validación HEAD, hash semántico de duplicados, fallback multi-proveedor de embeddings y webhook final).

**Estado técnico estimado:** 7.0/10 (arquitectura buena, cobertura funcional incompleta frente al objetivo descrito).

---

## Verificación punto a punto del flujo solicitado

## 1) Descarga y desbloqueo

### Lo esperado
- `validate_url()` con HEAD (accesibilidad + `Content-Type` PDF)
- `download_pdf_with_retry()` con 3 intentos y backoff 1s/2s/4s
- `unlock_pdf()` para restricciones de owner password

### Lo encontrado
- **No existe** en pipeline un flujo de descarga de PDF por URL con `validate_url()` + retry/backoff dedicado.
- Sí existe desbloqueo/desencriptado con `pikepdf`:
  - `try_unlock()` intenta abrir sin contraseña para PDFs con restricciones de permisos. 
  - `decrypt()` usa contraseña cuando se provee.
- La orquestación en `PDFPipeline.process()` aplica `try_unlock()`/`decrypt()` si detecta `PDFNature.ENCRYPTED`.

### Veredicto
**Parcialmente implementado** (desbloqueo sí; descarga+validación URL con retry no).

---

## 2) Extracción de texto en tres capas de fallback

### Lo esperado
1. PyMuPDF (fitz)
2. pdfplumber
3. OCR con pytesseract usando render de PyMuPDF a 144 DPI

### Lo encontrado
- El pipeline principal (`pipeline/extractor.py`) usa:
  - `pdfplumber` para PDFs digitales.
  - `pdf2image` + `pytesseract` para escaneados/híbridos (a 300 DPI).
- **No usa PyMuPDF/fitz** en el extractor principal.
- Hay un extractor auxiliar en API para adjuntos de asesor (`_extract_pdf_text`) con `pdfplumber` y fallback a `pdfminer`, no a OCR.

### Veredicto
**Implementación diferente a la especificada**: hay fallback robusto, pero no coincide con la cascada PyMuPDF→pdfplumber→OCR descrita.

---

## 3) Limpieza y detección de duplicados

### Lo esperado
- `clean_text()` con regex de limpieza
- `calculate_content_hash()` semántico (normalización + SHA256 primeros 50k chars)
- Detección de duplicados por hash semántico en BD

### Lo encontrado
- No se observa `clean_text()` explícito con esa estrategia.
- No aparece `content_hash` en pipeline/API para deduplicación documental.
- Los IDs se generan con hash binario del archivo + `client_id` (`sha256(pdf_bytes + client_id)`), útil para ID estable pero **no equivalente** a hash semántico de contenido limpiado.

### Veredicto
**No implementado** según el diseño esperado.

---

## 4) Chunking semántico

### Lo esperado
- `create_chunks()` por ~1500 caracteres con overlap ~200

### Lo encontrado
- Sí existe `SemanticChunker` con estrategias por tipo documental.
- Usa configuración por tipo con `size` y `overlap` (por tokens/palabras), y fallback de ventana deslizante con solape (`i += size - overlap`).
- Incluye chunking de tablas como bloques estructurados.

### Veredicto
**Implementado (con enfoque propio)**. Cumple el objetivo de contexto solapado, aunque con parametrización distinta a la descrita.

---

## 5) Embeddings con fallback multi-proveedor

### Lo esperado
- Fallback OpenAI → Voyage → Cohere → Gemini
- Ajuste de dimensionalidad con `_pad_or_truncate_embedding()` a `vector(1536)`
- Retry por cuotas/rate limits

### Lo encontrado
- `EmbeddingService` usa **solo OpenAI** (`text-embedding-3-large`, 1536 dimensiones).
- No se observan proveedores alternativos ni pad/truncate para vectores heterogéneos.
- En error de lote, registra y continúa (sin retry explícito/backoff por proveedor).

### Veredicto
**No implementado** el fallback multi-proveedor.

---

## 6) Persistencia en Supabase + webhook final

### Lo esperado
- Guardar chunks/documento con hash y embedding resumen
- Callback webhook a frontend con estado (`processed/failed/duplicate`) + reintentos

### Lo encontrado
- Persistencia sí está implementada en `knowledge_documents/project_documents` y `knowledge_chunks/project_chunks`.
- Se guardan metadatos y embeddings de chunks.
- No se observa embedding de resumen documental (primeros 3000 chars) ni `content_hash` semántico.
- No se observa webhook de callback final dedicado en pipeline.
- Sí existe emisión de progreso a tabla `pipeline_progress` (upsert), lo que cubre parte de observabilidad, pero no sustituye webhook externo.

### Veredicto
**Parcialmente implementado**.

---

## Gap principal (qué falta para igualar el flujo objetivo)

1. **Módulo de descarga de PDFs por URL** con:
   - `validate_url()` vía HEAD (`Content-Type`, tamaño, accesibilidad).
   - `download_pdf_with_retry()` con 3 intentos y backoff exponencial.
2. **Cascada de extracción alineada al diseño** (si se mantiene requisito PyMuPDF-first):
   - PyMuPDF → pdfplumber → OCR.
3. **Deduplicación semántica real**:
   - `clean_text()` + `calculate_content_hash()` sobre texto normalizado.
   - Índice/constraint + consulta previa en BD para estado `duplicate`.
4. **EmbeddingProvider multi-proveedor**:
   - estrategia de fallback y política de retries.
   - normalización de dimensión (`pad/truncate`) si se mantiene `vector(1536)`.
5. **Callback webhook final**:
   - estados normalizados (`processed`, `failed`, `duplicate`).
   - retry y control de idempotencia.

---

## Recomendación de priorización (2 semanas)

- **Semana 1**: deduplicación semántica + módulo URL con retry + tests de contrato.
- **Semana 2**: fallback de embeddings + webhook final + métricas de éxito/fallo.

Con esto, el pipeline quedaría alineado con el flujo operativo descrito y mejoraría resiliencia en producción.
