"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Clock,
  FileText,
  ClipboardList,
  Receipt,
  BookOpen,
  Scale,
  Sparkles,
  Pencil,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────

interface AgentProgress {
  id: string;
  status: "pending" | "running" | "done" | "error";
  elapsed?: number;
  findingsCount?: number;
}

export interface AnalysisProgressProps {
  agents: string[];
  instructions?: string;
  startTime: number;
  isComplete: boolean;
}

// ─── Agent display config ───────────────────────────────────────

const AGENT_CONFIG: Record<string, { label: string; icon: typeof FileText }> = {
  aai: { label: "AAI", icon: FileText },
  contratos: { label: "Contratos", icon: ClipboardList },
  facturas: { label: "Facturas", icon: Receipt },
  registro: { label: "Registro", icon: BookOpen },
  normativo: { label: "Normativo", icon: Scale },
};

// ─── Component ──────────────────────────────────────────────────

export function AnalysisProgress({
  agents,
  instructions,
  startTime,
  isComplete,
}: AnalysisProgressProps) {
  const [elapsed, setElapsed] = useState(0);
  const [agentProgress, setAgentProgress] = useState<AgentProgress[]>(() =>
    agents.map((id) => ({ id, status: "running" as const }))
  );

  // Timer
  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, isComplete]);

  // Simulate progressive completion
  useEffect(() => {
    if (isComplete) {
      setAgentProgress((prev) =>
        prev.map((a) => ({ ...a, status: "done" as const }))
      );
      return;
    }

    // Simulate agents finishing at staggered intervals
    const timers: NodeJS.Timeout[] = [];
    agents.forEach((id, index) => {
      const delay = 5000 + index * 8000 + Math.random() * 5000;
      const timer = setTimeout(() => {
        setAgentProgress((prev) =>
          prev.map((a) =>
            a.id === id && a.status === "running"
              ? { ...a, status: "done" as const, elapsed: Math.floor(delay / 1000) }
              : a
          )
        );
      }, delay);
      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, [agents, isComplete]);

  const doneCount = agentProgress.filter((a) => a.status === "done").length;
  const totalSteps = agents.length + 2; // agents + optimizador + redactor
  const currentStep = isComplete ? totalSteps : Math.min(doneCount, agents.length);
  const progressPct = Math.round((currentStep / totalSteps) * 100);

  return (
    <div className="space-y-4">
      {/* Header with timer */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Loader2 className={`h-5 w-5 text-vandarum-teal ${isComplete ? "" : "animate-spin"}`} />
            {isComplete ? "Analisis completado" : "Ejecutando analisis..."}
          </h3>
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="bg-vandarum-teal h-2 rounded-full transition-all duration-1000"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Agent lanes */}
      <div className="space-y-1.5">
        {agentProgress.map((agent) => {
          const config = AGENT_CONFIG[agent.id] || { label: agent.id, icon: FileText };
          const Icon = config.icon;
          const isDone = agent.status === "done";
          const isRunning = agent.status === "running" && !isComplete;

          return (
            <div key={agent.id} className="flex items-center gap-3 py-1.5">
              <div className="w-24 text-sm font-medium flex items-center gap-1.5">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {config.label}
              </div>

              <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative">
                <div
                  className={`h-full rounded transition-all duration-1000 ${
                    isDone ? "bg-vandarum-teal" : isRunning ? "bg-vandarum-teal/40" : "bg-muted"
                  }`}
                  style={{ width: isDone ? "100%" : isRunning ? `${30 + Math.random() * 40}%` : "0%" }}
                />
                {isRunning && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                    Analizando...
                  </div>
                )}
              </div>

              <div className="w-20 text-right">
                {isDone ? (
                  <span className="text-xs text-vandarum-teal flex items-center justify-end gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {agent.elapsed ? `${agent.elapsed}s` : "Listo"}
                  </span>
                ) : isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-vandarum-teal ml-auto" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                )}
              </div>
            </div>
          );
        })}

        {/* Optimizador lane */}
        <div className="flex items-center gap-3 py-1.5 border-t mt-1 pt-2">
          <div className="w-24 text-sm font-medium flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Optimizador
          </div>
          <div className="flex-1 h-6 bg-muted rounded overflow-hidden">
            <div
              className={`h-full rounded transition-all duration-1000 ${
                isComplete ? "bg-vandarum-teal" : doneCount >= agents.length ? "bg-vandarum-teal/40" : ""
              }`}
              style={{ width: isComplete ? "100%" : doneCount >= agents.length ? "50%" : "0%" }}
            />
          </div>
          <div className="w-20 text-right">
            {isComplete ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-vandarum-teal ml-auto" />
            ) : doneCount >= agents.length ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-vandarum-teal ml-auto" />
            ) : (
              <Clock className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
            )}
          </div>
        </div>

        {/* Redactor lane */}
        <div className="flex items-center gap-3 py-1.5">
          <div className="w-24 text-sm font-medium flex items-center gap-1.5">
            <Pencil className="h-4 w-4 text-muted-foreground" />
            Redactor
          </div>
          <div className="flex-1 h-6 bg-muted rounded overflow-hidden">
            <div
              className={`h-full rounded transition-all duration-1000 ${
                isComplete ? "bg-vandarum-teal" : ""
              }`}
              style={{ width: isComplete ? "100%" : "0%" }}
            />
          </div>
          <div className="w-20 text-right">
            {isComplete ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-vandarum-teal ml-auto" />
            ) : (
              <Clock className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
            )}
          </div>
        </div>
      </div>

      {/* Instructions applied */}
      {instructions && (
        <div className="text-xs text-muted-foreground border-t pt-2 mt-2">
          <strong>Instrucciones aplicadas:</strong> &quot;{instructions.length > 100 ? instructions.slice(0, 100) + "..." : instructions}&quot;
        </div>
      )}
    </div>
  );
}
