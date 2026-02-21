import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

/**
 * Vercel Cron Job: Sync all consultants' Google Drive documents.
 * Runs every 30 minutes (configured in vercel.json).
 * Protected by CRON_SECRET to prevent unauthorized triggers.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(`${PIPELINE_URL}/api/gdrive/sync-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Error" }));
      return NextResponse.json(
        { error: error.detail },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("fetch")
        ? "Pipeline API no disponible."
        : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
