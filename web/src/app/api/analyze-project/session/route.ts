import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/analyze-project/session?project_id=xxx
 * Get latest active session for a project (authenticated, ownership verified).
 *
 * POST /api/analyze-project/session
 * Create a new session. Body: { project_id }
 * consultant_id is extracted from authenticated user, not from body.
 */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json(
      { error: "Se requiere project_id" },
      { status: 400 }
    );
  }

  try {
    // Autenticar usuario
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    // Verificar ownership del proyecto
    const admin = getAdminClient();
    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.detail },
        { status: admin.status }
      );
    }
    const { data: project } = await admin.client
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("consultant_id", user.id)
      .single();

    if (!project) {
      return NextResponse.json(
        { error: "Proyecto no encontrado" },
        { status: 403 }
      );
    }

    const response = await fetch(
      `${PIPELINE_URL}/api/analyze/session/${projectId}?consultant_id=${user.id}`,
      { headers: pipelineHeaders() }
    );
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ detail: "Error" }));
      return NextResponse.json(
        { error: err.detail },
        { status: response.status }
      );
    }
    return NextResponse.json(await response.json());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Autenticar usuario
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const body = await request.json();
    if (!body.project_id) {
      return NextResponse.json(
        { error: "Se requiere project_id" },
        { status: 400 }
      );
    }

    // Verificar ownership del proyecto
    const admin = getAdminClient();
    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.detail },
        { status: admin.status }
      );
    }
    const { data: project } = await admin.client
      .from("projects")
      .select("id")
      .eq("id", body.project_id)
      .eq("consultant_id", user.id)
      .single();

    if (!project) {
      return NextResponse.json(
        { error: "Proyecto no encontrado" },
        { status: 403 }
      );
    }

    // Usar user.id como consultant_id (no confiar en el body)
    const form = new FormData();
    form.append("project_id", body.project_id);
    form.append("consultant_id", user.id);

    const response = await fetch(`${PIPELINE_URL}/api/analyze/session`, {
      method: "POST",
      headers: pipelineHeaders(),
      body: form,
    });

    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ detail: "Error" }));
      return NextResponse.json(
        { error: err.detail },
        { status: response.status }
      );
    }
    return NextResponse.json(await response.json());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
