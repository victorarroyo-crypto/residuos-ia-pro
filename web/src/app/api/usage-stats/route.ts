import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = searchParams.get("days") || "30";

  try {
    const res = await fetch(
      `${PIPELINE_URL}/api/usage-stats?consultant_id=${user.id}&days=${days}`,
      { headers: pipelineHeaders(), cache: "no-store" }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[usage-stats] Error:", detail);
    return NextResponse.json(
      { error: `Error fetching usage stats: ${detail}` },
      { status: 502 }
    );
  }
}
