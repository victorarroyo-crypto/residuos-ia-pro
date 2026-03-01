import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

/**
 * PATCH /api/analyze-project/session/[id]
 * Update a session's state (phase, plan, results, etc.)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const response = await fetch(
      `${PIPELINE_URL}/api/analyze/session/${params.id}`,
      {
        method: "PATCH",
        headers: pipelineHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Error" }));
      return NextResponse.json({ error: err.detail }, { status: response.status });
    }
    return NextResponse.json(await response.json());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
