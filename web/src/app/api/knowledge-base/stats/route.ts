import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json({
      total_documents: 0,
      total_chunks: 0,
      total_pages: 0,
      by_type: {},
    });
  }

  try {
    const { data: docs } = await admin.client
      .from("client_documents")
      .select("tipo, total_paginas, total_chunks");

    const documents = docs || [];
    const total_documents = documents.length;
    const total_chunks = documents.reduce(
      (sum, d) => sum + (d.total_chunks || 0),
      0
    );
    const total_pages = documents.reduce(
      (sum, d) => sum + (d.total_paginas || 0),
      0
    );
    const by_type: Record<string, number> = {};
    for (const d of documents) {
      const t = d.tipo || "desconocido";
      by_type[t] = (by_type[t] || 0) + 1;
    }

    return NextResponse.json({
      total_documents,
      total_chunks,
      total_pages,
      by_type,
    });
  } catch {
    return NextResponse.json({
      total_documents: 0,
      total_chunks: 0,
      total_pages: 0,
      by_type: {},
    });
  }
}
