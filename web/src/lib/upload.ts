/**
 * Utilidad de subida de archivos para ResidusIA Pro.
 *
 * Archivos <= 4MB: se envían como base64 en JSON (rápido, una sola petición).
 * Archivos > 4MB: se suben directamente a Supabase Storage via URL firmada,
 * y luego se notifica al pipeline con el storage_path (esquiva el límite de Vercel).
 */

// 4MB threshold — base64 adds ~33%, so 4MB → ~5.3MB, close to Vercel's 4.5MB limit
const DIRECT_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface IngestParams {
  file: File;
  project_id?: string;
  rag_scope?: string;
  password?: string;
  onProgress?: (step: string) => void;
}

interface IngestResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Sube un archivo al pipeline de ingesta.
 * Elige automáticamente entre base64 (archivos pequeños) y
 * subida directa a Storage (archivos grandes).
 */
export async function uploadAndIngest(params: IngestParams): Promise<IngestResult> {
  const { file, project_id, rag_scope, password, onProgress } = params;

  if (file.size <= DIRECT_UPLOAD_THRESHOLD) {
    return uploadViaBase64(params);
  }

  // ── Large file: upload to Storage first, then ingest via storage_path ──
  onProgress?.("subiendo_storage");

  // Step 1: Get signed upload URL
  let signedUrl: string;
  let storagePath: string;
  let token: string;

  try {
    const urlRes = await fetch("/api/upload-signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        project_id,
        content_type: file.type,
      }),
    });

    if (!urlRes.ok) {
      const err = await urlRes.json().catch(() => ({}));
      return { ok: false, error: err.error || "Error obteniendo URL de subida" };
    }

    const urlData = await urlRes.json();
    signedUrl = urlData.signed_url;
    storagePath = urlData.storage_path;
    token = urlData.token;
  } catch (e) {
    return {
      ok: false,
      error: `Error de conexion obteniendo URL de subida: ${e instanceof Error ? e.message : e}`,
    };
  }

  // Step 2: Upload file directly to Supabase Storage
  onProgress?.("subiendo_archivo");

  try {
    const uploadRes = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "");
      return {
        ok: false,
        error: `Error subiendo a Storage (${uploadRes.status}): ${text.slice(0, 200)}`,
      };
    }
  } catch (e) {
    return {
      ok: false,
      error: `Error de conexion subiendo a Storage: ${e instanceof Error ? e.message : e}`,
    };
  }

  // Step 3: Notify pipeline to process from Storage
  onProgress?.("procesando");

  try {
    const ingestRes = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storage_path: storagePath,
        file_name: file.name,
        project_id,
        rag_scope,
        password,
      }),
    });

    if (!ingestRes.ok) {
      const err = await ingestRes.json().catch(() => ({}));
      return { ok: false, error: err.error || err.detail || "Error en el pipeline" };
    }

    const result = await ingestRes.json();
    if (result.error) {
      return { ok: false, error: result.error };
    }

    return { ok: true, data: result };
  } catch (e) {
    return {
      ok: false,
      error: `Error de conexion con el pipeline: ${e instanceof Error ? e.message : e}`,
    };
  }
}

/**
 * Sube un archivo pequeño via base64 (flujo original).
 */
async function uploadViaBase64(params: IngestParams): Promise<IngestResult> {
  const { file, project_id, rag_scope, password, onProgress } = params;

  onProgress?.("subiendo");

  try {
    const base64Data = await fileToBase64(file);

    onProgress?.("procesando");

    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_base64: base64Data,
        file_name: file.name,
        file_type: file.type,
        project_id,
        rag_scope,
        password,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error || err.detail || "Error en el procesamiento" };
    }

    const result = await res.json();
    if (result.error) {
      return { ok: false, error: result.error };
    }

    return { ok: true, data: result };
  } catch (e) {
    return {
      ok: false,
      error: `Error de conexion: ${e instanceof Error ? e.message : e}`,
    };
  }
}

export { DIRECT_UPLOAD_THRESHOLD, fileToBase64 };
