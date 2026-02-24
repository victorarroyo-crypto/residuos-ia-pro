"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Edit3,
  Sparkles,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  ClipboardList,
  Receipt,
  BookOpen,
  Scale,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdvisorChat } from "@/components/advisor-chat";
import type { AnalysisContext } from "@/components/advisor-chat";

// ─── Types ──────────────────────────────────────────────────────

interface AgentPlan {
  id: string;
  enabled: boolean;
  reason: string;
  focus: string;
  data_available: Record<string, unknown>;
}

interface AnalysisPlan {
  agents: AgentPlan[];
  data_summary: Record<string, unknown>;
  data_gaps: string[];
}

export interface PlanReviewProps {
  projectId: string;
  projectName: string;
  plan: AnalysisPlan;
  onApprove: (agents: string[], instructions: string, agentFocus: Record<string, string>) => void;
  onCancel: () => void;
  loading?: boolean;
}

// ─── Agent display config ───────────────────────────────────────

const AGENT_CONFIG: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  aai: { label: "AAI", icon: FileText, color: "text-blue-600" },
  contratos: { label: "Contratos", icon: ClipboardList, color: "text-purple-600" },
  facturas: { label: "Facturas", icon: Receipt, color: "text-green-600" },
  registro: { label: "Registro", icon: BookOpen, color: "text-orange-600" },
  normativo: { label: "Normativo", icon: Scale, color: "text-red-600" },
};

// ─── Component ──────────────────────────────────────────────────

