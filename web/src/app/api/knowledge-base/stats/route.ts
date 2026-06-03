import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Defaults + the shape returned on any failure, so the UI never sees
// undefined fields.
const EMPTY = {
  total_documents: 0,
  total_chunks: 0,
  total_pages: 0,
  by_type: {} as Record<string, number>,
  // Reconciliation (Fase 5): indexed vs last Drive scan.
  drive_files_seen: 0,
  in_drive_not_indexed: 0,
  md_skipped: 0,
  real_gaps: 0,
  orphans: 0,
  manual_uploads: 0,
};

export async function GET() {
  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json(EMPTY);
  }

  try {
    // A single RPC computes every count in the DB (no PostgREST 1000-row cap
    // that previously froze total_documents at 1000) plus the Drive
    // reconciliation. See supabase/migrations/fase5_kb_reconciliation.sql
    const { data, error } = await admin.client.rpc(
      "knowledge_base_reconciliation"
    );
    if (error || !data) {
      return NextResponse.json(EMPTY);
    }
    // Merge over EMPTY so any missing field is still present.
    return NextResponse.json({ ...EMPTY, ...(data as Record<string, unknown>) });
  } catch {
    return NextResponse.json(EMPTY);
  }
}
