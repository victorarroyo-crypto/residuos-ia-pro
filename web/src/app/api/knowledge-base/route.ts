import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.detail }, { status: admin.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const docType = searchParams.get("doc_type");
    const search = searchParams.get("search");

    let query = admin.client
      .from("knowledge_documents")
      .select(
        "id, titulo, tipo, naturaleza_pdf, total_paginas, total_chunks, tablas_encontradas, metadata, estado, fecha_documento, fecha_ingesta"
      )
      .order("fecha_ingesta", { ascending: false });

    if (docType) {
      query = query.eq("tipo", docType);
    }
    if (search) {
      query = query.ilike("titulo", `%${search}%`);
    }

    const { data: documents, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ documents: documents || [] });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error interno: ${detail}` },
      { status: 500 }
    );
  }
}
