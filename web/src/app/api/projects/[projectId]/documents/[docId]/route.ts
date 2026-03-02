import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

export const maxDuration = 120;

// ─── GET: Signed URL to view/download the document ───────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; docId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { projectId, docId } = await params;

  try {
    const res = await fetch(
      `${PIPELINE_URL}/api/documents/${docId}/url?project_id=${projectId}&consultant_id=${user.id}`,
      { headers: pipelineHeaders() }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Error" }));
      return NextResponse.json(
        { error: err.detail || "Error obteniendo URL" },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}

// ─── PATCH: Reclassify document (proxy to Python) ────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; docId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { projectId, docId } = await params;
  const body = await request.json();
  const newType = body.new_type;

  if (!newType) {
    return NextResponse.json({ error: "new_type es requerido" }, { status: 400 });
  }

  try {
    const res = await fetch(`${PIPELINE_URL}/api/documents/reclassify`, {
      method: "POST",
      headers: pipelineHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        doc_id: docId,
        project_id: projectId,
        new_type: newType,
        consultant_id: user.id,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Error" }));
      return NextResponse.json(
        { error: err.detail || "Error reclasificando" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}

// ─── DELETE: Remove document and all dependencies ────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; docId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { projectId, docId } = await params;

  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.detail }, { status: admin.status });
  }

  try {
    // Verify the project belongs to the authenticated user
    const { data: project } = await admin.client
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("consultant_id", user.id)
      .single();

    if (!project) {
      return NextResponse.json(
        { error: "Proyecto no encontrado o no autorizado" },
        { status: 403 }
      );
    }

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
