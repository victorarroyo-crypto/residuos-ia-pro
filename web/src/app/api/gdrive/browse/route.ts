import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const consultantId = request.nextUrl.searchParams.get("consultant_id");
    const folderId = request.nextUrl.searchParams.get("folder_id");
    const pageToken = request.nextUrl.searchParams.get("page_token");

    if (!consultantId || !folderId) {
      return NextResponse.json(
        { error: "consultant_id and folder_id are required" },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({
      consultant_id: consultantId,
      folder_id: folderId,
    });
    if (pageToken) params.set("page_token", pageToken);

    const response = await fetch(
      `${PIPELINE_URL}/api/gdrive/browse?${params.toString()}`
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
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[gdrive/browse] Error:", detail);
    const message =
      detail.includes("fetch") || detail.includes("ECONNREFUSED") || detail.includes("ENOTFOUND")
        ? `Pipeline API no disponible (${PIPELINE_URL}).`
        : `Error al conectar con Pipeline API: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
