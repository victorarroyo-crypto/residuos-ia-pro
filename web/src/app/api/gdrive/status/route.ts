import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export async function GET(request: NextRequest) {
  const consultantId = request.nextUrl.searchParams.get("consultant_id");
  if (!consultantId) {
    return NextResponse.json(
      { error: "consultant_id is required" },
      { status: 400 }
    );
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return NextResponse.json(
      { error: "Supabase no configurado en el servidor." },
      { status: 503 }
    );
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await sb
      .from("consultant_gdrive")
      .select("root_folder_id, folder_mapping, created_at, updated_at")
      .eq("consultant_id", consultantId)
      .maybeSingle();

    if (error) {
      // Table might not exist yet - treat as not connected
      return NextResponse.json({ connected: false });
    }

    if (!data) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      root_folder_id: data.root_folder_id,
      connected_at: data.created_at,
      configured: !!process.env.GOOGLE_CLIENT_ID,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error consultando estado: ${detail}` },
      { status: 500 }
    );
  }
}
