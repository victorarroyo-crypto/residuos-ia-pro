import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

export const maxDuration = 120;

/**
 * POST /api/ingest
 *
 * Acepta dos formatos:
 *
 * 1) **JSON** con archivo en base64 (esquiva el limite de 4.5MB de Vercel):
 *    { file_base64: string, file_name: string, file_type: string,
 *      project_id?: string, rag_scope?: string, password?: string }
 *
 * 2) **FormData** (multipart) para archivos pequenos:
 *    file, project_id?, rag_scope?, password?
 *
 * En ambos casos se construye un FormData y se reenvia al pipeline Python.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const pipelineForm = new FormData();

    if (contentType.includes("application/json")) {
      // ── JSON mode: file arrives as base64 ──
      const body = await request.json();

      if (!body.file_base64 || !body.file_name) {
        return NextResponse.json(
          { error: "Se requiere file_base64 y file_name" },
          { status: 400 }
        );
      }

      const binary = Buffer.from(body.file_base64, "base64");
      const blob = new Blob([binary], {
        type: body.file_type || "application/octet-stream",
      });
      pipelineForm.append("file", blob, body.file_name);

      if (body.project_id) pipelineForm.append("project_id", body.project_id);
      if (body.rag_scope) pipelineForm.append("rag_scope", body.rag_scope);
      if (body.password) pipelineForm.append("password", body.password);
    } else {
      // ── FormData mode ──
      const formData = await request.formData();
      // Forward all fields
      formData.forEach((value, key) => {
        if (value instanceof Blob) {
          pipelineForm.append(key, value, (value as File).name || "file");
        } else {
          pipelineForm.append(key, value);
        }
      });
    }

    const response = await fetch(`${PIPELINE_URL}/api/ingest`, {
      method: "POST",
      body: pipelineForm,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error processing document" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[ingest] Error:", detail);
    const message =
      detail.includes("fetch") ||
      detail.includes("ECONNREFUSED") ||
      detail.includes("ENOTFOUND")
        ? `Pipeline API no disponible (${PIPELINE_URL}). Asegurate de que el servidor Python esta corriendo.`
        : `Error al conectar con Pipeline API: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
