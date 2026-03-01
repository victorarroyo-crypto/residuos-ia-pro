import { NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const res = await fetch(
      `${PIPELINE_URL}/api/cost-limits?consultant_id=${user.id}`,
      { headers: pipelineHeaders(), cache: "no-store" }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[cost-limits] GET Error:", detail);
    return NextResponse.json({ error: `Error: ${detail}` }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const res = await fetch(`${PIPELINE_URL}/api/cost-limits`, {
      method: "PUT",
      headers: pipelineHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...body, consultant_id: user.id }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[cost-limits] PUT Error:", detail);
    return NextResponse.json({ error: `Error: ${detail}` }, { status: 502 });
  }
}
