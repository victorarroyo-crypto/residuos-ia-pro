import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { consultant_id, enabled } = body;

    if (!consultant_id) {
      return NextResponse.json(
        { error: "consultant_id is required" },
        { status: 400 }
      );
    }

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled (boolean) is required" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.detail },
        { status: admin.status }
      );
    }

    const { error } = await admin.client
      .from("consultant_gdrive")
      .update({ auto_sync_enabled: enabled })
      .eq("consultant_id", consultant_id);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      auto_sync_enabled: enabled,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error toggling auto-sync: ${detail}` },
      { status: 500 }
    );
  }
}
