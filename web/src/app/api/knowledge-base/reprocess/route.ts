import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

/**
 * POST /api/knowledge-base/reprocess
 * Re-procesa documentos que no tienen chunks o fallaron.
 * Body: { doc_ids: string[], scope?: "knowledge" | "project" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { doc_ids, scope = "knowledge" } = body;

    if (!doc_ids || !Array.isArray(doc_ids) || doc_ids.length === 0) {
      return NextResponse.json(
        { error: "Se requiere un array doc_ids no vacío" },
        { status: 400 }
      );
    }

    const response = await fetch(`${PIPELINE_URL}/api/reprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_ids, scope }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error al reprocesar documentos" },
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
        : `Error al reprocesar: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
