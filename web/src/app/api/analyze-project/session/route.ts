import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

/**
 * GET /api/analyze-project/session?project_id=xxx
 * Get latest active session for a project.
 *
 * POST /api/analyze-project/session
 * Create a new session. Body: { project_id, consultant_id }
 */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "Se requiere project_id" }, { status: 400 });
  }

  try {
    const response = await fetch(`${PIPELINE_URL}/api/analyze/session/${projectId}`, {
      headers: pipelineHeaders(),
    });
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.project_id || !body.consultant_id) {
      return NextResponse.json(
        { error: "Se requiere project_id y consultant_id" },
        { status: 400 }
      );
    }

    const form = new FormData();
    form.append("project_id", body.project_id);
    form.append("consultant_id", body.consultant_id);

    const response = await fetch(`${PIPELINE_URL}/api/analyze/session`, {
      method: "POST",
      headers: pipelineHeaders(),
      body: form,
    });

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
