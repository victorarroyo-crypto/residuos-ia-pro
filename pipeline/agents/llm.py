"""
SERVICIO LLM COMPARTIDO
=========================
Wrapper para llamadas a Claude que usan todos los agentes.
Centraliza la logica de retry, parsing JSON y manejo de errores.
"""

import json
import logging
import re
from typing import Any

from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)


async def call_claude(
    api_key: str,
    system_prompt: str,
    user_message: str,
    expect_json: bool = True,
    model: str = "claude-sonnet-4-20250514",
    max_tokens: int = 4096,
    temperature: float = 0.2,
) -> dict[str, Any] | str:
    """Llama a Claude y devuelve JSON parseado o texto."""
    client = AsyncAnthropic(api_key=api_key)

    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    text = response.content[0].text

    if not expect_json:
        return text

    # Extraer JSON del texto (puede venir envuelto en markdown)
    return parse_json_response(text)


def parse_json_response(text: str) -> dict[str, Any]:
    """Extrae y parsea JSON de la respuesta de Claude."""
    # Intentar parsear directamente
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Buscar bloque JSON en markdown ```json ... ```
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Buscar el primer { ... } o [ ... ]
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        start = text.find(start_char)
        if start >= 0:
            depth = 0
            for i in range(start, len(text)):
                if text[i] == start_char:
                    depth += 1
                elif text[i] == end_char:
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(text[start : i + 1])
                        except json.JSONDecodeError:
                            break

    logger.warning("No se pudo extraer JSON de la respuesta, devolviendo vacio")
    return {"findings": [], "error": "No se pudo parsear la respuesta del LLM"}
