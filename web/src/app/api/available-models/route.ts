import { NextResponse } from "next/server";
import { loadEnv } from "@/lib/env";

export async function GET() {
  const pipelineUrl = loadEnv("PIPELINE_API_URL");
  if (!pipelineUrl) {
    return NextResponse.json({ error: "PIPELINE_API_URL not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${pipelineUrl}/api/available-models`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: `Error: ${e}` }, { status: 500 });
  }
}
