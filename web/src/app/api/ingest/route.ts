import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = 'force-dynamic';

export const maxDuration = 120;

/**
 * POST /api/ingest
 *
 * Acepta tres formatos:
 *
 * 1) **JSON** con archivo en base64 (esquiva el limite de 4.5MB de Vercel):
 *    { file_base64: string, file_name: string, file_type: string,
 *      project_id?: string, rag_scope?: string, password?: string }
 *
 * 2) **JSON** con storage_path (para archivos grandes, ya subidos a Storage):
 *    { storage_path: string, file_name: string,
 *      project_id?: string, rag_scope?: string, password?: string }
 *
 * 3) **FormData** (multipart) para archivos pequenos:
 *    file, project_id?, rag_scope?, password?
 *
 * En los casos 1 y 3 se construye un FormData y se reenvia al pipeline Python.
 * En el caso 2 se pasa storage_path al pipeline para que descargue de Storage.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";
    const pipelineForm = new FormData();
    let projectId: string | undefined;

    if (contentType.includes("application/json")) {
      const body = await request.json();

      if (body.storage_path && body.file_name) {
        // ── Storage mode: file already uploaded to Supabase Storage ──
        pipelineForm.append("storage_path", body.storage_path);
        pipelineForm.append("filename", body.file_name);
      } else if (body.file_base64 && body.file_name) {
        // ── Base64 mode: file arrives as base64 ──
        const binary = Buffer.from(body.file_base64, "base64");
        const blob = new Blob([binary], {
          type: body.file_type || "application/octet-stream",
        });
        pipelineForm.append("file", blob, body.file_name);
      } else {
        return NextResponse.json(
          { error: "Se requiere (file_base64 + file_name) o (storage_path + file_name)" },
          { status: 400 }
        );
      }

      if (body.project_id) {
        projectId = body.project_id;
        pipelineForm.append("project_id", body.project_id);
      }
      if (body.rag_scope) pipelineForm.append("rag_scope", body.rag_scope);
      if (body.password) pipelineForm.append("password", body.password);
    } else {
      // ── FormData mode ──
      const formData = await request.formData();
      formData.forEach((value, key) => {
        if (value instanceof Blob) {
          pipelineForm.append(key, value, (value as File).name || "file");
        } else {
          if (key === "project_id" && typeof value === "string" && value.trim()) {
            projectId = value;
          }
          pipelineForm.append(key, value);
        }
      });
    }

    // Ownership check: si hay project_id, verificar que pertenece al usuario
    if (projectId) {
      const admin = getAdminClient();
      if (!admin.ok) {
        return NextResponse.json({ error: admin.detail }, { status: admin.status });
      }
      const { data: project } = await admin.client
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("consultant_id", user.id)
        .single();
      if (!project) {
        return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 403 });
      }
    }

    pipelineForm.append("consultant_id", user.id);

    const response = await fetch(`${PIPELINE_URL}/api/ingest`, {
      method: "POST",
      headers: pipelineHeaders(),
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
        ? `Pipeline API no disponible. Contacta al administrador.`
        : `Error al conectar con Pipeline API: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
