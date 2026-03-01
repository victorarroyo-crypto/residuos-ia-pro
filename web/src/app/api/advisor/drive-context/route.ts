import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

// Downloading + extracting files can take a while
export const maxDuration = 120;

/**
 * POST /api/advisor/drive-context
 *
 * Proxy to Python backend. Downloads files from a Google Drive folder,
 * extracts text, and returns ephemeral context for the advisor.
 * Nothing is persisted in the database.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.consultant_id || !body.folder_id) {
      return NextResponse.json(
        { error: "consultant_id and folder_id are required" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${PIPELINE_URL}/api/advisor/drive-context`,
      {
        method: "POST",
        headers: pipelineHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = `Pipeline respondio con status ${response.status}`;
      try {
        const parsed = JSON.parse(text);
        message = parsed.detail || parsed.error || parsed.message || message;
      } catch {
        if (text) message = text;
      }
      return NextResponse.json({ error: message }, { status: response.status });
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[advisor/drive-context] Error:", detail);
    const message =
      detail.includes("fetch") ||
      detail.includes("ECONNREFUSED") ||
      detail.includes("ENOTFOUND")
        ? `Pipeline API no disponible. Contacta al administrador.`
        : `Error al cargar contexto de Drive: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
