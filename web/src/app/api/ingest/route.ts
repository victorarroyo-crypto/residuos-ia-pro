import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // Forward the request to the Python pipeline API
    const response = await fetch(`${PIPELINE_URL}/api/ingest`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Pipeline error" }));
      return NextResponse.json(
        { error: error.detail || "Error processing document" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    // If pipeline is not running, return a clear error
    const message =
      error instanceof Error && error.message.includes("fetch")
        ? "Pipeline API no disponible. Asegurate de que el servidor Python esta corriendo."
        : "Error interno del servidor";

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