export function AnalysisPlanReview({
  projectId,
  projectName,
  plan,
  onApprove,
  onCancel,
  loading = false,
}: PlanReviewProps) {
  const [agentStates, setAgentStates] = useState<Record<string, boolean>>(() => {
    const states: Record<string, boolean> = {};
    for (const agent of plan.agents) {
      states[agent.id] = agent.enabled;
    }
    return states;
  });

  const [focusEdits, setFocusEdits] = useState<Record<string, string>>(() => {
    const edits: Record<string, string> = {};
    for (const agent of plan.agents) {
      edits[agent.id] = agent.focus;
    }
    return edits;
  });

  const [editingFocus, setEditingFocus] = useState<string | null>(null);
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [instructions, setInstructions] = useState("");

  const enabledAgents = plan.agents.filter((a) => agentStates[a.id]);
  const summary = plan.data_summary;

  function toggleAgent(id: string) {
    setAgentStates((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function updateFocus(id: string, focus: string) {
    setFocusEdits((prev) => ({ ...prev, [id]: focus }));
  }

  function handleApprove() {
    const selectedAgents = Object.entries(agentStates)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const agentFocus: Record<string, string> = {};
    for (const [id, focus] of Object.entries(focusEdits)) {
      if (focus && agentStates[id]) {
        agentFocus[id] = focus;
      }
    }

    onApprove(selectedAgents, instructions, agentFocus);
  }

  const analysisContext: AnalysisContext = {
    phase: "plan_review",
    plan: plan as unknown as Record<string, unknown>,
    projectName,
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-vandarum-teal" />
            Plan de Analisis
          </h3>
          <p className="text-sm text-muted-foreground">
            El coordinador IA ha analizado los datos de <strong>{projectName}</strong> y propone este plan
          </p>
        </div>
      </div>

      {/* Data summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Documentos", value: summary.total_documents ?? 0 },
          { label: "Residuos", value: summary.inventory_items ?? 0 },
          { label: "Contratos", value: summary.contracts ?? 0 },
          { label: "Facturas", value: summary.invoice_lines ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border p-2 text-center">
            <div className="text-lg font-bold">{String(value)}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {/* Data gaps */}
      {plan.data_gaps && plan.data_gaps.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 p-3">
          <p className="text-sm font-medium flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Carencias de datos detectadas
          </p>
          <ul className="text-sm text-muted-foreground space-y-0.5">
            {plan.data_gaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-amber-500 mt-0.5">-</span>
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Agent cards */}
      <div className="space-y-2">
        {plan.agents.map((agent) => {
          const config = AGENT_CONFIG[agent.id] || { label: agent.id, icon: FileText, color: "text-gray-600" };
          const Icon = config.icon;
          const isEnabled = agentStates[agent.id];
          const isEditing = editingFocus === agent.id;

          return (
            <div
              key={agent.id}
              className={`rounded-lg border p-3 transition-colors ${
                isEnabled ? "bg-background" : "bg-muted/50 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 flex-1">
                  <button
                    onClick={() => toggleAgent(agent.id)}
                    className={`mt-0.5 rounded border-2 w-5 h-5 flex items-center justify-center transition-colors ${
                      isEnabled
                        ? "bg-vandarum-teal border-vandarum-teal text-white"
                        : "border-muted-foreground/30"
                    }`}
                  >
                    {isEnabled && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Icon className={`h-4 w-4 ${config.color}`} />
                      <span className="font-medium text-sm">{config.label}</span>
                      {!agent.enabled && isEnabled && (
                        <Badge variant="outline" className="text-[10px]">Activado manualmente</Badge>
                      )}
                      {agent.enabled && !isEnabled && (
                        <Badge variant="outline" className="text-[10px] text-amber-600">Desactivado</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{agent.reason}</p>

                    {isEnabled && (
                      <div className="mt-1.5">
                        {isEditing ? (
                          <div className="space-y-1">
                            <textarea
                              value={focusEdits[agent.id] || ""}
                              onChange={(e) => updateFocus(agent.id, e.target.value)}
                              className="w-full text-xs rounded border bg-background p-2 outline-none focus:ring-1 focus:ring-vandarum-teal/30 resize-none"
                              rows={2}
                              placeholder="Describe el foco especifico para este agente..."
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs"
                              onClick={() => setEditingFocus(null)}
                            >
                              Guardar
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-start gap-1">
                            <p className="text-xs text-vandarum-teal flex-1">
                              <strong>Foco:</strong> {focusEdits[agent.id] || "Sin foco especifico"}
                            </p>
                            <button
                              onClick={() => setEditingFocus(agent.id)}
                              className="text-muted-foreground hover:text-foreground p-0.5"
                              title="Editar foco"
                            >
                              <Edit3 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Instructions textarea */}
      <div>
        <label className="text-sm font-medium mb-1 block">
          Instrucciones adicionales (opcional)
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Ej: El cliente tiene inspeccion en marzo. Centra el normativo en residuos peligrosos y plazos de almacenamiento."
          className="w-full rounded-lg border bg-background p-2.5 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20 resize-none"
          rows={3}
        />
      </div>

      {/* Advisor toggle */}
      <button
        onClick={() => setShowAdvisor(!showAdvisor)}
        className="w-full flex items-center justify-between rounded-lg border p-2.5 text-sm hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-vandarum-teal" />
          Consultar al Asesor IA sobre el plan
        </span>
        {showAdvisor ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {showAdvisor && (
        <div className="border rounded-lg p-3">
          <AdvisorChat
            projectId={projectId}
            analysisContext={analysisContext}
            compact
            placeholder="Pregunta sobre el plan propuesto..."
            emptyMessage="Pregunta al asesor sobre el plan de analisis. Puede ayudarte a ajustar el foco o las instrucciones."
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-2 border-t">
        <Button variant="outline" onClick={onCancel} disabled={loading}>
          Cancelar
        </Button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {enabledAgents.length} agente{enabledAgents.length !== 1 ? "s" : ""} seleccionado{enabledAgents.length !== 1 ? "s" : ""}
          </span>
          <Button
            onClick={handleApprove}
            disabled={loading || enabledAgents.length === 0}
            className="bg-vandarum-teal hover:bg-vandarum-teal/90"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Ejecutando...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Aprobar y ejecutar
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
