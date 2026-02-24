import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; docId: string }> }
) {
  const { projectId, docId } = await params;

  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.detail }, { status: admin.status });
  }

  try {
    // Verify the document belongs to this project
    const { data: doc } = await admin.client
      .from("project_documents")
      .select("id, storage_path")
      .eq("id", docId)
      .eq("project_id", projectId)
      .single();

    if (!doc) {
      return NextResponse.json(
        { error: "Documento no encontrado en este proyecto" },
        { status: 404 }
      );
    }

    // Delete dependent rows first (FK constraints)
    await admin.client
      .from("compliance_alerts")
      .delete()
      .eq("doc_id", docId);

    await admin.client
      .from("invoice_lines")
      .delete()
      .eq("doc_id", docId);

    await admin.client
      .from("waste_inventory")
      .delete()
      .eq("fuente_doc_id", docId);

    // Delete chunks
    await admin.client
      .from("project_chunks")
      .delete()
      .eq("document_id", docId);

    // Delete document
    const { error } = await admin.client
      .from("project_documents")
      .delete()
      .eq("id", docId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Delete from Storage if path exists
    if (doc.storage_path) {
      await admin.client.storage
        .from("documentos")
        .remove([doc.storage_path]);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
