import { NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch(`${PIPELINE_URL}/api/available-models`, {
      headers: pipelineHeaders(),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[available-models] Error:", detail);
    return NextResponse.json({ error: `Error: ${detail}` }, { status: 502 });
  }
}
