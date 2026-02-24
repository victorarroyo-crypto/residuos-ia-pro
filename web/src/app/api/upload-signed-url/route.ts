import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/upload-signed-url
 *
 * Genera una URL firmada para subir un archivo directamente a Supabase Storage,
 * sin pasar por Vercel (esquiva el limite de 4.5MB del body).
 *
 * Body: { filename: string, project_id?: string, content_type?: string }
 * Returns: { signed_url: string, storage_path: string, token: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filename, project_id, content_type } = body;

    if (!filename) {
      return NextResponse.json(
        { error: "Se requiere filename" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.detail },
        { status: admin.status }
      );
    }

    // Sanitize filename: remove accents, spaces, special chars
    const sanitized = sanitizeFilename(filename);

    // Build storage path
    const folder = project_id || "general";
    const timestamp = Date.now();
    const storagePath = `${folder}/_uploads/${timestamp}_${sanitized}`;

    // Create signed upload URL (valid for 10 minutes)
    const { data, error } = await admin.client.storage
      .from("documentos")
      .createSignedUploadUrl(storagePath);

    if (error) {
      console.error("[upload-signed-url] Error creating signed URL:", error);
      return NextResponse.json(
        { error: `Error creando URL de subida: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      signed_url: data.signedUrl,
      storage_path: storagePath,
      token: data.token,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[upload-signed-url] Error:", detail);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

function sanitizeFilename(filename: string): string {
  // Remove path separators
  let name = filename.replace(/[/\\]/g, "_");
  // Replace spaces with underscores
  name = name.replace(/\s+/g, "_");
  // Remove non-ASCII characters (accents, etc)
  name = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Only keep alphanumeric, dots, hyphens, underscores
  name = name.replace(/[^a-zA-Z0-9._-]/g, "");
  return name || "archivo";
}
