import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

/**
 * POST /api/analyze-project/execute
 *
 * Fase 2: Ejecuta analisis con instrucciones del consultor (HITL).
 * Body: { project_id, agents, consultant_instructions?, agent_focus? }
 * Response: { report, findings, opportunities, errors }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const projectId = body.project_id as string;
    const agents = body.agents as string[];

    if (!projectId) {
      return NextResponse.json(
        { error: "Se requiere project_id" },
        { status: 400 }
      );
    }

    if (!agents || agents.length === 0) {
      return NextResponse.json(
        { error: "Se requiere al menos un agente" },
        { status: 400 }
      );
    }

    const response = await fetch(`${PIPELINE_URL}/api/analyze/execute`, {
      method: "POST",
      headers: pipelineHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        project_id: projectId,
        agents,
        consultant_instructions: body.consultant_instructions || "",
        agent_focus: body.agent_focus || {},
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error en ejecucion" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[analyze-project/execute] Error:", detail);

    const message =
      detail.includes("fetch") || detail.includes("ECONNREFUSED")
        ? `Pipeline API no disponible. Contacta al administrador.`
        : `Error en ejecucion: ${detail}`;

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
