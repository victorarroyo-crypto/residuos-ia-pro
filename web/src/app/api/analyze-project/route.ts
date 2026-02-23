import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

/**
 * POST /api/analyze-project
 *
 * Lanza el analisis multi-agente (LangGraph) para un proyecto.
 * Delega al servidor Python que ejecuta el grafo completo.
 *
 * Body: { project_id: string }
 * Response: { report, findings, opportunities, errors }
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

    const response = await fetch(`${PIPELINE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
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
