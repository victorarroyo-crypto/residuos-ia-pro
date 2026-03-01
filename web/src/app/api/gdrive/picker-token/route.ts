import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

export async function GET(request: NextRequest) {
  const consultantId = request.nextUrl.searchParams.get("consultant_id");
  if (!consultantId) {
    return NextResponse.json(
      { error: "consultant_id is required" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `${PIPELINE_URL}/api/gdrive/picker-token?consultant_id=${consultantId}`,
      { headers: pipelineHeaders() }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json(
        { error: text || `Pipeline status ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error al obtener token: ${detail}` },
      { status: 502 }
    );
  }
}
