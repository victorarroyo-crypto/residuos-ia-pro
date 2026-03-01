"""
MODEL ROUTER - Enrutador de modelos con fallback chain
========================================================
Centraliza la logica de seleccion de modelo, fallback entre proveedores
y registro de costes para TODOS los servicios (advisor, analysis, RAG, pipeline).

Soporta 3 proveedores:
- Anthropic (Claude Opus 4.6, Sonnet 4, Haiku 4.5)
- OpenAI (GPT-5.2, GPT-5, o3, o4-mini, GPT-5 Mini)
- Google (Gemini 2.5 Pro, Gemini 2.5 Flash)

Cada servicio tiene su propia cadena de fallback configurable por consultor.
"""

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Defaults por servicio ─────────────────────────────────────────

SERVICE_DEFAULTS: dict[str, dict] = {
    "advisor": {
        "standard": {
            "preferred_model": "claude-sonnet-4",
            "fallback_chain": ["gemini-2.5-pro", "gpt-5", "claude-haiku-4-5"],
        },
        "pro_plus": {
            "preferred_model": "claude-opus-4-6",
            "fallback_chain": ["gpt-5.2", "o3", "gemini-2.5-pro", "claude-sonnet-4"],
        },
    },
    "analysis": {
        "standard": {
            "preferred_model": "claude-sonnet-4",
            "fallback_chain": ["gpt-5", "gemini-2.5-pro", "claude-haiku-4-5"],
        },
        "pro_plus": {
            "preferred_model": "claude-sonnet-4",
            "fallback_chain": ["gpt-5.2", "gemini-2.5-pro"],
        },
    },
    "rag_query": {
        "standard": {
            "preferred_model": "claude-haiku-4-5",
            "fallback_chain": ["gemini-2.5-flash", "gpt-5-mini"],
        },
    },
    "pipeline": {
        "standard": {
            "preferred_model": "claude-haiku-4-5",
            "fallback_chain": ["gemini-2.5-flash"],
        },
    },
}

# ── Mapeo modelo → API model ID ──────────────────────────────────

MODEL_API_IDS: dict[str, str] = {
    # Anthropic
    "claude-opus-4-6":      "claude-opus-4-6",
    "claude-sonnet-4":      "claude-sonnet-4-20250514",
    "claude-haiku-4-5":     "claude-haiku-4-5-20251001",
    # OpenAI
    "gpt-5.2":              "gpt-5.2",
    "gpt-5":                "gpt-5",
    "o3":                   "o3",
    "o4-mini":              "o4-mini",
    "gpt-5-mini":           "gpt-5-mini",
    # Google
    "gemini-2.5-pro":       "gemini-2.5-pro",
    "gemini-2.5-flash":     "gemini-2.5-flash",
}

# ── Proveedor de cada modelo ─────────────────────────────────────

MODEL_PROVIDERS: dict[str, str] = {
    "claude-opus-4-6": "anthropic",
    "claude-sonnet-4": "anthropic",
    "claude-haiku-4-5": "anthropic",
    "gpt-5.2": "openai",
    "gpt-5": "openai",
    "o3": "openai",
    "o4-mini": "openai",
    "gpt-5-mini": "openai",
    "gemini-2.5-pro": "google",
    "gemini-2.5-flash": "google",
}

# ── Capacidades por modelo ────────────────────────────────────────

