"""
COST GUARD - Circuit breaker de costes
=========================================
Controla el gasto por proveedor (Anthropic, OpenAI, Google) con:
- Limites diarios y mensuales por proveedor
- Limite global (todos los proveedores)
- Alerta al X% del limite
- Registro de cada llamada API con coste calculado

Uso:
    guard = CostGuard(supabase_url, supabase_key)
    can, reason, warning = await guard.check("anthropic", consultant_id)
    if not can:
        raise HTTPException(429, reason)
    # ... llamar API ...
    await guard.record("anthropic", "claude-sonnet-4", "advisor", "advisor_stream",
                       input_tokens, output_tokens, cost, duration_ms, consultant_id)
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from supabase import create_client, Client

logger = logging.getLogger(__name__)

# ── Precios por millon de tokens ─────────────────────────────────

MODEL_PRICING: dict[str, dict] = {
    # Anthropic
    "claude-opus-4-6":          {"input": 15.0,  "output": 75.0,  "provider": "anthropic"},
    "claude-sonnet-4":          {"input": 3.0,   "output": 15.0,  "provider": "anthropic"},
    "claude-haiku-4-5":         {"input": 0.80,  "output": 4.0,   "provider": "anthropic"},
    # OpenAI - Chat
    "gpt-5.2":                  {"input": 1.75,  "output": 14.0,  "provider": "openai"},
    "gpt-5":                    {"input": 1.25,  "output": 10.0,  "provider": "openai"},
    "o3":                       {"input": 2.0,   "output": 8.0,   "provider": "openai"},
    "o4-mini":                  {"input": 1.10,  "output": 4.40,  "provider": "openai"},
    "gpt-5-mini":               {"input": 0.25,  "output": 2.0,   "provider": "openai"},
    # OpenAI - Embeddings
    "text-embedding-3-large":   {"input": 0.13,  "output": 0.0,   "provider": "openai"},
    # Google
    "gemini-2.5-pro":           {"input": 1.25,  "output": 10.0,  "provider": "google"},
    "gemini-2.5-flash":         {"input": 0.15,  "output": 0.60,  "provider": "google"},
}

# Limites por defecto (USD)
DEFAULT_LIMITS = {
    "anthropic_daily_limit": 10.0,
    "anthropic_monthly_limit": 100.0,
    "openai_daily_limit": 5.0,
    "openai_monthly_limit": 50.0,
    "google_daily_limit": 3.0,
    "google_monthly_limit": 30.0,
    "global_daily_limit": 18.0,
    "global_monthly_limit": 180.0,
    "alert_threshold_pct": 80,
    "auto_fallback": True,
    "block_on_global_limit": False,
}


@dataclass
class CheckResult:
    allowed: bool
    reason: str = ""
    warning: str = ""
    daily_spent: float = 0.0
    daily_limit: float = 0.0
    monthly_spent: float = 0.0
    monthly_limit: float = 0.0


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Calcula el coste en USD de una llamada API."""
    pricing = MODEL_PRICING.get(model)
    if not pricing:
        logger.warning(f"Modelo no encontrado en pricing: {model}, usando coste 0")
        return 0.0
    cost = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000
    return round(cost, 6)


def get_provider(model: str) -> str:
    """Obtiene el proveedor de un modelo."""
    pricing = MODEL_PRICING.get(model)
    return pricing["provider"] if pricing else "unknown"


