import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

/**
 * POST /api/analyze-project/round2
 *
 * Fase 3: Segunda vuelta con hallazgos previos como contexto.
 * Body: { project_id, agents, consultant_instructions?, agent_focus?, previous_findings }
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
        { error: "Se requiere al menos un agente para la 2a vuelta" },
        { status: 400 }
      );
    }

    const response = await fetch(`${PIPELINE_URL}/api/analyze/round2`, {
      method: "POST",
      headers: pipelineHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        project_id: projectId,
        agents,
        consultant_instructions: body.consultant_instructions || "",
        agent_focus: body.agent_focus || {},
        previous_findings: body.previous_findings || [],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error en 2a vuelta" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[analyze-project/round2] Error:", detail);

    const message =
      detail.includes("fetch") || detail.includes("ECONNREFUSED")
        ? `Pipeline API no disponible. Contacta al administrador.`
        : `Error en 2a vuelta: ${detail}`;

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
