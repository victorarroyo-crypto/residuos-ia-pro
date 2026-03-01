import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${PIPELINE_URL}/api/gdrive/ingest-file`, {
      method: "POST",
      headers: pipelineHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = `Pipeline respondio con status ${response.status}`;
      try {
        const body = JSON.parse(text);
        message = body.detail || body.error || body.message || message;
      } catch {
        if (text) message = text;
      }
      return NextResponse.json(
        { error: message },
        { status: response.status }
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[gdrive/ingest-file] Error:", detail);
    const message =
      detail.includes("fetch") || detail.includes("ECONNREFUSED") || detail.includes("ENOTFOUND")
        ? `Pipeline API no disponible. Contacta al administrador.`
        : `Error al conectar con Pipeline API: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
