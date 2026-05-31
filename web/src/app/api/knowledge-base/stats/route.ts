import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

const EMPTY = {
  total_documents: 0,
  total_chunks: 0,
  total_pages: 0,
  by_type: {} as Record<string, number>,
};

export async function GET() {
  const admin = getAdminClient();
  if (!admin.ok) return NextResponse.json(EMPTY);

  try {
    const { data, error } = await admin.client.rpc("get_kb_stats").single();
    if (error || !data) return NextResponse.json(EMPTY);

    return NextResponse.json({
      total_documents: Number(data.total_documents) || 0,
      total_chunks: Number(data.total_chunks) || 0,
      total_pages: Number(data.total_pages) || 0,
      by_type: (data.by_type as Record<string, number>) || {},
    });
  } catch {
    return NextResponse.json(EMPTY);
  }
}