MODEL_CAPABILITIES: dict[str, dict] = {
    "claude-opus-4-6":   {"thinking": True,  "web_search": True,  "tools": True, "vision": True,  "max_tokens": 32000, "context": 200000},
    "claude-sonnet-4":   {"thinking": True,  "web_search": True,  "tools": True, "vision": True,  "max_tokens": 32000, "context": 200000},
    "claude-haiku-4-5":  {"thinking": True,  "web_search": True,  "tools": True, "vision": True,  "max_tokens": 8192,  "context": 200000},
    "gpt-5.2":           {"thinking": True,  "web_search": True,  "tools": True, "vision": True,  "max_tokens": 32000, "context": 400000},
    "gpt-5":             {"thinking": False, "web_search": True,  "tools": True, "vision": True,  "max_tokens": 16384, "context": 400000},
    "o3":                {"thinking": True,  "web_search": True,  "tools": True, "vision": True,  "max_tokens": 16384, "context": 200000},
    "o4-mini":           {"thinking": True,  "web_search": True,  "tools": True, "vision": True,  "max_tokens": 16384, "context": 200000},
    "gpt-5-mini":        {"thinking": False, "web_search": True,  "tools": True, "vision": True,  "max_tokens": 8192,  "context": 400000},
    "gemini-2.5-pro":    {"thinking": True,  "web_search": True,  "tools": True, "vision": True,  "max_tokens": 32000, "context": 1000000},
    "gemini-2.5-flash":  {"thinking": True,  "web_search": True,  "tools": True, "vision": True,  "max_tokens": 8192,  "context": 1000000},
}


@dataclass
class ModelCallResult:
    """Resultado de una llamada a modelo via ModelRouter."""
    text: str = ""
    model_used: str = ""
    provider: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    duration_ms: int = 0
    web_sources: list = field(default_factory=list)
    raw_response: Any = None
    fallback_used: bool = False
    warning: str = ""


# ── Helpers para extraer fuentes web de Google y OpenAI ──────────


def _extract_google_web_sources(response) -> list[dict]:
    """Extrae fuentes web del grounding_metadata de Gemini."""
    sources: list[dict] = []
    try:
        for candidate in getattr(response, "candidates", []):
            grounding = getattr(candidate, "grounding_metadata", None)
            if not grounding:
                continue
            # grounding_chunks contiene las fuentes
            for chunk in (getattr(grounding, "grounding_chunks", None) or []):
                web = getattr(chunk, "web", None)
                if web:
                    sources.append({
                        "title": getattr(web, "title", "") or "",
                        "url": getattr(web, "uri", "") or "",
                    })
            # search_entry_point puede tener info adicional
            support = getattr(grounding, "grounding_supports", None) or []
            for s in support:
                for seg_chunk in (getattr(s, "grounding_chunk_indices", None) or []):
                    pass  # Ya procesado arriba via grounding_chunks
    except Exception as e:
        logger.warning("Error extrayendo web sources de Gemini: %s", e, exc_info=True)
    return sources


def _extract_openai_responses_text(response) -> str:
    """Extrae texto de una respuesta de OpenAI Responses API."""
    try:
        for item in getattr(response, "output", []):
            if getattr(item, "type", None) == "message":
                for content in getattr(item, "content", []):
                    if getattr(content, "type", None) == "output_text":
                        return getattr(content, "text", "") or ""
    except Exception as e:
        logger.debug("Error extrayendo texto de OpenAI Responses: %s", e)
    return ""


def _extract_openai_web_sources(response) -> list[dict]:
    """Extrae fuentes web de las annotations de OpenAI Responses API."""
    sources: list[dict] = []
    seen_urls: set[str] = set()
    try:
        for item in getattr(response, "output", []):
            if getattr(item, "type", None) == "message":
                for content in getattr(item, "content", []):
                    for ann in getattr(content, "annotations", []):
                        if getattr(ann, "type", None) == "url_citation":
                            url = getattr(ann, "url", "") or ""
                            if url and url not in seen_urls:
                                seen_urls.add(url)
                                sources.append({
                                    "title": getattr(ann, "title", "") or url,
                                    "url": url,
                                })
    except Exception as e:
        logger.debug("Error extrayendo web sources de OpenAI Responses: %s", e)
    return sources


