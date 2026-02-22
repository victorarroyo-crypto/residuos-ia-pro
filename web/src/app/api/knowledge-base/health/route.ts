import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/knowledge-base/health
 *
 * Diagnostic endpoint that checks whether documents and chunks
 * are actually persisted in Supabase. Useful for verifying the
 * ingestion pipeline is working end-to-end.
 */
export async function GET() {
  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.detail },
      { status: admin.status }
    );
  }

  try {
    // 1. Count documents by estado
    const { data: docs, error: docsErr } = await admin.client
      .from("client_documents")
      .select("id, estado, total_chunks");

    if (docsErr) {
      return NextResponse.json(
        { ok: false, error: `client_documents: ${docsErr.message}` },
        { status: 500 }
      );
    }

    const allDocs = docs || [];
    const docsByEstado: Record<string, number> = {};
    let totalChunksExpected = 0;
    for (const d of allDocs) {
      const e = d.estado || "sin_estado";
      docsByEstado[e] = (docsByEstado[e] || 0) + 1;
      totalChunksExpected += d.total_chunks || 0;
    }

    // 2. Count actual chunks in document_chunks
    const { count: chunksCount, error: chunksErr } = await admin.client
      .from("document_chunks")
      .select("id", { count: "exact", head: true });

    if (chunksErr) {
      return NextResponse.json(
        { ok: false, error: `document_chunks: ${chunksErr.message}` },
        { status: 500 }
      );
    }

    // 3. Count chunks that have embeddings (non-null)
    const { count: embeddingsCount, error: embErr } = await admin.client
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .not("embedding", "is", null);

    if (embErr) {
      return NextResponse.json(
        { ok: false, error: `embeddings check: ${embErr.message}` },
        { status: 500 }
      );
    }

    // 4. Last 5 documents ingested
    const { data: recent } = await admin.client
      .from("client_documents")
      .select("id, titulo, tipo, estado, total_chunks, fecha_ingesta, drive_file_id")
      .order("fecha_ingesta", { ascending: false })
      .limit(5);

    // 5. Last sync log
    const { data: syncs } = await admin.client
      .from("gdrive_sync_log")
      .select("id, status, started_at, completed_at, total_files_found, files_ingested, files_skipped, files_failed, error_message")
      .order("started_at", { ascending: false })
      .limit(3);

    const totalDocs = allDocs.length;
    const totalChunksActual = chunksCount ?? 0;
    const totalEmbeddings = embeddingsCount ?? 0;

    return NextResponse.json({
      ok: totalDocs > 0 && totalChunksActual > 0,
      summary: {
        documents: totalDocs,
        documents_by_estado: docsByEstado,
        chunks_expected: totalChunksExpected,
        chunks_actual: totalChunksActual,
        chunks_with_embedding: totalEmbeddings,
        chunks_without_embedding: totalChunksActual - totalEmbeddings,
      },
      recent_documents: recent || [],
      recent_syncs: syncs || [],
      diagnosis:
        totalDocs === 0
          ? "No hay documentos en client_documents. La ingesta no esta guardando en Supabase."
          : totalChunksActual === 0
            ? "Hay documentos pero 0 chunks. Los chunks no se estan guardando."
            : totalEmbeddings === 0
              ? "Hay chunks pero sin embeddings. Los embeddings no se estan generando (revisa OPENAI_API_KEY)."
              : "Todo OK. Documentos, chunks y embeddings presentes en Supabase.",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: `Error inesperado: ${detail}` },
      { status: 500 }
    );
  }
}
