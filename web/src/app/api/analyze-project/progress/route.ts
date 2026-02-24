import { NextRequest } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

/**
 * GET /api/analyze-project/progress?project_id=xxx
 * SSE proxy — streams real-time analysis progress events from the Python backend.
 */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return new Response(JSON.stringify({ error: "Se requiere project_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const upstream = await fetch(
      `${PIPELINE_URL}/api/analyze/progress/${projectId}`,
      {
        headers: { Accept: "text/event-stream" },
        signal: AbortSignal.timeout(300_000), // 5 min max
      }
    );

    if (!upstream.ok || !upstream.body) {
      return new Response(
        JSON.stringify({ error: "Pipeline progress not available" }),
        { status: upstream.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // Stream the SSE body through to the client
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: detail }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
