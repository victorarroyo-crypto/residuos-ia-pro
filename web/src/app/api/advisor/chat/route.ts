import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

// Allow longer execution for file processing (default is 10s on Vercel hobby)
export const maxDuration = 120;

/**
 * POST /api/advisor/chat
 *
 * Acepta dos formatos:
 *
 * 1) **JSON** con archivos en base64 (para esquivar el limite de 4.5MB de Vercel):
 *    {
 *      query: string,
 *      conversation_history?: object[],
 *      urls?: string[],
 *      files?: { name: string, type: string, base64: string }[]
 *    }
 *
 * 2) **FormData** (multipart) para archivos pequenos (< 4MB total).
 *
 * En ambos casos se construye un FormData y se reenvia al pipeline Python.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let query: string;
    let conversationHistory: string | undefined;
    let projectId: string | undefined;
    let urls: string | undefined;
    const fileBlobs: { blob: Blob; name: string }[] = [];

    let storageFiles: string | undefined;

    if (contentType.includes("application/json")) {
      // ── JSON mode: files arrive as base64 strings (or storage_paths for large files) ──
      const body = await request.json();
      query = body.query;
      if (!query || typeof query !== "string" || !query.trim()) {
        return NextResponse.json(
          { error: "Se requiere un campo 'query'" },
          { status: 400 }
        );
      }
      conversationHistory = body.conversation_history
        ? JSON.stringify(body.conversation_history)
        : undefined;
      projectId = body.project_id;
      urls = body.urls ? JSON.stringify(body.urls) : undefined;

      // Small files: base64 → decode to blob
      if (Array.isArray(body.files)) {
        for (const f of body.files) {
          if (f.base64 && f.name) {
            const binary = Buffer.from(f.base64, "base64");
            const blob = new Blob([binary], { type: f.type || "application/octet-stream" });
            fileBlobs.push({ blob, name: f.name });
          }
        }
      }

      // Large files: already in Storage, pass paths to Python
      if (Array.isArray(body.storage_files) && body.storage_files.length > 0) {
        storageFiles = JSON.stringify(body.storage_files);
      }
    } else {
      // ── FormData mode (small files, < 4MB) ──
      const formData = await request.formData();
      const q = formData.get("query");
      if (!q || typeof q !== "string" || !q.trim()) {
        return NextResponse.json(
          { error: "Se requiere un campo 'query'" },
          { status: 400 }
        );
      }
      query = q;
      const h = formData.get("conversation_history");
      if (h && typeof h === "string") conversationHistory = h;
      const p = formData.get("project_id");
      if (p && typeof p === "string") projectId = p;
      const u = formData.get("urls");
      if (u && typeof u === "string") urls = u;

      for (const file of formData.getAll("files")) {
        if (file instanceof Blob) {
          const name = (file as File).name || "file";
          fileBlobs.push({ blob: file, name });
        }
      }
    }

    // Build FormData for the pipeline Python API
    const pipelineForm = new FormData();
    pipelineForm.append("query", query);
    if (conversationHistory) pipelineForm.append("conversation_history", conversationHistory);
    if (projectId) pipelineForm.append("project_id", projectId);
    if (urls) pipelineForm.append("urls", urls);
    if (storageFiles) pipelineForm.append("storage_files", storageFiles);
    for (const { blob, name } of fileBlobs) {
      pipelineForm.append("files", blob, name);
    }

    const response = await fetch(`${PIPELINE_URL}/api/advisor/chat`, {
      method: "POST",
      body: pipelineForm,
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
