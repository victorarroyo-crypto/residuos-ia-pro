import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

/**
 * POST /api/analyze-project/plan
 *
 * Fase 0: Carga datos + coordinador genera plan inteligente.
 * Body: { project_id: string }
 * Response: { analysis_plan, project_name, errors }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const projectId = body.project_id as string;

    if (!projectId) {
      return NextResponse.json(
        { error: "Se requiere project_id" },
        { status: 400 }
      );
    }

    const response = await fetch(`${PIPELINE_URL}/api/analyze/plan`, {
      method: "POST",
      headers: pipelineHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ project_id: projectId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error generando plan" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[analyze-project/plan] Error:", detail);

    const message =
      detail.includes("fetch") || detail.includes("ECONNREFUSED")
        ? `Pipeline API no disponible (${PIPELINE_URL}).`
        : `Error en planificacion: ${detail}`;

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
