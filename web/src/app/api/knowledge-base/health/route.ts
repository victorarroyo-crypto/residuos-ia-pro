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
      {
        ok: false,
        error: admin.detail,
        supabase_connected: false,
      },
      { status: admin.status }
    );
  }

  const sb = admin.client;

  try {
    // 1. Documents by status
    const { data: docs, error: docsErr } = await sb
      .from("knowledge_documents")
      .select("id, titulo, tipo, estado, total_chunks, fecha_ingesta, drive_file_id");

    if (docsErr) {
      return NextResponse.json(
        { ok: false, error: `knowledge_documents: ${docsErr.message}`, supabase_connected: true },
        { status: 500 }
      );
    }

    const documents = docs || [];
    const docsByStatus: Record<string, number> = {};
    let totalChunksExpected = 0;
    for (const d of documents) {
      const s = d.estado || "sin_estado";
      docsByStatus[s] = (docsByStatus[s] || 0) + 1;
      totalChunksExpected += d.total_chunks || 0;
    }

    // 2. Chunks & embeddings
    const { count: totalChunks, error: chunksErr } = await sb
      .from("knowledge_chunks")
      .select("id", { count: "exact", head: true });

    if (chunksErr) {
      return NextResponse.json(
        { ok: false, error: `knowledge_chunks: ${chunksErr.message}`, supabase_connected: true },
        { status: 500 }
      );
    }

    const { count: chunksWithEmbedding, error: embErr } = await sb
      .from("knowledge_chunks")
      .select("id", { count: "exact", head: true })
      .not("embedding", "is", null);

    if (embErr) {
      return NextResponse.json(
        { ok: false, error: `embeddings check: ${embErr.message}`, supabase_connected: true },
        { status: 500 }
      );
    }

    const chunksTotal = totalChunks ?? 0;
    const embeddingsTotal = chunksWithEmbedding ?? 0;

    // 3. Last 5 documents
    const lastDocs = [...documents]
      .sort((a, b) => {
        const da = a.fecha_ingesta || "";
        const db = b.fecha_ingesta || "";
        return db.localeCompare(da);
      })
      .slice(0, 5)
      .map((d) => ({
        id: d.id,
        titulo: d.titulo,
        tipo: d.tipo,
        estado: d.estado,
        total_chunks: d.total_chunks,
        fecha_ingesta: d.fecha_ingesta,
        drive_file_id: d.drive_file_id,
      }));

    // 4. Check drive_file_id column exists (if docs have it, migration was applied)
    const driveFileIdExists =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      documents.length === 0 || documents.some((d: any) => "drive_file_id" in d);

    // 5. Sync log (last 5 runs)
    let syncLog: unknown[] = [];
    let syncError: string | null = null;
    const { data: syncData, error: syncErr } = await sb
      .from("gdrive_sync_log")
      .select(
        "id, status, started_at, completed_at, total_files_found, files_ingested, files_skipped, files_failed, error_message"
      )
      .order("started_at", { ascending: false })
      .limit(5);

    if (syncErr) {
      // Table may not exist if migration_003 hasn't been run
      syncError = syncErr.message;
    } else {
      syncLog = syncData || [];
    }

    // 6. Build diagnosis text
    const diagParts: string[] = [];

    if (documents.length === 0) {
      diagParts.push(
        "No hay documentos en knowledge_documents. La ingesta nunca se ha completado con exito."
      );
    } else {
      diagParts.push(`${documents.length} documento(s) encontrado(s).`);
      if (docsByStatus["error"]) {
        diagParts.push(
          `${docsByStatus["error"]} documento(s) con estado 'error'.`
        );
      }
    }

    if (chunksTotal === 0) {
      diagParts.push(
        "No hay chunks en knowledge_chunks. Los documentos se registraron pero no se particionaron."
      );
    } else {
      diagParts.push(`${chunksTotal} chunk(s) encontrado(s).`);
      if (chunksTotal < totalChunksExpected) {
        diagParts.push(
          `Faltan chunks: se esperaban ${totalChunksExpected} segun total_chunks de los documentos, pero solo hay ${chunksTotal}.`
        );
      }
    }

    if (embeddingsTotal === 0 && chunksTotal > 0) {
      diagParts.push(
        "Hay chunks pero NINGUNO tiene embedding. El RAG no funcionara (revisa OPENAI_API_KEY)."
      );
    } else if (embeddingsTotal < chunksTotal) {
      diagParts.push(
        `${chunksTotal - embeddingsTotal} chunk(s) sin embedding.`
      );
    }

    if (
      documents.length > 0 &&
      chunksTotal > 0 &&
      embeddingsTotal > 0
    ) {
      diagParts.push(
        "Todo OK. Documentos, chunks y embeddings presentes en Supabase."
      );
    }

    return NextResponse.json({
      ok: documents.length > 0 && chunksTotal > 0,
      supabase_connected: true,
      total_documents: documents.length,
      documents_by_status: docsByStatus,
      chunks: {
        total: chunksTotal,
        with_embedding: embeddingsTotal,
        without_embedding: chunksTotal - embeddingsTotal,
        expected_from_docs: totalChunksExpected,
      },
      drive_file_id_column: driveFileIdExists,
      last_5_documents: lastDocs,
      sync_log: syncError
        ? { error: syncError }
        : syncLog,
      diagnosis: diagParts.join(" "),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: `Error inesperado: ${detail}`, supabase_connected: true },
      { status: 500 }
    );
  }
}