class ModelRouter:
    """Enruta llamadas a modelos con fallback chain y cost guard."""

    def __init__(
        self,
        anthropic_api_key: str,
        openai_api_key: str = "",
        gemini_api_key: str = "",
        cost_guard=None,
    ):
        self._anthropic_key = anthropic_api_key
        self._openai_key = openai_api_key
        self._gemini_key = gemini_api_key
        self._cost_guard = cost_guard

    def get_chain(
        self,
        service: str,
        tier: str = "standard",
        preferred_model: Optional[str] = None,
        fallback_chain: Optional[list[str]] = None,
    ) -> list[str]:
        """Construye la cadena de modelos a intentar."""
        defaults = SERVICE_DEFAULTS.get(service, {}).get(tier, {})
        if not defaults:
            defaults = SERVICE_DEFAULTS.get(service, {}).get("standard", {})

        primary = preferred_model or defaults.get("preferred_model", "claude-sonnet-4")
        chain = fallback_chain if fallback_chain is not None else list(defaults.get("fallback_chain", []))

        # Primary siempre primero, sin duplicados
        result = [primary]
        for m in chain:
            if m != primary and m in MODEL_API_IDS:
                result.append(m)
        return result

    async def get_consultant_chain(
        self,
        service: str,
        consultant_id: Optional[str] = None,
        tier_override: Optional[str] = None,
        model_override: Optional[str] = None,
    ) -> list[str]:
        """Obtiene la cadena configurada por el consultor, o defaults."""
        if model_override and model_override in MODEL_API_IDS:
            # Override directo desde UI: ese modelo + fallback del tier correspondiente
            tier = tier_override or "standard"
            defaults = SERVICE_DEFAULTS.get(service, {}).get(tier, {})
            if not defaults:
                defaults = SERVICE_DEFAULTS.get(service, {}).get("standard", {})
            fallback = list(defaults.get("fallback_chain", []))
            return self.get_chain(service, tier, model_override, fallback)

        if consultant_id and self._cost_guard:
            config = await self._cost_guard.get_model_config(consultant_id, service)
            if config:
                tier = tier_override or config.get("tier", "standard")
                return self.get_chain(
                    service, tier,
                    config.get("preferred_model"),
                    config.get("fallback_chain"),
                )

        tier = tier_override or "standard"
        return self.get_chain(service, tier)

    async def call_anthropic(
        self,
        model: str,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 32000,
        thinking_budget: Optional[int] = None,
        tools: Optional[list] = None,
        temperature: float = 1.0,
        stream: bool = False,
    ):
        """Llama a un modelo Anthropic. Devuelve el response raw."""
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=self._anthropic_key, max_retries=4)
        api_model = MODEL_API_IDS.get(model, model)

        kwargs: dict[str, Any] = {
            "model": api_model,
            "max_tokens": max_tokens,
            "system": system_prompt,
            "messages": messages,
        }
        if thinking_budget:
            kwargs["thinking"] = {"type": "adaptive", "budget_tokens": thinking_budget}
        else:
            kwargs["temperature"] = temperature
        if tools:
            kwargs["tools"] = tools

        if stream:
            return client.messages.stream(**kwargs)

        return await client.messages.create(**kwargs)

    async def call_openai(
        self,
        model: str,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 16384,
        tools: Optional[list] = None,
        temperature: float = 0.7,
        web_search: bool = False,
    ):
        """Llama a un modelo OpenAI. Devuelve el response raw.

        Si web_search=True, usa la Responses API con web_search_preview.
        Si no, usa Chat Completions (compatible con todos los modelos).
        """
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=self._openai_key)
        api_model = MODEL_API_IDS.get(model, model)

        if web_search:
            return await self._call_openai_responses(
                client, api_model, model, system_prompt, messages, max_tokens,
            )

        openai_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                text = " ".join(
                    b["text"] for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
                content = text if text else str(content)
            openai_messages.append({"role": msg["role"], "content": content})

        # GPT-5+, o3, o4-mini requieren max_completion_tokens en vez de max_tokens
        _NEW_PARAM_MODELS = {"gpt-5.2", "gpt-5", "gpt-5-mini", "o3", "o4-mini"}
        token_param = "max_completion_tokens" if model in _NEW_PARAM_MODELS else "max_tokens"

        kwargs: dict[str, Any] = {
            "model": api_model,
            token_param: max_tokens,
            "temperature": temperature,
            "messages": openai_messages,
        }

        response = await client.chat.completions.create(**kwargs)
        return response

    async def _call_openai_responses(
        self,
        client,
        api_model: str,
        model: str,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int,
    ):
        """Llama a OpenAI via Responses API con web_search_preview."""
        # Construir input para Responses API
        input_items = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                text = " ".join(
                    b["text"] for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
                content = text if text else str(content)
            input_items.append({"role": msg["role"], "content": content})

        response = await client.responses.create(
            model=api_model,
            input=input_items,
            tools=[{"type": "web_search_preview"}],
            max_output_tokens=max_tokens,
        )
        return response

    async def call_google(
        self,
        model: str,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 32000,
        temperature: float = 0.7,
        thinking_budget: Optional[int] = None,
        web_search: bool = False,
    ):
        """Llama a un modelo Google Gemini. Devuelve el response raw."""
        from google import genai
        from google.genai import types as genai_types

        client = genai.Client(api_key=self._gemini_key)
        api_model = MODEL_API_IDS.get(model, model)

        gemini_contents = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            content = msg.get("content", "")
            if isinstance(content, list):
                text = " ".join(
                    b["text"] for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
                content = text if text else str(content)
            gemini_contents.append(
                genai_types.Content(
                    role=role,
                    parts=[genai_types.Part(text=content)],
                )
            )

        # Thinking config con budget
        thinking_cfg = genai_types.ThinkingConfig(include_thoughts=True)
        if thinking_budget:
            thinking_cfg = genai_types.ThinkingConfig(
                include_thoughts=True,
                thinking_budget=thinking_budget,
            )

        # Google Search grounding tool
        tools = None
        if web_search:
            tools = [genai_types.Tool(google_search=genai_types.GoogleSearch())]

        response = await client.aio.models.generate_content(
            model=api_model,
            contents=gemini_contents,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=max_tokens,
                temperature=temperature,
                thinking_config=thinking_cfg,
                tools=tools,
            ),
        )
        return response

    async def execute(
        self,
        service: str,
        system_prompt: str,
        messages: list[dict],
        consultant_id: Optional[str] = None,
        project_id: Optional[str] = None,
        tier: Optional[str] = None,
        model_override: Optional[str] = None,
        operation: Optional[str] = None,
        max_tokens: int = 32000,
        thinking_budget: Optional[int] = None,
        tools: Optional[list] = None,
        temperature: float = 0.7,
    ) -> ModelCallResult:
        """Ejecuta una llamada con fallback chain y cost guard.

        Intenta cada modelo de la cadena. Si uno falla o esta bloqueado
        por el cost guard, pasa al siguiente.
        """
        chain = await self.get_consultant_chain(
            service, consultant_id, tier, model_override
        )
        op = operation or service
        errors = []

        for i, model in enumerate(chain):
            provider = MODEL_PROVIDERS.get(model, "unknown")

            # Verificar que tenemos API key para este proveedor
            if provider == "anthropic" and not self._anthropic_key:
                continue
            if provider == "openai" and not self._openai_key:
                continue
            if provider == "google" and not self._gemini_key:
                continue

            # Cost Guard check
            if self._cost_guard and consultant_id:
                check = await self._cost_guard.check(provider, consultant_id)
                if not check.allowed:
                    logger.info(f"CostGuard blocked {model}: {check.reason}")
                    errors.append(f"{model}: {check.reason}")
                    continue

            # Ejecutar llamada
            start = time.monotonic()
            try:
                result = await self._call_model(
                    model, provider, system_prompt, messages,
                    max_tokens, thinking_budget, tools, temperature,
                )

                duration_ms = int((time.monotonic() - start) * 1000)

                # Registrar coste
                if self._cost_guard:
                    await self._cost_guard.record(
                        model=model, service=service, operation=op,
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                        duration_ms=duration_ms,
                        consultant_id=consultant_id,
                        project_id=project_id,
                        success=True,
                        metadata={"tier": tier or "standard", "fallback_index": i},
                    )

                result.duration_ms = duration_ms
                result.fallback_used = i > 0
                if check_result := (await self._cost_guard.check(provider, consultant_id) if self._cost_guard and consultant_id else None):
                    result.warning = getattr(check_result, "warning", "")

                return result

            except Exception as e:
                duration_ms = int((time.monotonic() - start) * 1000)
                err_msg = str(e)
                is_overloaded = "overloaded" in err_msg.lower()
                logger.warning(f"ModelRouter: {model} failed (overloaded={is_overloaded}): {err_msg[:200]}")
                errors.append(f"{model}: {err_msg[:100]}")

                # Registrar fallo
                if self._cost_guard:
                    await self._cost_guard.record(
                        model=model, service=service, operation=op,
                        input_tokens=0, output_tokens=0,
                        duration_ms=duration_ms,
                        consultant_id=consultant_id,
                        project_id=project_id,
                        success=False,
                        metadata={"error": err_msg[:500]},
                    )

                continue

        # Todos los modelos fallaron
        raise RuntimeError(
            f"Todos los modelos agotados para {service}. Errores: {'; '.join(errors)}"
        )

    async def _call_model(
        self,
        model: str,
        provider: str,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int,
        thinking_budget: Optional[int],
        tools: Optional[list],
        temperature: float,
        web_search: bool = False,
    ) -> ModelCallResult:
        """Llama al modelo y normaliza la respuesta."""

        if provider == "anthropic":
            response = await self.call_anthropic(
                model, system_prompt, messages,
                max_tokens=max_tokens,
                thinking_budget=thinking_budget,
                tools=tools,
                temperature=temperature,
            )
            text = ""
            web_sources = []
            for block in response.content:
                if block.type == "text":
                    text = block.text
                elif block.type == "web_search_tool_result":
                    for item in getattr(block, "content", []):
                        if getattr(item, "type", None) == "web_search_result":
                            web_sources.append({
                                "title": getattr(item, "title", ""),
                                "url": getattr(item, "url", ""),
                            })

            usage = response.usage
            return ModelCallResult(
                text=text,
                model_used=model,
                provider=provider,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                web_sources=web_sources,
                raw_response=response,
            )

        elif provider == "openai":
            response = await self.call_openai(
                model, system_prompt, messages,
                max_tokens=max_tokens,
                temperature=temperature,
                web_search=web_search,
            )
            web_sources = []
            if web_search:
                # Responses API: extraer texto y fuentes web
                text = _extract_openai_responses_text(response)
                web_sources = _extract_openai_web_sources(response)
                usage = getattr(response, "usage", None)
                input_tokens = getattr(usage, "input_tokens", 0) if usage else 0
                output_tokens = getattr(usage, "output_tokens", 0) if usage else 0
            else:
                # Chat Completions API
                text = response.choices[0].message.content or ""
                usage = response.usage
                input_tokens = usage.prompt_tokens if usage else 0
                output_tokens = usage.completion_tokens if usage else 0

            return ModelCallResult(
                text=text,
                model_used=model,
                provider=provider,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                web_sources=web_sources,
                raw_response=response,
            )

        elif provider == "google":
            response = await self.call_google(
                model, system_prompt, messages,
                max_tokens=max_tokens,
                temperature=temperature,
                thinking_budget=thinking_budget,
                web_search=web_search,
            )
            text = response.text or ""
            web_sources = _extract_google_web_sources(response)
            usage_meta = getattr(response, "usage_metadata", None)
            input_tokens = getattr(usage_meta, "prompt_token_count", 0) if usage_meta else 0
            output_tokens = getattr(usage_meta, "candidates_token_count", 0) if usage_meta else 0
            return ModelCallResult(
                text=text,
                model_used=model,
                provider=provider,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                web_sources=web_sources,
                raw_response=response,
            )

        raise ValueError(f"Proveedor no soportado: {provider}")
