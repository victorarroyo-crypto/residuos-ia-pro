"""
SERVICIO LLM COMPARTIDO
=========================
Wrapper para llamadas a LLM que usan todos los agentes.
Centraliza la logica de retry, parsing JSON, manejo de errores,
y routing multi-proveedor via ModelRouter.

Soporta dos modos:
- call_llm(): prompt → respuesta directa (sin herramientas)
- call_llm_with_tools(): prompt + herramientas → loop agentico (Anthropic only)

Legacy (backward-compatible):
- call_claude(): alias de call_llm con provider forzado a Anthropic
- call_claude_with_tools(): alias de call_llm_with_tools
"""

import json
import logging
import re
import time
from typing import Any, Optional

import httpx
from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 5

# Module-level ModelRouter instance (set by init_model_router)
_router = None
_cost_guard = None


def init_model_router(router, cost_guard=None):
    """Initialize the shared ModelRouter for agent calls.

    Called once from api/server.py lifespan.
    """
    global _router, _cost_guard
    _router = router
    _cost_guard = cost_guard


def routing_kwargs(state: dict) -> dict:
    """Extract model routing params from AnalysisState for passing to call_claude/call_llm.

    Usage in agents:
        result = await call_claude(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_AAI,
            user_message=context,
            **routing_kwargs(state),
        )
    """
    return {
        "service": "analysis",
        "tier": state.get("tier", "standard"),
        "model_override": state.get("model_override"),
        "consultant_id": state.get("consultant_id"),
        "project_id": state.get("project_id"),
    }


async def call_llm(
    api_key: str,
    system_prompt: str,
    user_message: str,
    expect_json: bool = True,
    model: str = "claude-sonnet-4-20250514",
    max_tokens: int = 4096,
    temperature: float = 0.2,
    # Model routing params
    service: str = "analysis",
    tier: str = "standard",
    model_override: Optional[str] = None,
    consultant_id: Optional[str] = None,
    project_id: Optional[str] = None,
    openai_api_key: str = "",
    gemini_api_key: str = "",
) -> dict[str, Any] | str:
    """Llama al LLM usando ModelRouter (fallback chain) y devuelve JSON o texto."""
    from pipeline.model_router import ModelRouter, MODEL_API_IDS, MODEL_PROVIDERS
    from pipeline.cost_guard import CostGuard, calculate_cost

    messages = [{"role": "user", "content": user_message}]

    if _router is not None:
        # Use the shared ModelRouter with full fallback chain
        result = await _router.execute(
            service=service,
            system_prompt=system_prompt,
            messages=messages,
            consultant_id=consultant_id,
            project_id=project_id,
            tier=tier,
            model_override=model_override,
            operation=f"{service}_agent",
            max_tokens=max_tokens,
            temperature=temperature,
        )
        text = result.text
        logger.info(
            "Agent LLM: model=%s, provider=%s, tokens=%d+%d, cost=$%.4f",
            result.model_used, result.provider,
            result.input_tokens, result.output_tokens, result.cost_usd,
        )
    else:
        # Fallback: direct Anthropic call (no router available)
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
            messages=messages,
        )
        text = response.content[0].text

    if not expect_json:
        return text

    return parse_json_response(text)


# Legacy alias — backward compatible
async def call_claude(
    api_key: str,
    system_prompt: str,
    user_message: str,
    expect_json: bool = True,
    model: str = "claude-sonnet-4-20250514",
    max_tokens: int = 4096,
    temperature: float = 0.2,
    # New optional params (ignored by old callers)
    service: str = "analysis",
    tier: str = "standard",
    model_override: Optional[str] = None,
    consultant_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> dict[str, Any] | str:
    """Llama al LLM. Legacy alias de call_llm para compatibilidad."""
    return await call_llm(
        api_key=api_key,
        system_prompt=system_prompt,
        user_message=user_message,
        expect_json=expect_json,
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        service=service,
        tier=tier,
        model_override=model_override,
        consultant_id=consultant_id,
        project_id=project_id,
    )


async def call_claude_with_tools(
    api_key: str,
    system_prompt: str,
    user_message: str,
    tools: list[dict],
    tool_executor,
    expect_json: bool = True,
    model: str = "claude-sonnet-4-20250514",
    max_tokens: int = 4096,
    temperature: float = 0.2,
    # Model routing
    service: str = "analysis",
    tier: str = "standard",
    model_override: Optional[str] = None,
    consultant_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> dict[str, Any] | str:
    """Llama al LLM con herramientas y gestiona el loop de tool use.

    Tool use solo funciona con Anthropic. Si ModelRouter selecciona otro
    proveedor, se usa sin herramientas como fallback.

    Flujo:
    1. Enviar mensaje + definiciones de herramientas
    2. Si el LLM responde con tool_use, ejecutar herramientas
    3. Enviar resultados de vuelta
    4. Repetir hasta que responda con texto final
    """
    from pipeline.model_router import MODEL_API_IDS, MODEL_PROVIDERS

    # Resolve which model to use
    actual_model = model
    if _router is not None and model_override:
        chain = await _router.get_consultant_chain(
            service=service,
            consultant_id=consultant_id,
            tier_override=tier,
            model_override=model_override,
        )
        if chain:
            candidate = chain[0]
            provider = MODEL_PROVIDERS.get(candidate, "unknown")
            if provider == "anthropic":
                actual_model = MODEL_API_IDS.get(candidate, candidate)
            else:
                # Non-Anthropic: fall back to call_llm without tools
                logger.info("Tool use not supported for %s (%s), calling without tools",
                            candidate, provider)
                return await call_llm(
                    api_key=api_key,
                    system_prompt=system_prompt,
                    user_message=user_message,
                    expect_json=expect_json,
                    model=model,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    service=service,
                    tier=tier,
                    model_override=model_override,
                    consultant_id=consultant_id,
                    project_id=project_id,
                )

    client = AsyncAnthropic(
        api_key=api_key,
        max_retries=4,
        timeout=httpx.Timeout(300.0, connect=10.0),
    )
    messages = [{"role": "user", "content": user_message}]
    response = None
    total_input_tokens = 0
    total_output_tokens = 0
    call_start = time.monotonic()

    for round_num in range(MAX_TOOL_ROUNDS):
        response = await client.messages.create(
            model=actual_model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=messages,
            tools=tools,
        )

        total_input_tokens += response.usage.input_tokens
        total_output_tokens += response.usage.output_tokens

        # Si stop_reason es "end_turn", tenemos la respuesta final
        if response.stop_reason == "end_turn":
            text = _extract_text(response)
            # Record cost for all rounds combined
            if _cost_guard and consultant_id:
                duration_ms = int((time.monotonic() - call_start) * 1000)
                # Resolve friendly model name from API ID
                friendly = model_override or _api_id_to_friendly(actual_model)
                await _cost_guard.record(
                    model=friendly, service=service, operation=f"{service}_agent_tools",
                    input_tokens=total_input_tokens, output_tokens=total_output_tokens,
                    duration_ms=duration_ms, consultant_id=consultant_id,
                    project_id=project_id,
                    metadata={"tool_rounds": round_num + 1, "tier": tier},
                )
            if not expect_json:
                return text
            return parse_json_response(text)

        # Si stop_reason es "tool_use", ejecutar herramientas
        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})

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


def _api_id_to_friendly(api_model: str) -> str:
    """Convert API model ID back to friendly name."""
    from pipeline.model_router import MODEL_API_IDS
    for friendly, api_id in MODEL_API_IDS.items():
        if api_id == api_model:
            return friendly
    return api_model


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
