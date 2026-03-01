import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

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
      `${PIPELINE_URL}/api/gdrive/browse?${params.toString()}`,
      { headers: pipelineHeaders() }
    );

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
    console.error("[gdrive/browse] Error:", detail);
    const message =
      detail.includes("fetch") || detail.includes("ECONNREFUSED") || detail.includes("ENOTFOUND")
        ? `Pipeline API no disponible (${PIPELINE_URL}).`
        : `Error al conectar con Pipeline API: ${detail}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
