import { NextRequest, NextResponse } from "next/server";
import { loadEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const consultantId = searchParams.get("consultant_id");
  const service = searchParams.get("service") || "advisor";

  if (!consultantId) {
    return NextResponse.json({ error: "consultant_id required" }, { status: 400 });
  }

  const pipelineUrl = loadEnv("PIPELINE_API_URL");
  if (!pipelineUrl) {
    return NextResponse.json({ error: "PIPELINE_API_URL not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(
      `${pipelineUrl}/api/model-config?consultant_id=${consultantId}&service=${service}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: `Error: ${e}` }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const pipelineUrl = loadEnv("PIPELINE_API_URL");
  if (!pipelineUrl) {
    return NextResponse.json({ error: "PIPELINE_API_URL not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const res = await fetch(`${pipelineUrl}/api/model-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: `Error: ${e}` }, { status: 500 });
  }
}
