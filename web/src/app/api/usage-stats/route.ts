import { NextRequest, NextResponse } from "next/server";
import { loadEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const consultantId = searchParams.get("consultant_id");
  const days = searchParams.get("days") || "30";

  if (!consultantId) {
    return NextResponse.json({ error: "consultant_id required" }, { status: 400 });
  }

  const pipelineUrl = loadEnv("PIPELINE_API_URL");
  if (!pipelineUrl) {
    return NextResponse.json({ error: "PIPELINE_API_URL not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(
      `${pipelineUrl}/api/usage-stats?consultant_id=${consultantId}&days=${days}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: `Error fetching usage stats: ${e}` },
      { status: 500 }
    );
  }
}
