import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

/**
 * POST /api/analyze-project
 *
 * Lanza el analisis multi-agente (LangGraph) para un proyecto.
 * Delega al servidor Python que ejecuta el grafo completo.
 *
 * Body: { project_id: string, agents?: string[] }
 * Response: { report, findings, opportunities, errors }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const projectId = body.project_id as string;
    const agents = body.agents as string[] | undefined;

    if (!projectId) {
      return NextResponse.json(
        { error: "Se requiere project_id" },
        { status: 400 }
      );
    }

    const payload: Record<string, unknown> = { project_id: projectId };
    if (agents && agents.length > 0) {
      payload.agents = agents;
    }

    const response = await fetch(`${PIPELINE_URL}/api/analyze`, {
      method: "POST",
      headers: pipelineHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error en el analisis" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[analyze-project] Error:", detail);

    const message =
      detail.includes("fetch") || detail.includes("ECONNREFUSED") || detail.includes("ENOTFOUND")
        ? `Pipeline API no disponible (${PIPELINE_URL}). Asegurate de que el servidor Python esta corriendo.`
        : `Error en analisis: ${detail}`;

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
