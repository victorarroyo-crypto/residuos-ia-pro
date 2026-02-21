import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const consultantId = request.nextUrl.searchParams.get("consultant_id");
  if (!consultantId) {
    return NextResponse.json(
      { error: "consultant_id is required" },
      { status: 400 }
    );
  }

  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.detail }, { status: admin.status });
  }

  try {
    const { data, error } = await admin.client
      .from("consultant_gdrive")
      .select("root_folder_id, folder_mapping, created_at, updated_at")
      .eq("consultant_id", consultantId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ connected: false });
    }

    if (!data) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      root_folder_id: data.root_folder_id,
      connected_at: data.created_at,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error consultando estado: ${detail}` },
      { status: 500 }
    );
  }
}