class CostGuard:
    """Circuit breaker de costes por proveedor."""

    def __init__(self, supabase_url: str, supabase_key: str):
        self._url = supabase_url
        self._key = supabase_key

    def _client(self) -> Client:
        return create_client(self._url, self._key)

    async def check(self, provider: str, consultant_id: Optional[str]) -> CheckResult:
        """Verifica si el consultor puede hacer una llamada al proveedor.

        Returns:
            CheckResult con allowed=True/False, reason si bloqueado, warning si cerca del limite.
        """
        if not consultant_id:
            return CheckResult(allowed=True)

        try:
            sb = self._client()

            # Obtener limites del consultor
            limits = await self._get_limits(sb, consultant_id)

            # Obtener gasto actual del proveedor
            spending = sb.rpc("get_provider_spending", {
                "p_consultant_id": consultant_id,
                "p_provider": provider,
            }).execute()

            daily_spent = 0.0
            monthly_spent = 0.0
            if spending.data and len(spending.data) > 0:
                daily_spent = float(spending.data[0].get("daily_total", 0))
                monthly_spent = float(spending.data[0].get("monthly_total", 0))

            # Limites del proveedor
            daily_limit = float(limits.get(f"{provider}_daily_limit", 999999))
            monthly_limit = float(limits.get(f"{provider}_monthly_limit", 999999))
            alert_pct = int(limits.get("alert_threshold_pct", 80))

            # Verificar limite mensual
            if monthly_spent >= monthly_limit:
                return CheckResult(
                    allowed=False,
                    reason=f"Limite mensual de {provider} alcanzado: ${monthly_spent:.2f}/${monthly_limit:.2f}",
                    daily_spent=daily_spent, daily_limit=daily_limit,
                    monthly_spent=monthly_spent, monthly_limit=monthly_limit,
                )

            # Verificar limite diario
            if daily_spent >= daily_limit:
                return CheckResult(
                    allowed=False,
                    reason=f"Limite diario de {provider} alcanzado: ${daily_spent:.2f}/${daily_limit:.2f}",
                    daily_spent=daily_spent, daily_limit=daily_limit,
                    monthly_spent=monthly_spent, monthly_limit=monthly_limit,
                )

            # Verificar limite global
            if limits.get("block_on_global_limit"):
                global_spending = sb.rpc("get_global_spending", {
                    "p_consultant_id": consultant_id,
                }).execute()
                if global_spending.data and len(global_spending.data) > 0:
                    global_daily = float(global_spending.data[0].get("daily_total", 0))
                    global_monthly = float(global_spending.data[0].get("monthly_total", 0))
                    global_daily_limit = float(limits.get("global_daily_limit", 999999))
                    global_monthly_limit = float(limits.get("global_monthly_limit", 999999))

                    if global_monthly >= global_monthly_limit:
                        return CheckResult(
                            allowed=False,
                            reason=f"Limite global mensual alcanzado: ${global_monthly:.2f}/${global_monthly_limit:.2f}",
                        )
                    if global_daily >= global_daily_limit:
                        return CheckResult(
                            allowed=False,
                            reason=f"Limite global diario alcanzado: ${global_daily:.2f}/${global_daily_limit:.2f}",
                        )

            # Warning si cerca del limite
            warning = ""
            daily_pct = (daily_spent / daily_limit * 100) if daily_limit > 0 else 0
            monthly_pct = (monthly_spent / monthly_limit * 100) if monthly_limit > 0 else 0

            if monthly_pct >= alert_pct:
                warning = f"Aviso: {provider} al {monthly_pct:.0f}% del limite mensual (${monthly_spent:.2f}/${monthly_limit:.2f})"
            elif daily_pct >= alert_pct:
                warning = f"Aviso: {provider} al {daily_pct:.0f}% del limite diario (${daily_spent:.2f}/${daily_limit:.2f})"

            return CheckResult(
                allowed=True,
                warning=warning,
                daily_spent=daily_spent, daily_limit=daily_limit,
                monthly_spent=monthly_spent, monthly_limit=monthly_limit,
            )

        except Exception as e:
            logger.error(f"CostGuard.check error (permitiendo por seguridad): {e}")
            return CheckResult(allowed=True, warning=f"CostGuard error: {e}")

    async def record(
        self,
        model: str,
        service: str,
        operation: str,
        input_tokens: int,
        output_tokens: int,
        duration_ms: int = 0,
        consultant_id: Optional[str] = None,
        project_id: Optional[str] = None,
        success: bool = True,
        metadata: Optional[dict] = None,
    ) -> float:
        """Registra una llamada API y devuelve el coste calculado."""
        provider = get_provider(model)
        cost = calculate_cost(model, input_tokens, output_tokens)

        try:
            sb = self._client()
            row = {
                "consultant_id": consultant_id,
                "service": service,
                "operation": operation,
                "provider": provider,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "cost_usd": cost,
                "duration_ms": duration_ms,
                "project_id": project_id,
                "success": success,
                "metadata": metadata or {},
            }
            sb.table("api_usage_log").insert(row).execute()
            logger.info(
                "CostGuard: %s/%s %s — %d in + %d out = $%.4f (%.0fms)",
                provider, model, operation,
                input_tokens, output_tokens, cost, duration_ms,
            )
        except Exception as e:
            logger.error(f"CostGuard.record error (no bloquea): {e}")

        return cost

    async def get_stats(
        self,
        consultant_id: str,
        days: int = 30,
    ) -> dict:
        """Estadisticas de uso para el dashboard."""
        try:
            sb = self._client()

            # Obtener uso diario agrupado
            result = sb.table("api_usage_log") \
                .select("created_at, provider, model, service, input_tokens, output_tokens, cost_usd, duration_ms") \
                .eq("consultant_id", consultant_id) \
                .gte("created_at", (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()) \
                .order("created_at", desc=True) \
                .limit(1000) \
                .execute()

            # Totales por proveedor
            provider_spending = {}
            for provider in ("anthropic", "openai", "google"):
                spending = sb.rpc("get_provider_spending", {
                    "p_consultant_id": consultant_id,
                    "p_provider": provider,
                }).execute()
                if spending.data and len(spending.data) > 0:
                    provider_spending[provider] = {
                        "daily": float(spending.data[0].get("daily_total", 0)),
                        "monthly": float(spending.data[0].get("monthly_total", 0)),
                    }

            # Global
            global_spending = sb.rpc("get_global_spending", {
                "p_consultant_id": consultant_id,
            }).execute()

            global_data = {"daily": 0, "monthly": 0}
            if global_spending.data and len(global_spending.data) > 0:
                global_data = {
                    "daily": float(global_spending.data[0].get("daily_total", 0)),
                    "monthly": float(global_spending.data[0].get("monthly_total", 0)),
                }

            # Limites
            limits = await self._get_limits(sb, consultant_id)

            return {
                "records": result.data or [],
                "provider_spending": provider_spending,
                "global_spending": global_data,
                "limits": limits,
            }

        except Exception as e:
            logger.error(f"CostGuard.get_stats error: {e}")
            return {"records": [], "provider_spending": {}, "global_spending": {}, "limits": DEFAULT_LIMITS}

    async def update_limits(self, consultant_id: str, limits: dict) -> bool:
        """Actualiza los limites de coste de un consultor."""
        try:
            sb = self._client()
            allowed_keys = set(DEFAULT_LIMITS.keys())
            clean = {k: v for k, v in limits.items() if k in allowed_keys}
            clean["updated_at"] = "now()"

            sb.table("consultant_cost_limits").upsert({
                "consultant_id": consultant_id,
                **clean,
            }, on_conflict="consultant_id").execute()
            return True
        except Exception as e:
            logger.error(f"CostGuard.update_limits error: {e}")
            return False

    async def get_model_config(self, consultant_id: str, service: str) -> dict:
        """Obtiene la config de modelo para un servicio."""
        try:
            sb = self._client()
            result = sb.table("consultant_model_config") \
                .select("*") \
                .eq("consultant_id", consultant_id) \
                .eq("service", service) \
                .maybe_single() \
                .execute()
            return result.data or {}
        except Exception as e:
            logger.error(f"CostGuard.get_model_config error: {e}")
            return {}

    async def update_model_config(
        self,
        consultant_id: str,
        service: str,
        preferred_model: str,
        fallback_chain: list[str],
        tier: str = "standard",
    ) -> bool:
        """Actualiza la config de modelo para un servicio."""
        try:
            sb = self._client()
            sb.table("consultant_model_config").upsert({
                "consultant_id": consultant_id,
                "service": service,
                "preferred_model": preferred_model,
                "fallback_chain": fallback_chain,
                "tier": tier,
                "updated_at": "now()",
            }, on_conflict="consultant_id,service").execute()
            return True
        except Exception as e:
            logger.error(f"CostGuard.update_model_config error: {e}")
            return False

    async def _get_limits(self, sb: Client, consultant_id: str) -> dict:
        """Obtiene limites del consultor, con defaults si no existen."""
        try:
            result = sb.table("consultant_cost_limits") \
                .select("*") \
                .eq("consultant_id", consultant_id) \
                .maybe_single() \
                .execute()
            if result.data:
                return result.data
        except Exception:
            pass
        return dict(DEFAULT_LIMITS)
