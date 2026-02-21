import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

export async function DELETE(request: NextRequest) {
  try {
    const consultantId = request.nextUrl.searchParams.get("consultant_id");
    if (!consultantId) {
      return NextResponse.json(
        { error: "consultant_id is required" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${PIPELINE_URL}/api/gdrive/disconnect?consultant_id=${consultantId}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Error" }));
      return NextResponse.json(
        { error: error.detail },
        { status: response.status }
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("fetch")
        ? "Pipeline API no disponible."
        : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
