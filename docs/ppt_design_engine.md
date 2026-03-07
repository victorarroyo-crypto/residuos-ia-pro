# Motor de Presentaciones "anti-mala-interpretación" de LLM

## Problema real
Los LLM fallan en diseño cuando se les pide "haz una slide bonita" en modo libre. El modelo interpreta reglas de forma inconsistente.

## Principio de arquitectura
**El LLM no decide layout ni estilos**. Solo produce contenido estructurado.

- LLM: outline + copy + intención de slide (ej. "comparativa", "dato clave").
- Motor determinístico: elige layout válido y aplica tokens de marca.
- Validador: rechaza salidas fuera de reglas.

## Pipeline recomendado
1. **Parser de marca**
   - Genera `BrandTokens`:
     - `colors.primary|secondary|neutral`
     - `font.heading|body`
     - `spacing.scale`
     - `logo.safe_area`
2. **Plan narrativo (LLM)**
   - Estructura JSON estricta por slide:
     - `slide_type`, `title`, `bullets`, `evidence`, `visual_hint`
3. **Selector de layout (determinístico)**
   - Mapea `slide_type -> layout_id` dentro de una librería cerrada.
4. **Compositor PPTX (determinístico)**
   - Renderiza en placeholders fijos con límites de caracteres/líneas.
5. **Validador de calidad**
   - Contraste AA, densidad de texto, overflow, alineación, uso de paleta.
6. **Bucle de corrección**
   - Si falla validación: se reescribe contenido (no diseño) y se recompone.

## Contrato JSON (evita ambigüedad del LLM)
```json
{
  "deck_goal": "ventas_b2b",
  "slides": [
    {
      "slide_type": "problem",
      "title": "Costos operativos crecientes",
      "bullets": ["..."],
      "evidence": "dato o fuente",
      "visual_hint": "single_chart"
    }
  ]
}
```

## Reglas duras (hard constraints)
- Máximo 8 líneas de texto por slide informativa.
- Máximo 12 palabras por bullet (configurable).
- Solo colores de `BrandTokens` + neutros permitidos.
- Contraste mínimo WCAG AA.
- Logo solo en slots permitidos.
- Tipografías únicamente de la familia autorizada.

## Métricas de "calidad no subjetiva"
- `% de slides con overflow` (objetivo: <2%).
- `% de slides que violan contraste` (objetivo: 0%).
- `% de slides editadas manualmente por usuario` (objetivo: bajar semana a semana).
- `Tiempo hasta deck final`.

## Qué sí hace el LLM
- Resumir.
- Adaptar tono.
- Reescribir por límite de espacio.

## Qué no hace el LLM
- Elegir tipografías finales.
- Decidir grids.
- Definir márgenes.
- Crear paletas libremente.

## Resultado
Si separas **contenido probabilístico** (LLM) de **diseño determinístico** (reglas + plantillas), la calidad visual deja de depender de si el modelo "entendió" diseño.
