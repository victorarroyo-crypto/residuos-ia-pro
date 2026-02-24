"use client";

import { useState } from "react";
import {
  CheckCircle2,
  RotateCcw,
  FileText,
  ClipboardList,
  Receipt,
  BookOpen,
  Scale,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdvisorChat } from "@/components/advisor-chat";
import type { AnalysisContext } from "@/components/advisor-chat";

// ─── Types ──────────────────────────────────────────────────────

interface Finding {
  tipo: string;
  descripcion: string;
  severidad: string;
  ahorro_eur_ano?: number;
  agente?: string;
  norma?: string;
}

interface AgentResult {
  id: string;
  findings: Finding[];
  criticalCount: number;
  highCount: number;
}

export interface Round2Props {
  projectId: string;
  projectName: string;
  agentResults: AgentResult[];
  allFindings: Finding[];
  onLaunchRound2: (agents: string[], instructions: string, agentFocus: Record<string, string>) => void;
  onFinish: () => void;
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

export function AnalysisRound2({
  projectId,
  projectName,
  agentResults,
  allFindings,
  onLaunchRound2,
  onFinish,
  loading = false,
}: Round2Props) {
  const [selectedAgents, setSelectedAgents] = useState<Record<string, boolean>>({});
  const [focusEdits, setFocusEdits] = useState<Record<string, string>>({});
  const [instructions, setInstructions] = useState("");
  const [showAdvisor, setShowAdvisor] = useState(false);

  const enabledAgents = Object.entries(selectedAgents)
    .filter(([, v]) => v)
    .map(([k]) => k);

  function toggleAgent(id: string) {
    setSelectedAgents((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleLaunch() {
    const agentFocus: Record<string, string> = {};
    for (const [id, focus] of Object.entries(focusEdits)) {
      if (focus && selectedAgents[id]) {
        agentFocus[id] = focus;
      }
    }
    onLaunchRound2(enabledAgents, instructions, agentFocus);
  }

  const analysisContext: AnalysisContext = {
    phase: "results_review",
    findings: allFindings as unknown as Record<string, unknown>[],
    projectName,
  };

  return (
    <div className="space-y-4 border-t pt-6 mt-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-vandarum-teal" />
          Profundizar en el analisis?
        </h3>
        <p className="text-sm text-muted-foreground">
          Selecciona agentes para una segunda vuelta con instrucciones mas especificas
        </p>
      </div>

      {/* Agent selection with findings summary */}
      <div className="space-y-2">
        {agentResults.map((result) => {
          const config = AGENT_CONFIG[result.id] || { label: result.id, icon: FileText, color: "text-gray-600" };
          const Icon = config.icon;
          const isSelected = !!selectedAgents[result.id];

          return (
            <div key={result.id} className={`rounded-lg border p-3 transition-colors ${isSelected ? "border-vandarum-teal/50 bg-vandarum-teal/5" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleAgent(result.id)}
                    className={`rounded border-2 w-5 h-5 flex items-center justify-center transition-colors ${
                      isSelected
                        ? "bg-vandarum-teal border-vandarum-teal text-white"
                        : "border-muted-foreground/30"
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </button>
                  <Icon className={`h-4 w-4 ${config.color}`} />
                  <span className="font-medium text-sm">{config.label}</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-xs">
                    {result.findings.length} hallazgo{result.findings.length !== 1 ? "s" : ""}
                  </Badge>
                  {result.criticalCount > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {result.criticalCount} critico{result.criticalCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  {result.highCount > 0 && (
                    <Badge className="text-xs bg-amber-500">
                      {result.highCount} alto{result.highCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </div>

              {isSelected && (
                <div className="mt-2 ml-7">
                  <input
                    type="text"
                    value={focusEdits[result.id] || ""}
                    onChange={(e) => setFocusEdits((prev) => ({ ...prev, [result.id]: e.target.value }))}
                    placeholder="Foco para 2a vuelta: ej. 'Profundizar precios GestorX'"
                    className="w-full rounded border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-vandarum-teal/30"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Instructions */}
      {enabledAgents.length > 0 && (
        <div>
          <label className="text-sm font-medium mb-1 block">
            Instrucciones para la 2a vuelta
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Ej: El contrato con GestorX de 280 EUR/t parece excesivo. Busca alternativas y verifica si hay obligacion de subasta."
            className="w-full rounded-lg border bg-background p-2.5 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20 resize-none"
            rows={3}
          />
        </div>
      )}

      {/* Advisor toggle */}
      <button
        onClick={() => setShowAdvisor(!showAdvisor)}
        className="w-full flex items-center justify-between rounded-lg border p-2.5 text-sm hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-vandarum-teal" />
          Consultar al Asesor IA sobre los resultados
        </span>
        {showAdvisor ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {showAdvisor && (
        <div className="border rounded-lg p-3">
          <AdvisorChat
            projectId={projectId}
            analysisContext={analysisContext}
            compact
            placeholder="Pregunta sobre los resultados del analisis..."
            emptyMessage="Pregunta al asesor sobre los hallazgos. Puede ayudarte a decidir que profundizar en la 2a vuelta."
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-2 border-t">
        <Button variant="outline" onClick={onFinish} disabled={loading}>
          Finalizar sin 2a vuelta
        </Button>

        <Button
          onClick={handleLaunch}
          disabled={loading || enabledAgents.length === 0}
          className="bg-vandarum-teal hover:bg-vandarum-teal/90"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Ejecutando 2a vuelta...
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4 mr-2" />
              Lanzar 2a vuelta ({enabledAgents.length})
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
