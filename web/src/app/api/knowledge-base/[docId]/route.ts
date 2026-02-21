import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "@/lib/env";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;

  const supabaseUrl =
    loadEnv("NEXT_PUBLIC_SUPABASE_URL") || loadEnv("SUPABASE_URL");
  const serviceKey = loadEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Supabase no configurado." },
      { status: 503 }
    );
  }

  try {
    const sb = createClient(supabaseUrl, serviceKey);

    // Delete chunks first
    await sb.from("document_chunks").delete().eq("document_id", docId);

    // Delete document
    const { error } = await sb
      .from("client_documents")
      .delete()
      .eq("id", docId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
