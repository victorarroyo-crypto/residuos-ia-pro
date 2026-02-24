import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

// Allow longer execution for file processing (default is 10s on Vercel hobby)
export const maxDuration = 120;

/**
 * POST /api/advisor/chat
 *
 * Proxy FormData (multipart) al endpoint /api/advisor/chat del pipeline Python.
 * Permite subir archivos (PDF, Excel, imagenes, etc.) sin exponer la URL del
 * pipeline al browser ni depender de NEXT_PUBLIC_PIPELINE_API_URL.
 *
 * El body llega como multipart/form-data y se reenvia tal cual al pipeline.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const query = formData.get("query");
    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { error: "Se requiere un campo 'query'" },
        { status: 400 }
      );
    }

    // Rebuild FormData for the pipeline (we can't just forward the original
    // because the stream may already be consumed, and headers differ).
    const pipelineForm = new FormData();
    pipelineForm.append("query", query);

    const history = formData.get("conversation_history");
    if (history && typeof history === "string") {
      pipelineForm.append("conversation_history", history);
    }

    const projectId = formData.get("project_id");
    if (projectId && typeof projectId === "string") {
      pipelineForm.append("project_id", projectId);
    }

    const urls = formData.get("urls");
    if (urls && typeof urls === "string") {
      pipelineForm.append("urls", urls);
    }

    // Forward all files
    const files = formData.getAll("files");
    for (const file of files) {
      if (file instanceof Blob) {
        pipelineForm.append("files", file);
      }
    }

    const response = await fetch(`${PIPELINE_URL}/api/advisor/chat`, {
      method: "POST",
      body: pipelineForm,
      // No Content-Type header: fetch sets it with the correct multipart boundary
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error en el asesor IA" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[advisor/chat] Error:", detail);

    const message =
      detail.includes("fetch") ||
      detail.includes("ECONNREFUSED") ||
      detail.includes("ENOTFOUND")
        ? `Pipeline API no disponible (${PIPELINE_URL}). Asegurate de que el servidor Python esta corriendo.`
        : `Error en asesor: ${detail}`;

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
