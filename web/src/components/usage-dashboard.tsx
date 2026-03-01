"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Activity,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Types ────────────────────────────────────────────────────

interface UsageRecord {
  created_at: string;
  provider: string;
  model: string;
  service: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
}

interface ProviderSpending {
  daily: number;
  monthly: number;
}

interface UsageStats {
  records: UsageRecord[];
  provider_spending: Record<string, ProviderSpending>;
  global_spending: { daily: number; monthly: number };
  limits: Record<string, number | boolean>;
}

interface CostLimits {
  anthropic_daily_limit: number;
  anthropic_monthly_limit: number;
  openai_daily_limit: number;
  openai_monthly_limit: number;
  google_daily_limit: number;
  google_monthly_limit: number;
  global_daily_limit: number;
  global_monthly_limit: number;
  alert_threshold_pct: number;
  auto_fallback: boolean;
  block_on_global_limit: boolean;
}

// ── Constants ────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#307177",
  openai: "#10a37f",
  google: "#4285f4",
};

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4": "Sonnet 4",
  "claude-haiku-4-5": "Haiku 4.5",
  "gpt-5.2": "GPT-5.2",
  "gpt-5": "GPT-5",
  "o3": "o3",
  "o4-mini": "o4-mini",
  "gpt-5-mini": "GPT-5 Mini",
  "gemini-2.5-pro": "Gemini Pro",
  "gemini-2.5-flash": "Gemini Flash",
};

const SERVICE_LABELS: Record<string, string> = {
  advisor: "Asesor IA",
  analysis: "Analisis",
  rag_query: "RAG Query",
  pipeline: "Pipeline",
  embedding: "Embeddings",
};

// ── Helpers ──────────────────────────────────────────────────

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatCostShort(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function aggregateByDay(records: UsageRecord[]): Array<{
  day: string;
  anthropic: number;
  openai: number;
  google: number;
  total: number;
}> {
  const map: Record<string, { anthropic: number; openai: number; google: number }> = {};
  for (const r of records) {
    const day = r.created_at.slice(0, 10);
    if (!map[day]) map[day] = { anthropic: 0, openai: 0, google: 0 };
    const provider = r.provider as keyof typeof map[string];
    if (provider in map[day]) {
      map[day][provider] += r.cost_usd;
    }
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, costs]) => ({
      day: day.slice(5), // MM-DD
      anthropic: Number(costs.anthropic.toFixed(4)),
      openai: Number(costs.openai.toFixed(4)),
      google: Number(costs.google.toFixed(4)),
      total: Number((costs.anthropic + costs.openai + costs.google).toFixed(4)),
    }));
}

function aggregateByService(records: UsageRecord[]): Array<{
  service: string;
  label: string;
  cost: number;
  calls: number;
}> {
  const map: Record<string, { cost: number; calls: number }> = {};
  for (const r of records) {
    if (!map[r.service]) map[r.service] = { cost: 0, calls: 0 };
    map[r.service].cost += r.cost_usd;
    map[r.service].calls += 1;
  }
  return Object.entries(map)
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([service, data]) => ({
      service,
      label: SERVICE_LABELS[service] || service,
      cost: Number(data.cost.toFixed(4)),
      calls: data.calls,
    }));
}

function aggregateByModel(records: UsageRecord[]): Array<{
  model: string;
  label: string;
  cost: number;
  calls: number;
}> {
  const map: Record<string, { cost: number; calls: number }> = {};
  for (const r of records) {
    if (!map[r.model]) map[r.model] = { cost: 0, calls: 0 };
    map[r.model].cost += r.cost_usd;
    map[r.model].calls += 1;
  }
  return Object.entries(map)
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([model, data]) => ({
      model,
      label: MODEL_LABELS[model] || model,
      cost: Number(data.cost.toFixed(4)),
      calls: data.calls,
    }));
}

// ── Component ────────────────────────────────────────────────

