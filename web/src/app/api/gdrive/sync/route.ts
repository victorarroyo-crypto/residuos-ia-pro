import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

// Allow up to 60s for the initial handshake with Pipeline.
// The actual sync runs in background on the Pipeline server.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000); // 55s safety margin

    try {
      const response = await fetch(`${PIPELINE_URL}/api/gdrive/sync`, {
        method: "POST",
        headers: pipelineHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

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
      clearTimeout(timeout);

      if (error instanceof DOMException && error.name === "AbortError") {
        // Pipeline took too long to even accept the request
        return NextResponse.json(
          { error: "Pipeline API tardo demasiado en responder. Verifica que esta activo." },
          { status: 504 }
        );
      }
      throw error; // re-throw for outer catch
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[gdrive/sync] Error:", detail);
    const message =
      detail.includes("fetch") || detail.includes("ECONNREFUSED") || detail.includes("ENOTFOUND")
        ? `Pipeline API no disponible. Contacta al administrador.`
        : `Error al conectar con Pipeline API: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
