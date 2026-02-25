/**
 * GET /api/analyze-project/progress
 *
 * DEPRECATED: Analysis progress now flows via Supabase Realtime
 * on the `analysis_progress` table. This SSE endpoint is no longer needed.
 */
export async function GET() {
  return new Response(
    JSON.stringify({
      error: "SSE progress endpoint removed. Use Supabase Realtime on analysis_progress table.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
}
