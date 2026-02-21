import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export async function DELETE(request: NextRequest) {
  const consultantId = request.nextUrl.searchParams.get("consultant_id");
  if (!consultantId) {
    return NextResponse.json(
      { error: "consultant_id is required" },
      { status: 400 }
    );
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await sb
      .from("consultant_gdrive")
      .delete()
      .eq("consultant_id", consultantId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error desconectando: ${detail}` },
      { status: 500 }
    );
  }
}
