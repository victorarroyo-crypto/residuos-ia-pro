import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const supabaseUrl =
    loadEnv("NEXT_PUBLIC_SUPABASE_URL") || loadEnv("SUPABASE_URL");
  const serviceKey = loadEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Supabase no configurado en el servidor." },
      { status: 503 }
    );
  }

  try {
    const sb = createClient(supabaseUrl, serviceKey);
    const { searchParams } = new URL(request.url);
    const docType = searchParams.get("doc_type");
    const search = searchParams.get("search");

    let query = sb
      .from("client_documents")
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
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
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