export function UsageDashboard({ consultantId }: { consultantId: string }) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [limits, setLimits] = useState<CostLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [showRecent, setShowRecent] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, limitsRes] = await Promise.all([
        fetch(`/api/usage-stats?days=${days}`),
        fetch(`/api/cost-limits`),
      ]);
      if (statsRes.ok) {
        setStats(await statsRes.json());
      } else {
        const errData = await statsRes.json().catch(() => ({}));
        setError(errData.error || `Error cargando estadisticas (${statsRes.status})`);
      }
      if (limitsRes.ok) {
        setLimits(await limitsRes.json());
      } else if (!error) {
        const errData = await limitsRes.json().catch(() => ({}));
        setError(errData.error || `Error cargando limites (${limitsRes.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de conexion");
    }
    setLoading(false);
  }, [consultantId, days]);

  useEffect(() => {
    if (consultantId) fetchData();
  }, [consultantId, fetchData]);

  async function handleSaveLimits() {
    if (!limits) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/cost-limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limits),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || `Error guardando limites (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando limites");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-vandarum-teal" />
      </div>
    );
  }

  const records = stats?.records || [];
  const globalSpending = stats?.global_spending || { daily: 0, monthly: 0 };
  const providerSpending = stats?.provider_spending || {};
  const dailyData = aggregateByDay(records);
  const serviceData = aggregateByService(records);
  const modelData = aggregateByModel(records);
  const totalCalls = records.length;
  const totalCost = records.reduce((sum, r) => sum + r.cost_usd, 0);
  const avgCost = totalCalls > 0 ? totalCost / totalCalls : 0;
  const totalInputTokens = records.reduce((sum, r) => sum + r.input_tokens, 0);
  const totalOutputTokens = records.reduce((sum, r) => sum + r.output_tokens, 0);

  const PIE_COLORS = ["#307177", "#10a37f", "#4285f4", "#f59e0b", "#8b5cf6", "#ef4444"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-vandarum-teal" />
          <h3 className="text-lg font-semibold">Dashboard de Costes IA</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border bg-background px-2 py-1 text-xs"
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
          <Button variant="ghost" size="sm" onClick={fetchData}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-vandarum-teal" />
              <span className="text-xs text-muted-foreground">Hoy</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{formatCostShort(globalSpending.daily)}</p>
            {limits && (
              <p className="text-xs text-muted-foreground">
                de ${Number(limits.global_daily_limit).toFixed(2)} limite
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-vandarum-teal" />
              <span className="text-xs text-muted-foreground">Este mes</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{formatCostShort(globalSpending.monthly)}</p>
            {limits && (
              <p className="text-xs text-muted-foreground">
                de ${Number(limits.global_monthly_limit).toFixed(2)} limite
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-vandarum-teal" />
              <span className="text-xs text-muted-foreground">Consultas ({days}d)</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{totalCalls}</p>
            <p className="text-xs text-muted-foreground">
              media {formatCost(avgCost)}/consulta
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-vandarum-teal" />
              <span className="text-xs text-muted-foreground">Tokens ({days}d)</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{formatTokens(totalInputTokens + totalOutputTokens)}</p>
            <p className="text-xs text-muted-foreground">
              {formatTokens(totalInputTokens)} in / {formatTokens(totalOutputTokens)} out
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Provider spending bars */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Gasto por proveedor</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(["anthropic", "openai", "google"] as const).map((provider) => {
              const spent = providerSpending[provider]?.monthly || 0;
              const limit = limits
                ? Number(limits[`${provider}_monthly_limit` as keyof CostLimits] || 100)
                : 100;
              const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
              const alertPct = limits?.alert_threshold_pct || 80;
              const isWarning = pct >= alertPct;

              return (
                <div key={provider}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium capitalize">{provider}</span>
                    <span className={isWarning ? "text-amber-500 font-medium" : "text-muted-foreground"}>
                      {isWarning && <AlertTriangle className="inline h-3 w-3 mr-1" />}
                      {formatCostShort(spent)} / ${limit.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: isWarning ? "#f59e0b" : PROVIDER_COLORS[provider],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      {records.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Daily Cost Line Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Coste diario por proveedor</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    formatter={(value) => formatCost(Number(value))}
                    labelFormatter={(label) => `Dia: ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="anthropic" stroke="#307177" strokeWidth={2} dot={false} name="Anthropic" />
                  <Line type="monotone" dataKey="openai" stroke="#10a37f" strokeWidth={2} dot={false} name="OpenAI" />
                  <Line type="monotone" dataKey="google" stroke="#4285f4" strokeWidth={2} dot={false} name="Google" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Service Distribution Pie */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Distribucion por servicio</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={serviceData}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="cost"
                    nameKey="label"
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      (percent || 0) > 0.05 ? `${name || ""} ${((percent || 0) * 100).toFixed(0)}%` : ""
                    }
                    labelLine={false}
                  >
                    {serviceData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCost(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Model Breakdown Bar Chart */}
      {modelData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Coste por modelo</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={modelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={90} />
                <Tooltip
                  formatter={(value, name) => [
                    formatCost(Number(value)),
                    name === "cost" ? "Coste" : String(name),
                  ]}
                />
                <Bar dataKey="cost" fill="#307177" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Cost Limits Configuration */}
      {limits && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Limites de gasto (circuit breaker)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {(["anthropic", "openai", "google"] as const).map((provider) => (
                <div key={provider} className="space-y-2">
                  <h4 className="text-xs font-medium capitalize">{provider}</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Diario ($)</label>
                      <input
                        type="number"
                        step="0.50"
                        min="0"
                        value={limits[`${provider}_daily_limit` as keyof CostLimits] as number}
                        onChange={(e) =>
                          setLimits({
                            ...limits,
                            [`${provider}_daily_limit`]: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded border bg-background px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Mensual ($)</label>
                      <input
                        type="number"
                        step="5"
                        min="0"
                        value={limits[`${provider}_monthly_limit` as keyof CostLimits] as number}
                        onChange={(e) =>
                          setLimits({
                            ...limits,
                            [`${provider}_monthly_limit`]: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded border bg-background px-2 py-1 text-xs"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <div className="space-y-2">
                <h4 className="text-xs font-medium">Global</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Diario ($)</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={limits.global_daily_limit}
                      onChange={(e) =>
                        setLimits({ ...limits, global_daily_limit: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full rounded border bg-background px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Mensual ($)</label>
                    <input
                      type="number"
                      step="10"
                      min="0"
                      value={limits.global_monthly_limit}
                      onChange={(e) =>
                        setLimits({ ...limits, global_monthly_limit: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full rounded border bg-background px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4 border-t pt-3">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={limits.auto_fallback}
                  onChange={(e) => setLimits({ ...limits, auto_fallback: e.target.checked })}
                  className="rounded"
                />
                Fallback automatico si limite alcanzado
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={limits.block_on_global_limit}
                  onChange={(e) => setLimits({ ...limits, block_on_global_limit: e.target.checked })}
                  className="rounded"
                />
                Bloquear si limite global alcanzado
              </label>
              <div className="flex items-center gap-1 text-xs">
                <span>Alerta al</span>
                <input
                  type="number"
                  min="50"
                  max="100"
                  value={limits.alert_threshold_pct}
                  onChange={(e) =>
                    setLimits({ ...limits, alert_threshold_pct: parseInt(e.target.value) || 80 })
                  }
                  className="w-14 rounded border bg-background px-1 py-0.5 text-xs text-center"
                />
                <span>%</span>
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={handleSaveLimits} disabled={saving}>
                {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Guardar limites
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Operations Table */}
      <Card>
        <CardHeader className="pb-2">
          <button
            onClick={() => setShowRecent(!showRecent)}
            className="flex w-full items-center justify-between"
          >
            <CardTitle className="text-sm">Ultimas operaciones</CardTitle>
            {showRecent ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </CardHeader>
        {showRecent && (
          <CardContent>
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1.5 pr-2">Fecha</th>
                    <th className="py-1.5 pr-2">Servicio</th>
                    <th className="py-1.5 pr-2">Modelo</th>
                    <th className="py-1.5 pr-2 text-right">Tokens</th>
                    <th className="py-1.5 pr-2 text-right">Coste</th>
                    <th className="py-1.5 text-right">Duracion</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-muted/30">
                      <td className="py-1 pr-2 text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("es-ES", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-1 pr-2">
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {SERVICE_LABELS[r.service] || r.service}
                        </Badge>
                      </td>
                      <td className="py-1 pr-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full mr-1"
                          style={{ backgroundColor: PROVIDER_COLORS[r.provider] || "#999" }}
                        />
                        {MODEL_LABELS[r.model] || r.model}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {formatTokens(r.input_tokens + r.output_tokens)}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {formatCost(r.cost_usd)}
                      </td>
                      <td className="py-1 text-right text-muted-foreground">
                        {r.duration_ms > 0 ? `${(r.duration_ms / 1000).toFixed(1)}s` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Business Metrics */}
      {totalCalls > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Metricas de negocio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3 text-xs">
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-muted-foreground">Coste medio por consulta advisor</p>
                <p className="mt-1 text-lg font-bold">
                  {formatCostShort(
                    records.filter((r) => r.service === "advisor").reduce((s, r) => s + r.cost_usd, 0) /
                      Math.max(records.filter((r) => r.service === "advisor").length, 1)
                  )}
                </p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-muted-foreground">Coste medio por analisis</p>
                <p className="mt-1 text-lg font-bold">
                  {formatCostShort(
                    records.filter((r) => r.service === "analysis").reduce((s, r) => s + r.cost_usd, 0) /
                      Math.max(records.filter((r) => r.service === "analysis").length, 1)
                  )}
                </p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-muted-foreground">Proyeccion mensual</p>
                <p className="mt-1 text-lg font-bold">
                  {formatCostShort((totalCost / Math.max(days, 1)) * 30)}
                </p>
                <p className="text-muted-foreground">basado en {days} dias</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {records.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No hay datos de uso todavia. Los costes se registraran automaticamente con cada consulta.
        </div>
      )}
    </div>
  );
}
