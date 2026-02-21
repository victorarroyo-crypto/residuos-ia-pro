import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const consultantId = request.nextUrl.searchParams.get("consultant_id");
    if (!consultantId) {
      return NextResponse.json(
        { error: "consultant_id is required" },
        { status: 400 }
      );
    }

    console.log("[auth-url] Fetching from pipeline:", `${PIPELINE_URL}/api/gdrive/auth-url?consultant_id=${consultantId}`);
    const response = await fetch(
      `${PIPELINE_URL}/api/gdrive/auth-url?consultant_id=${consultantId}`
    );
    console.log("[auth-url] Pipeline response status:", response.status);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Error" }));
      return NextResponse.json(
        { error: error.detail },
        { status: response.status }
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("[auth-url] Fetch error:", error instanceof Error ? error.message : error);
    const message =
      error instanceof Error && error.message.includes("fetch")
        ? "Pipeline API no disponible."
        : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
