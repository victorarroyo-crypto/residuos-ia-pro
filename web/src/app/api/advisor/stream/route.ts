import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

// SSE connections are long-lived, allow up to 5 min
export const maxDuration = 300;

/**
 * POST /api/advisor/stream
 *
 * SSE streaming proxy to the Python advisor.
 * Proxies the SSE stream from Python directly to the browser.
 * No timeout issues because data flows continuously.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
      return NextResponse.json(
        { error: "Se requiere un campo 'query'" },
        { status: 400 }
      );
    }

    const response = await fetch(`${PIPELINE_URL}/api/advisor/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

    // Proxy the SSE stream directly to the browser
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[advisor/stream] Error:", detail);

    const isNetwork =
      detail.includes("fetch") ||
      detail.includes("ECONNREFUSED") ||
      detail.includes("ENOTFOUND");

    const message = isNetwork
      ? `Pipeline API no disponible (${PIPELINE_URL}). Asegurate de que el servidor Python esta corriendo.`
      : `Error en asesor: ${detail}`;

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
