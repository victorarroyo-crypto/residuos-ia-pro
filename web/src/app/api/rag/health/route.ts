import { NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

/**
 * GET /api/rag/health
 * Diagnóstico del sistema RAG: documentos sin chunks, estadísticas por scope.
 */
export async function GET() {
  try {
    const response = await fetch(`${PIPELINE_URL}/api/rag/health`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error al obtener estado RAG" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message =
      detail.includes("fetch") || detail.includes("ECONNREFUSED")
        ? `Pipeline API no disponible (${PIPELINE_URL}).`
        : `Error diagnóstico RAG: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
