import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function DELETE(request: NextRequest) {
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
    await admin.client
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
