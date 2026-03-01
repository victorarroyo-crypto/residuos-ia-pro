import { NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

/**
 * POST /api/knowledge-base/reclassify
 * Re-classifies all knowledge_documents using current classification logic.
 */
export async function POST() {
  try {
    const response = await fetch(
      `${PIPELINE_URL}/api/knowledge-base/reclassify`,
      { method: "POST", headers: pipelineHeaders({ "Content-Type": "application/json" }) }
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error al reclasificar" },
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
        : `Error al reclasificar: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
