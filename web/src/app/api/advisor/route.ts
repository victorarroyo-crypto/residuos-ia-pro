import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

export const maxDuration = 120;

/**
 * POST /api/advisor
 *
 * Proxy al Asesor IA del pipeline Python.
 * Envía la consulta con historial de conversación y archivos adjuntos.
 *
 * Body: { query, conversation_history?, project_id?, files?, urls? }
 * Response: { answer, sources, rag_context_used }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.query) {
      return NextResponse.json(
        { error: "Se requiere un campo 'query'" },
        { status: 400 }
      );
    }

    // Validate files array if present
    if (body.files && Array.isArray(body.files) && body.files.length > 6) {
      return NextResponse.json(
        { error: "Maximo 6 archivos adjuntos." },
        { status: 400 }
      );
    }

    const response = await fetch(`${PIPELINE_URL}/api/advisor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(115_000), // 115s — just under Vercel's 120s maxDuration
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
    console.error("[advisor] Error:", detail);

    const isTimeout =
      detail.includes("TimeoutError") || detail.includes("aborted");
    const isNetwork =
      detail.includes("fetch") ||
      detail.includes("ECONNREFUSED") ||
      detail.includes("ENOTFOUND");

    const message = isTimeout
      ? "El asesor tardo demasiado en responder. Intenta con menos archivos o una pregunta mas corta."
      : isNetwork
        ? `Pipeline API no disponible (${PIPELINE_URL}). Asegurate de que el servidor Python esta corriendo.`
        : `Error en asesor: ${detail}`;

    return NextResponse.json(
      { error: message },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
