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
    // Get GDrive config
    const { data: gdriveConfig } = await admin.client
      .from("consultant_gdrive")
      .select("last_synced_at, auto_sync_enabled")
      .eq("consultant_id", consultantId)
      .maybeSingle();

    // Get last 5 sync logs
    const { data: logs } = await admin.client
      .from("gdrive_sync_log")
      .select("*")
      .eq("consultant_id", consultantId)
      .order("started_at", { ascending: false })
      .limit(5);

    const recentSyncs = logs || [];
    const isRunning = recentSyncs.some(
      (log: Record<string, unknown>) => log.status === "running"
    );

    return NextResponse.json({
      last_synced_at: gdriveConfig?.last_synced_at ?? null,
      auto_sync_enabled: gdriveConfig?.auto_sync_enabled ?? true,
      is_syncing: isRunning,
      recent_syncs: recentSyncs,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error consultando sync status: ${detail}` },
      { status: 500 }
    );
  }
}
