import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json(
      {
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
      .from("client_documents")
      .select("id, titulo, tipo, estado, total_chunks, fecha_ingesta, drive_file_id, client_id");

    if (docsErr) {
      return NextResponse.json(
        { error: `Error querying client_documents: ${docsErr.message}`, supabase_connected: true },
        { status: 500 }
      );
    }

    const documents = docs || [];
    const docsByStatus: Record<string, number> = {};
    for (const d of documents) {
      const s = d.estado || "sin_estado";
      docsByStatus[s] = (docsByStatus[s] || 0) + 1;
    }

    // 2. Chunks & embeddings
    const { count: totalChunks, error: chunksErr } = await sb
      .from("document_chunks")
      .select("id", { count: "exact", head: true });

    const { count: chunksWithEmbedding, error: embErr } = await sb
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .not("embedding", "is", null);

    const chunksTotal = chunksErr ? null : (totalChunks ?? 0);
    const embeddingsTotal = embErr ? null : (chunksWithEmbedding ?? 0);

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
        client_id: d.client_id,
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
        "id, status, started_at, completed_at, total_files_found, files_ingested, files_skipped, files_failed"
      )
      .order("started_at", { ascending: false })
      .limit(5);

    if (syncErr) {
      // Table may not exist if migration_003 hasn't been run
      syncError = syncErr.message;
    } else {
      syncLog = syncData || [];
    }

    // 6. Expected vs actual chunks
    const expectedChunks = documents.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, d: any) => sum + (d.total_chunks || 0),
      0
    );

    // 7. Build diagnosis text
    const diagParts: string[] = [];

    if (documents.length === 0) {
      diagParts.push(
        "No hay documentos en client_documents. La ingesta nunca se ha completado con exito."
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
        "No hay chunks en document_chunks. Los documentos se registraron pero no se particionaron."
      );
    } else if (chunksTotal !== null) {
      diagParts.push(`${chunksTotal} chunk(s) encontrado(s).`);
      if (chunksTotal < expectedChunks) {
        diagParts.push(
          `Faltan chunks: se esperaban ${expectedChunks} segun total_chunks de los documentos, pero solo hay ${chunksTotal}.`
        );
      }
    }

    if (embeddingsTotal === 0 && (chunksTotal ?? 0) > 0) {
      diagParts.push(
        "Hay chunks pero NINGUNO tiene embedding. El RAG no funcionara."
      );
    } else if (
      embeddingsTotal !== null &&
      chunksTotal !== null &&
      embeddingsTotal < chunksTotal
    ) {
      diagParts.push(
        `${chunksTotal - embeddingsTotal} chunk(s) sin embedding.`
      );
    }

    if (
      documents.length > 0 &&
      chunksTotal !== null &&
      chunksTotal > 0 &&
      embeddingsTotal !== null &&
      embeddingsTotal > 0
    ) {
      diagParts.push(
        "Todo OK. Documentos, chunks y embeddings presentes."
      );
    }

    return NextResponse.json({
      supabase_connected: true,
      total_documents: documents.length,
      documents_by_status: docsByStatus,
      chunks: {
        total: chunksTotal,
        with_embedding: embeddingsTotal,
        without_embedding:
          chunksTotal !== null && embeddingsTotal !== null
            ? chunksTotal - embeddingsTotal
            : null,
        expected_from_docs: expectedChunks,
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
      { error: `Error interno: ${detail}`, supabase_connected: true },
      { status: 500 }
    );
  }
}
