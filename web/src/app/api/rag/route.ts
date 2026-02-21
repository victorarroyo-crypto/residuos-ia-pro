import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${PIPELINE_URL}/api/rag/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "RAG query error" }));
      return NextResponse.json(
        { error: error.detail || "Error en consulta RAG" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("fetch")
        ? "Pipeline API no disponible."
        : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
