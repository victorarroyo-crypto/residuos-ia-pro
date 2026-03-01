"""
SERVICIO LLM COMPARTIDO
=========================
Wrapper para llamadas a Claude que usan todos los agentes.
Centraliza la logica de retry, parsing JSON y manejo de errores.

Soporta dos modos:
- call_claude(): prompt → respuesta directa (sin herramientas)
- call_claude_with_tools(): prompt + herramientas → loop agentico
"""

import json
import logging
import re
from typing import Any

import httpx
from anthropic import AsyncAnthropic

from .tools import ToolExecutor

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 5


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
    client = AsyncAnthropic(
        api_key=api_key,
        max_retries=4,
        timeout=httpx.Timeout(300.0, connect=10.0),
    )

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


async def call_claude_with_tools(
    api_key: str,
    system_prompt: str,
    user_message: str,
    tools: list[dict],
    tool_executor: ToolExecutor,
    expect_json: bool = True,
    model: str = "claude-sonnet-4-20250514",
    max_tokens: int = 4096,
    temperature: float = 0.2,
) -> dict[str, Any] | str:
    """Llama a Claude con herramientas y gestiona el loop de tool use.

    Flujo:
    1. Enviar mensaje + definiciones de herramientas
    2. Si Claude responde con tool_use, ejecutar herramientas
    3. Enviar resultados de vuelta
    4. Repetir hasta que Claude responda con texto final
    """
    client = AsyncAnthropic(
        api_key=api_key,
        max_retries=4,
        timeout=httpx.Timeout(300.0, connect=10.0),
    )

    messages = [{"role": "user", "content": user_message}]
    response = None

    for round_num in range(MAX_TOOL_ROUNDS):
        response = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=messages,
            tools=tools,
        )

        # Si stop_reason es "end_turn", tenemos la respuesta final
        if response.stop_reason == "end_turn":
            text = _extract_text(response)
            if not expect_json:
                return text
            return parse_json_response(text)

        # Si stop_reason es "tool_use", ejecutar herramientas
        if response.stop_reason == "tool_use":
            # Añadir respuesta del asistente completa
            messages.append({"role": "assistant", "content": response.content})

            # Ejecutar cada tool call
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    logger.info(
                        f"Tool call [{round_num + 1}/{MAX_TOOL_ROUNDS}]: "
                        f"{block.name}({json.dumps(block.input, ensure_ascii=False)[:200]})"
                    )
                    result_text = await tool_executor.execute(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_text,
                    })

            messages.append({"role": "user", "content": tool_results})
            continue

        # Stop reason desconocido, tratar como final
        text = _extract_text(response)
        if not expect_json:
            return text
        return parse_json_response(text) if text else {"findings": [], "error": "Respuesta vacía"}

    # Máximo de rondas alcanzado
    logger.warning(f"Alcanzado máximo de {MAX_TOOL_ROUNDS} rondas de tool use")
    text = _extract_text(response) if response else ""
    if not expect_json:
        return text
    return parse_json_response(text) if text else {"findings": [], "error": "Máximo de tool use alcanzado"}


def _extract_text(response) -> str:
    """Extrae bloques de texto de una respuesta de Claude."""
    text_blocks = [b.text for b in response.content if b.type == "text"]
    return "\n".join(text_blocks)


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

    logger.error(
        "No se pudo extraer JSON de la respuesta del LLM. Primeros 500 chars: %s",
        text[:500],
    )
    return {"findings": [], "error": "No se pudo parsear la respuesta del LLM"}
