"use client";

import { useEffect, useState, useRef } from "react";
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
  AlertCircle,
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
  projectId?: string; // enables SSE when provided
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
  projectId,
}: AnalysisProgressProps) {
  const [elapsed, setElapsed] = useState(0);
  const [agentProgress, setAgentProgress] = useState<AgentProgress[]>(() =>
    agents.map((id) => ({ id, status: "pending" as const }))
  );
  const [optimizadorStatus, setOptimizadorStatus] = useState<"pending" | "running" | "done">("pending");
  const [redactorStatus, setRedactorStatus] = useState<"pending" | "running" | "done">("pending");
  const [sseConnected, setSseConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Timer
  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, isComplete]);

  // SSE connection for real-time progress
  useEffect(() => {
    if (!projectId || isComplete) return;

    const es = new EventSource(`/api/analyze-project/progress?project_id=${projectId}`);
    eventSourceRef.current = es;

    es.onopen = () => setSseConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "agent_start") {
          const agentId = data.agent;
          if (agentId === "optimizador") {
            setOptimizadorStatus("running");
          } else if (agentId === "redactor") {
            setRedactorStatus("running");
          } else {
            setAgentProgress((prev) =>
              prev.map((a) =>
                a.id === agentId && a.status !== "done"
                  ? { ...a, status: "running" as const }
                  : a
              )
            );
          }
        } else if (data.type === "agent_done") {
          const agentId = data.agent;
          if (agentId === "optimizador") {
            setOptimizadorStatus("done");
          } else if (agentId === "redactor") {
            setRedactorStatus("done");
          } else {
            setAgentProgress((prev) =>
              prev.map((a) =>
                a.id === agentId
                  ? {
                      ...a,
                      status: "done" as const,
                      findingsCount: data.findings_count,
                    }
                  : a
              )
            );
          }
        } else if (data.type === "complete") {
          es.close();
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      setSseConnected(false);
      es.close();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [projectId, isComplete]);

  // Fallback: simulate progressive completion when SSE is not available
  useEffect(() => {
    if (sseConnected || projectId) return; // SSE takes priority

    if (isComplete) {
      setAgentProgress((prev) =>
        prev.map((a) => ({ ...a, status: "done" as const }))
      );
      setOptimizadorStatus("done");
      setRedactorStatus("done");
      return;
    }

    // Simulate agents finishing at staggered intervals
    const timers: NodeJS.Timeout[] = [];

    // Start all agents immediately
    setAgentProgress((prev) =>
      prev.map((a) => ({ ...a, status: "running" as const }))
    );

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
  }, [agents, isComplete, sseConnected, projectId]);

  // When fully complete, ensure all statuses are done
  useEffect(() => {
    if (!isComplete) return;
    setAgentProgress((prev) =>
      prev.map((a) => ({ ...a, status: "done" as const }))
    );
    setOptimizadorStatus("done");
    setRedactorStatus("done");
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, [isComplete]);

  const doneCount = agentProgress.filter((a) => a.status === "done").length;
  const totalSteps = agents.length + 2; // agents + optimizador + redactor
  const optDone = optimizadorStatus === "done" ? 1 : 0;
  const redDone = redactorStatus === "done" ? 1 : 0;
  const currentStep = isComplete ? totalSteps : doneCount + optDone + redDone;
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
        <div className="flex items-center gap-3">
          {sseConnected && (
            <span className="text-xs text-vandarum-teal flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-vandarum-teal animate-pulse" />
              En vivo
            </span>
          )}
          <div className="text-sm text-muted-foreground font-mono">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </div>
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
          const isError = agent.status === "error";

          return (
            <div key={agent.id} className="flex items-center gap-3 py-1.5">
              <div className="w-24 text-sm font-medium flex items-center gap-1.5">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {config.label}
              </div>

              <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative">
                <div
                  className={`h-full rounded transition-all duration-1000 ${
                    isDone ? "bg-vandarum-teal" : isRunning ? "bg-vandarum-teal/40 animate-pulse" : isError ? "bg-red-400" : "bg-muted"
                  }`}
                  style={{ width: isDone ? "100%" : isRunning ? "60%" : "0%" }}
                />
                {isRunning && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                    Analizando...
                  </div>
                )}
              </div>

              <div className="w-24 text-right">
                {isDone ? (
                  <span className="text-xs text-vandarum-teal flex items-center justify-end gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {agent.findingsCount != null ? `${agent.findingsCount} hall.` : "Listo"}
                  </span>
                ) : isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-vandarum-teal ml-auto" />
                ) : isError ? (
                  <AlertCircle className="h-3.5 w-3.5 text-red-500 ml-auto" />
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
          <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative">
            <div
              className={`h-full rounded transition-all duration-1000 ${
                optimizadorStatus === "done"
                  ? "bg-vandarum-teal"
                  : optimizadorStatus === "running"
                  ? "bg-vandarum-teal/40 animate-pulse"
                  : ""
              }`}
              style={{
                width: optimizadorStatus === "done" ? "100%" : optimizadorStatus === "running" ? "50%" : "0%",
              }}
            />
            {optimizadorStatus === "running" && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Priorizando...
              </div>
            )}
          </div>
          <div className="w-24 text-right">
            {optimizadorStatus === "done" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-vandarum-teal ml-auto" />
            ) : optimizadorStatus === "running" ? (
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
          <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative">
            <div
              className={`h-full rounded transition-all duration-1000 ${
                redactorStatus === "done"
                  ? "bg-vandarum-teal"
                  : redactorStatus === "running"
                  ? "bg-vandarum-teal/40 animate-pulse"
                  : ""
              }`}
              style={{
                width: redactorStatus === "done" ? "100%" : redactorStatus === "running" ? "50%" : "0%",
              }}
            />
            {redactorStatus === "running" && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Redactando informe...
              </div>
            )}
          </div>
          <div className="w-24 text-right">
            {redactorStatus === "done" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-vandarum-teal ml-auto" />
            ) : redactorStatus === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-vandarum-teal ml-auto" />
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
