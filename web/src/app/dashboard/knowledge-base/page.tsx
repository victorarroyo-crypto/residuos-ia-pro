"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  BookOpen,
  Upload,
  Search,
  FileText,
  Trash2,
  Loader2,
  Database,
  X,
  AlertCircle,
  AlertTriangle,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  HardDrive,
  Download,
  CheckCircle2,
  Home,
  RefreshCw,
  Clock,
  XCircle,
  ToggleLeft,
  ToggleRight,
  Activity,
  File,
  RotateCcw,
  Heart,
  Lightbulb,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { uploadAndIngest, DIRECT_UPLOAD_THRESHOLD } from "@/lib/upload";
import type { PipelineProgress } from "@/types/database";

// ─── Types ──────────────────────────────────────────────────
interface KBDocument {
  id: string;
  titulo: string | null;
  tipo: string | null;
  naturaleza_pdf: string | null;
  total_paginas: number | null;
  total_chunks: number | null;
  tablas_encontradas: number | null;
  metadata: Record<string, unknown> | null;
  estado: string | null;
  fecha_documento: string | null;
  fecha_ingesta: string | null;
}

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  isFolder: boolean;
  indexed: boolean | null;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

interface SyncDetail {
  file: string;
  path?: string;
  status: "ingested" | "skipped" | "error" | "replaced";
  reason?: string;
  error?: string;
  document_id?: string;
  chunks?: number;
}

type SyncPhase = "scanning" | "setup_folders" | "ingesting" | "done";

interface RunningSyncDetails {
  phase: SyncPhase;
  current_file: string | null;
  current_path: string | null;
  recent: Array<{
    file: string;
    path: string;
    status: "ingested" | "skipped" | "error";
    ts_iso: string;
    reason?: string;
    error?: string;
  }>;
  errors: Array<{
    file: string;
    path: string;
    error: string;
    suggested_action: string;
  }>;
  rate_per_min: number;
}

type SyncDetailsValue = SyncDetail[] | RunningSyncDetails | string | null | undefined;

// Discriminator: returns RunningSyncDetails if the value matches the new
// structured shape (object with `phase`), or null otherwise.
function asRunningDetails(raw: SyncDetailsValue): RunningSyncDetails | null {
  if (!raw) return null;
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "phase" in (value as Record<string, unknown>)
  ) {
    return value as RunningSyncDetails;
  }
  return null;
}

// Parses the legacy array shape (per-file outcomes). Returns [] for the
// new structured shape so callers that only care about completed-sync
// detail lists keep working.
function asLegacyDetails(raw: SyncDetailsValue): SyncDetail[] {
  if (!raw) return [];
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value as SyncDetail[];
  return [];
}

const SYNC_PHASE_LABELS: Record<SyncPhase, string> = {
  scanning: "Escaneando carpetas",
  setup_folders: "Creando estructura",
  ingesting: "Indexando archivos",
  done: "Finalizando",
};

const SYNC_PHASE_BADGE_CLASS: Record<SyncPhase, string> = {
  scanning: "bg-blue-100 text-blue-800 border-blue-200",
  setup_folders: "bg-purple-100 text-purple-800 border-purple-200",
  ingesting: "bg-vandarum-teal/15 text-vandarum-teal border-vandarum-teal/30",
  done: "bg-green-100 text-green-800 border-green-200",
};

interface SyncLog {
  id: string;
  status: "running" | "completed" | "error";
  started_at: string;
  completed_at: string | null;
  total_files_found: number;
  files_ingested: number;
  files_skipped: number;
  files_failed: number;
  error_message: string | null;
  details: SyncDetail[] | RunningSyncDetails | string;
}

interface IngestQueue {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  total: number;
}

interface SyncStatus {
  last_synced_at: string | null;
  auto_sync_enabled: boolean;
  is_syncing: boolean;
  recent_syncs: SyncLog[];
  queue?: IngestQueue;
}

interface DriveIngestProgress {
  fileId: string;
  fileName: string;
  status: "queued" | "downloading" | "processing" | "done" | "error";
  message: string;
}

interface KBHealthData {
  ok: boolean;
  supabase_connected: boolean;
  total_documents: number;
  documents_by_status: Record<string, number>;
  chunks: {
    total: number;
    with_embedding: number;
    without_embedding: number;
    expected_from_docs: number;
  };
  diagnosis: string;
}

const knowledgeTypeLabels: Record<string, string> = {
  legislacion: "Legislación",
  documentacion_tecnica: "Doc. Técnica",
  gestores_residuos: "Gestores",
  clasificacion_residuos: "Clasificación",
  gestion_operativa: "Gestión Operativa",
  herramientas_plantillas: "Herramientas",
  referencia: "Referencia",
  desconocido: "Sin clasificar",
};

const ACCEPTED_EXTENSIONS =
  ".pdf,.docx,.doc,.txt,.html,.htm,.md,.xlsx,.xls,.csv";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB per file

// fileToBase64 and upload logic moved to @/lib/upload

const stepOrder = [
  "subiendo",
  "detectando_tipo",
  "extrayendo_contenido",
  "clasificando_documento",
  "fragmentando",
  "generando_embeddings",
  "extrayendo_metadatos",
  "almacenando",
  "completado",
] as const;

const stepLabels: Record<string, string> = {
  iniciando: "Iniciando...",
  subiendo: "Subiendo archivo...",
  detectando_tipo: "Detectando tipo de documento",
  extrayendo_contenido: "Extrayendo contenido",
  clasificando_documento: "Clasificando documento",
  fragmentando: "Fragmentando en chunks",
  generando_embeddings: "Generando embeddings",
  extrayendo_metadatos: "Extrayendo metadatos",
  almacenando: "Almacenando en Supabase",
  completado: "Completado",
  error: "Error",
};

interface UploadFileState {
  file: File;
  status: "uploading" | "processing" | "done" | "error";
  progress: PipelineProgress | null;
  error: string | null;
}

async function computeDocId(file: File, ragScope = "general"): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoder = new TextEncoder();
  const scopeBytes = encoder.encode(ragScope);

  const all = new Uint8Array(bytes.length + scopeBytes.length);
  all.set(bytes, 0);
  all.set(scopeBytes, bytes.length);

  const digest = await crypto.subtle.digest("SHA-256", all);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (["xlsx", "xls", "csv"].includes(ext)) {
    return `xls_${hex.slice(0, 12)}`;
  }

  return `doc_${hex.slice(0, 16)}`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "---";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Component ──────────────────────────────────────────────
export default function KnowledgeBasePage() {
  const [activeTab, setActiveTab] = useState<"drive" | "documents" | "search">(
    "drive"
  );

  // User state
  const [userId, setUserId] = useState("");
  const [gdriveConnected, setGdriveConnected] = useState(false);
  const [rootFolderId, setRootFolderId] = useState("");

  // Documents state
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [search, setSearch] = useState("");
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [stats, setStats] = useState({
    total_documents: 0,
    total_chunks: 0,
    total_pages: 0,
    by_type: {} as Record<string, number>,
  });

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [uploadFiles, setUploadFiles] = useState<UploadFileState[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);

  // Health state
  const [health, setHealth] = useState<KBHealthData | null>(null);

  // Reprocess state
  const [reprocessing, setReprocessing] = useState<Set<string>>(new Set());

  // Reclassify state
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyResult, setReclassifyResult] = useState<{
    success: boolean;
    message: string;
    changes?: { titulo: string; old_tipo: string; new_tipo: string }[];
  } | null>(null);

  // Drive browser state
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [driveIngestProgress, setDriveIngestProgress] = useState<DriveIngestProgress[]>([]);

  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message: string;
    details?: SyncDetail[];
  } | null>(null);

  useEffect(() => {
    if (uploadFiles.length === 0) return;

    const supabase = createClient();
    const trackedDocIds = new Set(
      uploadFiles.map((f) => f.progress?.doc_id).filter(Boolean)
    );

    const channel = supabase
      .channel("pipeline-progress-kb")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pipeline_progress",
        },
        (payload) => {
          const progress = payload.new as PipelineProgress;
          if (!progress?.doc_id || !trackedDocIds.has(progress.doc_id)) return;

          setUploadFiles((prev) =>
            prev.map((f) => {
              if (f.progress?.doc_id !== progress.doc_id) return f;
              return {
                ...f,
                progress,
                status:
                  progress.step === "completado"
                    ? "done"
                    : progress.error
                    ? "error"
                    : "processing",
                error: progress.error,
              };
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uploadFiles]);

  // ─── Init: load user + GDrive status ─────────────────────
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id || "";
      setUserId(uid);

      if (uid) {
        // Check GDrive connection
        fetch(`/api/gdrive/status?consultant_id=${uid}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((status) => {
            if (status?.connected) {
              setGdriveConnected(true);
              setRootFolderId(status.root_folder_id);
              // Load sync status
              loadSyncStatus(uid);
            }
          })
          .catch(() => {});
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Load documents ───────────────────────────────────────
  const loadDocuments = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("_t", Date.now().toString());
      const res = await fetch(`/api/knowledge-base?${params.toString()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch {
      // Pipeline might not be running
    } finally {
      setLoadingDocs(false);
    }
  }, [search]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-base/stats");
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {
      // API not available
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-base/health");
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch {
      // API not available
    }
  }, []);

  useEffect(() => {
    loadDocuments();
    loadStats();
    loadHealth();
  }, [loadDocuments, loadStats, loadHealth]);

  // ─── Drive browser ────────────────────────────────────────
  const browseDriveFolder = useCallback(
    async (folderId: string) => {
      if (!userId) return;
      setDriveLoading(true);
      try {
        const params = new URLSearchParams({
          consultant_id: userId,
          folder_id: folderId,
        });
        const res = await fetch(`/api/gdrive/browse?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setDriveItems(data.items || []);
        }
      } catch {
        // Drive not available
      } finally {
        setDriveLoading(false);
      }
    },
    [userId]
  );

  // Load root folder when GDrive is connected
  useEffect(() => {
    if (gdriveConnected && rootFolderId) {
      setBreadcrumbs([{ id: rootFolderId, name: "RAG_Residuos_Industriales" }]);
      browseDriveFolder(rootFolderId);
    }
  }, [gdriveConnected, rootFolderId, browseDriveFolder]);

  function navigateToFolder(folderId: string, folderName: string) {
    setBreadcrumbs((prev) => [...prev, { id: folderId, name: folderName }]);
    browseDriveFolder(folderId);
  }

  function navigateToBreadcrumb(index: number) {
    const crumb = breadcrumbs[index];
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    browseDriveFolder(crumb.id);
  }

  async function handleIngestFromDrive(item: DriveItem) {
    if (!userId || ingesting) return;
    setIngesting(item.id);
    setIngestResult(null);
    setDriveIngestProgress([{
      fileId: item.id,
      fileName: item.name,
      status: "downloading",
      message: "Descargando desde Google Drive...",
    }]);

    try {
      const folderPath = breadcrumbs.map((b) => b.name).join(" / ");
      setDriveIngestProgress([{
        fileId: item.id,
        fileName: item.name,
        status: "processing",
        message: "Procesando e indexando en RAG...",
      }]);
      const res = await fetch("/api/gdrive/ingest-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultant_id: userId,
          file_id: item.id,
          file_name: item.name,
          folder_path: folderPath,
        }),
      });

      if (res.ok) {
        setIngestResult({
          success: true,
          message: `"${item.name}" indexado correctamente.`,
        });
        setDriveIngestProgress([{
          fileId: item.id,
          fileName: item.name,
          status: "done",
          message: "Indexado correctamente",
        }]);
        // Mark as indexed locally
        setDriveItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, indexed: true } : i))
        );
        // Refresh docs and stats
        setLoadingDocs(true);
        loadDocuments();
        loadStats();
      } else {
        const err = await res.json().catch(() => ({ error: "Error" }));
        setIngestResult({
          success: false,
          message: err.error || "Error al indexar el archivo.",
        });
        setDriveIngestProgress([{
          fileId: item.id,
          fileName: item.name,
          status: "error",
          message: err.error || "Error al indexar el archivo.",
        }]);
      }
    } catch {
      setIngestResult({
        success: false,
        message: "Pipeline API no disponible.",
      });
      setDriveIngestProgress([{
        fileId: item.id,
        fileName: item.name,
        status: "error",
        message: "Pipeline API no disponible.",
      }]);
    } finally {
      setIngesting(null);
      setTimeout(() => {
        setIngestResult(null);
        setDriveIngestProgress([]);
      }, 5000);
    }
  }

  // ─── Batch ingest all non-indexed files in current folder ──
  async function handleBatchIngestFromDrive() {
    if (!userId || ingesting) return;
    const pendingFiles = driveItems.filter((i) => !i.isFolder && !i.indexed);
    if (pendingFiles.length === 0) return;

    setIngesting("batch");
    setIngestResult(null);
    setDriveIngestProgress(
      pendingFiles.map((f) => ({
        fileId: f.id,
        fileName: f.name,
        status: "queued",
        message: "En cola...",
      }))
    );

    let successCount = 0;
    let errorCount = 0;
    const total = pendingFiles.length;
    const folderPath = breadcrumbs.map((b) => b.name).join(" / ");

    for (let idx = 0; idx < pendingFiles.length; idx++) {
      const item = pendingFiles[idx];
      // Update progress message
      setIngestResult({
        success: true,
        message: `Indexando ${idx + 1} de ${total}: "${item.name}"...`,
      });
      setDriveIngestProgress((prev) =>
        prev.map((f) =>
          f.fileId === item.id
            ? { ...f, status: "processing", message: "Procesando e indexando en RAG..." }
            : f
        )
      );

      try {
        const res = await fetch("/api/gdrive/ingest-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            consultant_id: userId,
            file_id: item.id,
            file_name: item.name,
            folder_path: folderPath,
          }),
        });

        if (res.ok) {
          successCount++;
          setDriveItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, indexed: true } : i))
          );
          setDriveIngestProgress((prev) =>
            prev.map((f) =>
              f.fileId === item.id
                ? { ...f, status: "done", message: "Indexado correctamente" }
                : f
            )
          );
        } else {
          errorCount++;
          setDriveIngestProgress((prev) =>
            prev.map((f) =>
              f.fileId === item.id
                ? { ...f, status: "error", message: "Error al indexar archivo" }
                : f
            )
          );
        }
      } catch {
        errorCount++;
        setDriveIngestProgress((prev) =>
          prev.map((f) =>
            f.fileId === item.id
              ? { ...f, status: "error", message: "Error de conexion con pipeline" }
              : f
          )
        );
      }
    }

    setIngesting(null);
    setIngestResult({
      success: errorCount === 0,
      message: `Indexado completado: ${successCount} exitosos${errorCount > 0 ? `, ${errorCount} errores` : ""} de ${total} archivos.`,
    });
    setLoadingDocs(true);
    await Promise.all([loadDocuments(), loadStats()]);
    setTimeout(() => setDriveIngestProgress([]), 5000);
  }

  // ─── Upload handler ───────────────────────────────────────
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadResult(null);

    // Validate file sizes before starting
    const selectedFiles = Array.from(files);
    const oversized = selectedFiles.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setUploading(false);
      setUploadResult({
        success: false,
        message: `${oversized.length} archivo${oversized.length > 1 ? "s" : ""} superan el limite de 100 MB: ${oversized.map((f) => f.name).join(", ")}`,
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    const initialStates: UploadFileState[] = await Promise.all(
      selectedFiles.map(async (file) => {
        const docId = await computeDocId(file, "general");
        const isLarge = file.size > DIRECT_UPLOAD_THRESHOLD;
        return {
          file,
          status: "uploading" as const,
          progress: {
            doc_id: docId,
            step: "subiendo",
            percentage: 5,
            mensaje: isLarge
              ? "Subiendo archivo grande a Storage..."
              : "Subiendo archivo...",
            error: null,
            updated_at: null,
          },
          error: null,
        };
      })
    );
    setUploadFiles(initialStates);

    for (const fileState of initialStates) {
      const docId = fileState.progress?.doc_id || "";

      try {
        const result = await uploadAndIngest({
          file: fileState.file,
          rag_scope: "general",
          onProgress: (step) => {
            setUploadFiles((prev) =>
              prev.map((f) =>
                f.progress?.doc_id === docId
                  ? {
                      ...f,
                      status: "processing",
                      progress: {
                        doc_id: docId,
                        step: step === "procesando" ? "detectando_tipo" : "subiendo",
                        percentage: step === "procesando" ? 15 : 10,
                        mensaje:
                          step === "subiendo_storage"
                            ? "Subiendo a Storage (archivo grande)..."
                            : step === "subiendo_archivo"
                            ? "Subiendo archivo a Storage..."
                            : "Enviado al pipeline, procesando...",
                        error: null,
                        updated_at: null,
                      },
                    }
                  : f
              )
            );
          },
        });

        if (result.ok) {
          successCount++;
          setUploadFiles((prev) =>
            prev.map((f) =>
              f.progress?.doc_id === docId
                ? {
                    ...f,
                    status: "done",
                    progress: {
                      doc_id: docId,
                      step: "completado",
                      percentage: 100,
                      mensaje: "Completado",
                      error: null,
                      updated_at: null,
                    },
                  }
                : f
            )
          );
        } else {
          errorCount++;
          setUploadFiles((prev) =>
            prev.map((f) =>
              f.progress?.doc_id === docId
                ? {
                    ...f,
                    status: "error",
                    error: result.error || "Error al procesar",
                    progress: {
                      doc_id: docId,
                      step: "error",
                      percentage: 0,
                      mensaje: null,
                      error: result.error || "Error",
                      updated_at: null,
                    },
                  }
                : f
            )
          );
        }
      } catch (err) {
        errorCount++;
        const detail = err instanceof Error ? err.message : String(err);
        setUploadFiles((prev) =>
          prev.map((f) =>
            f.progress?.doc_id === docId
              ? {
                  ...f,
                  status: "error",
                  error: detail.includes("Failed to fetch") || detail.includes("NetworkError")
                    ? "Error de red. Verifica tu conexion y que el servidor esta activo."
                    : detail.includes("413")
                    ? "Archivo demasiado grande para el servidor."
                    : detail || "Error de conexion con el pipeline",
                  progress: {
                    doc_id: docId,
                    step: "error",
                    percentage: 0,
                    mensaje: null,
                    error: detail || "Error",
                    updated_at: null,
                  },
                }
              : f
          )
        );
      }
    }

    setUploading(false);
    setUploadResult({
      success: errorCount === 0,
      message:
        errorCount === 0
          ? `${successCount} documento${successCount !== 1 ? "s" : ""} subido${successCount !== 1 ? "s" : ""} correctamente`
          : `${successCount} subidos, ${errorCount} con error`,
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
    setLoadingDocs(true);
    await Promise.all([loadDocuments(), loadStats()]);
  }

  // ─── Delete handler ───────────────────────────────────────
  async function handleDelete(docId: string) {
    setDeleting(docId);
    try {
      const res = await fetch(`/api/knowledge-base/${docId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== docId));
        loadStats();
      }
    } catch {
      // Silently fail
    } finally {
      setDeleting(null);
    }
  }

  // ─── Reprocess handler ──────────────────────────────────────
  async function handleReprocess(docIds: string[]) {
    const newSet = new Set(reprocessing);
    docIds.forEach((id) => newSet.add(id));
    setReprocessing(newSet);

    try {
      const res = await fetch("/api/knowledge-base/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_ids: docIds, scope: "knowledge" }),
      });

      if (res.ok) {
        const data = await res.json();
        setUploadResult({
          success: data.failed === 0,
          message:
            data.failed === 0
              ? `${data.success} documento${data.success !== 1 ? "s" : ""} reprocesado${data.success !== 1 ? "s" : ""} correctamente.`
              : `${data.success} reprocesados, ${data.failed} con error.`,
        });
        // Refresh data
        setLoadingDocs(true);
        await Promise.all([loadDocuments(), loadStats(), loadHealth()]);
      } else {
        const err = await res.json().catch(() => ({}));
        setUploadResult({
          success: false,
          message: err.error || "Error al reprocesar documentos.",
        });
      }
    } catch {
      setUploadResult({
        success: false,
        message: "Pipeline API no disponible para reprocesamiento.",
      });
    } finally {
      const cleared = new Set(reprocessing);
      docIds.forEach((id) => cleared.delete(id));
      setReprocessing(cleared);
    }
  }

  // ─── Reclassify handler ───────────────────────────────────
  async function handleReclassify() {
    setReclassifying(true);
    setReclassifyResult(null);
    try {
      const res = await fetch("/api/knowledge-base/reclassify", {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setReclassifyResult({
          success: true,
          message:
            data.reclassified > 0
              ? `${data.reclassified} documento${data.reclassified !== 1 ? "s" : ""} reclasificado${data.reclassified !== 1 ? "s" : ""} de ${data.total}.`
              : `Todos los ${data.total} documentos ya tenian la clasificacion correcta.`,
          changes: data.changes,
        });
        if (data.reclassified > 0) {
          setLoadingDocs(true);
          await loadDocuments();
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setReclassifyResult({
          success: false,
          message: err.error || "Error al reclasificar.",
        });
      }
    } catch {
      setReclassifyResult({
        success: false,
        message: "Pipeline API no disponible.",
      });
    } finally {
      setReclassifying(false);
    }
  }

  // ─── Upload retry handler ──────────────────────────────────
  async function handleRetryUpload(fileState: UploadFileState) {
    const docId = fileState.progress?.doc_id;
    if (!docId) return;

    setUploadFiles((prev) =>
      prev.map((f) =>
        f.progress?.doc_id === docId
          ? {
              ...f,
              status: "uploading",
              error: null,
              progress: {
                doc_id: docId,
                step: "subiendo",
                percentage: 5,
                mensaje: "Reintentando...",
                error: null,
                updated_at: null,
              },
            }
          : f
      )
    );

    try {
      const result = await uploadAndIngest({
        file: fileState.file,
        rag_scope: "general",
        onProgress: (step) => {
          setUploadFiles((prev) =>
            prev.map((f) =>
              f.progress?.doc_id === docId
                ? {
                    ...f,
                    status: "processing",
                    progress: {
                      doc_id: docId,
                      step: step === "procesando" ? "detectando_tipo" : "subiendo",
                      percentage: step === "procesando" ? 15 : 10,
                      mensaje: "Reintentando...",
                      error: null,
                      updated_at: null,
                    },
                  }
                : f
            )
          );
        },
      });

      if (result.ok) {
        setUploadFiles((prev) =>
          prev.map((f) =>
            f.progress?.doc_id === docId
              ? {
                  ...f,
                  status: "done",
                  progress: {
                    doc_id: docId,
                    step: "completado",
                    percentage: 100,
                    mensaje: "Completado",
                    error: null,
                    updated_at: null,
                  },
                }
              : f
          )
        );
        setLoadingDocs(true);
        await Promise.all([loadDocuments(), loadStats(), loadHealth()]);
      } else {
        setUploadFiles((prev) =>
          prev.map((f) =>
            f.progress?.doc_id === docId
              ? {
                  ...f,
                  status: "error",
                  error: result.error || "Error al reprocesar",
                  progress: {
                    doc_id: docId,
                    step: "error",
                    percentage: 0,
                    mensaje: null,
                    error: result.error || "Error",
                    updated_at: null,
                  },
                }
              : f
          )
        );
      }
    } catch {
      setUploadFiles((prev) =>
        prev.map((f) =>
          f.progress?.doc_id === docId
            ? {
                ...f,
                status: "error",
                error: "Error de conexion con el pipeline (reintento)",
              }
            : f
        )
      );
    }
  }

  // ─── Auto-sync polling ──────────────────────────────────────
  // When auto-sync is enabled and page is open, poll every 6 hours
  const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!gdriveConnected || !userId || !syncStatus?.auto_sync_enabled) return;

    async function pollSync() {
      // Skip if already syncing, page hidden, or sync happened recently
      if (syncingRef.current || document.hidden) return;

      const lastSync = syncStatus?.last_synced_at;
      if (lastSync) {
        const elapsed = Date.now() - new Date(lastSync).getTime();
        if (elapsed < SYNC_INTERVAL_MS) return;
      }

      syncingRef.current = true;
      try {
        const res = await fetch("/api/gdrive/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consultant_id: userId }),
        });

        if (res.ok) {
          const data = await res.json();
          // Only show notification if new files were ingested
          if (data.files_ingested > 0) {
            // PR #186 backend may return the structured object shape; only
            // pass through the legacy array — the toast UI filters by status.
            const details = asLegacyDetails(data.details);
            setSyncResult({
              success: true,
              message: `Auto-sync: ${data.files_ingested} documento${data.files_ingested !== 1 ? "s" : ""} nuevo${data.files_ingested !== 1 ? "s" : ""} indexado${data.files_ingested !== 1 ? "s" : ""}.`,
              details,
            });
            setLoadingDocs(true);
            loadDocuments();
            loadStats();
            if (breadcrumbs.length > 0) {
              browseDriveFolder(breadcrumbs[breadcrumbs.length - 1].id);
            }
          }
          loadSyncStatus();
        }
      } catch {
        // Silently fail on auto-sync
      } finally {
        syncingRef.current = false;
      }
    }

    // Initial check after 10 seconds
    const initialTimeout = setTimeout(pollSync, 10_000);
    // Then every 5 minutes
    const interval = setInterval(pollSync, SYNC_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [gdriveConnected, userId, syncStatus?.auto_sync_enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Sync functions ────────────────────────────────────────

  async function loadSyncStatus(uid?: string) {
    const id = uid || userId;
    if (!id) return;
    try {
      const res = await fetch(`/api/gdrive/sync-status?consultant_id=${id}`);
      if (res.ok) {
        const data: SyncStatus = await res.json();
        setSyncStatus(data);

        // Auto-resume polling if a sync is running (started by the 6h auto-sync,
        // from another tab, or before this page was loaded). Without this the
        // user has to click "Sincronizar ahora" to see progress, which is
        // misleading when a sync is already in flight.
        if (data.is_syncing && !syncing) {
          setSyncing(true);
          const running = data.recent_syncs.find((s) => s.status === "running");
          if (running) {
            const q = data.queue;
            const useQueue = !!q && q.total > 0;
            const processed = useQueue
              ? q!.done + q!.failed
              : running.files_ingested + running.files_skipped + running.files_failed;
            const total = useQueue ? q!.total : running.total_files_found || 0;
            setSyncResult({
              success: true,
              message: total > 0
                ? `Sync en curso: ${processed} de ${total} archivos procesados`
                : "Sync en curso: escaneando Google Drive...",
            });
          }
          pollUntilComplete();
        }
      }
    } catch {
      // API not available
    }
  }

  async function handleSync() {
    if (!userId || syncing) return;
    setSyncing(true);
    setSyncResult(null);

    try {
      const res = await fetch("/api/gdrive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consultant_id: userId }),
      });

      if (res.ok) {
        const data = await res.json();

        if (data.status === "running" || data.status === "already_running") {
          // Sync is running in background on Pipeline server.
          // Poll sync-status every 5s until it finishes.
          setSyncResult({
            success: true,
            message: "Sincronizacion iniciada. Procesando documentos en segundo plano...",
          });
          pollUntilComplete();
        } else {
          // Sync completed synchronously (e.g. no new files). Backend may
          // return either the legacy array or the new structured object —
          // use the helper to coerce safely for the toast filter UI.
          const details = asLegacyDetails(data.details);

          setSyncResult({
            success: true,
            message: `Sync completado: ${data.files_ingested} nuevos, ${data.files_skipped} ya indexados${data.files_failed ? `, ${data.files_failed} errores` : ""}`,
            details,
          });
          refreshAfterSync();
          setSyncing(false);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        const detail = err.error || err.detail || err.message;
        setSyncResult({
          success: false,
          message: detail
            ? `Error de sincronizacion: ${detail}`
            : `Error de sincronizacion (status ${res.status}). Revisa los logs del Pipeline.`,
        });
        setSyncing(false);
      }
    } catch {
      setSyncResult({
        success: false,
        message: "Pipeline API no disponible. Verifica que el servidor Python esta activo y que PIPELINE_API_URL esta configurado correctamente.",
      });
      setSyncing(false);
    }
  }

  function refreshAfterSync() {
    setLoadingDocs(true);
    loadDocuments();
    loadStats();
    loadSyncStatus();
    if (breadcrumbs.length > 0) {
      browseDriveFolder(breadcrumbs[breadcrumbs.length - 1].id);
    }
  }

  function pollUntilComplete() {
    const POLL_INTERVAL = 5000; // 5 seconds
    const MAX_POLLS = 17280; // 24h safety cap — initial syncs on large Drives can take hours
    let polls = 0;

    const interval = setInterval(async () => {
      polls++;
      try {
        const res = await fetch(
          `/api/gdrive/sync-status?consultant_id=${userId}`
        );
        if (!res.ok) return;

        const status: SyncStatus = await res.json();
        setSyncStatus(status);

        const runningSyncLog = status.recent_syncs.find(
          (s) => s.status === "running"
        );
        const isStillRunning = !!runningSyncLog;

        // Show live progress while syncing
        if (isStillRunning && runningSyncLog) {
          const { total_files_found, files_ingested, files_skipped, files_failed } = runningSyncLog;
          const q = status.queue;
          const useQueue = !!q && q.total > 0;
          const processed = useQueue
            ? q!.done + q!.failed
            : files_ingested + files_skipped + files_failed;
          const total = useQueue ? q!.total : total_files_found || 0;
          const progressMsg = total > 0
            ? useQueue
              ? `Procesando... ${processed} de ${total} en cola (${q!.done} indexados${q!.processing > 0 ? `, ${q!.processing} procesando` : ""}${q!.failed ? `, ${q!.failed} errores` : ""})`
              : `Procesando... ${processed} de ${total} archivos (${files_ingested} nuevos, ${files_skipped} ya indexados${files_failed ? `, ${files_failed} errores` : ""})`
            : "Buscando archivos en Google Drive...";
          setSyncResult({
            success: true,
            message: progressMsg,
          });
        }

        if (!isStillRunning || polls >= MAX_POLLS) {
          clearInterval(interval);
          setSyncing(false);

          // Find the most recent completed sync for result summary
          const lastCompleted = status.recent_syncs.find(
            (s) => s.status === "completed" || s.status === "error"
          );
          if (lastCompleted) {
            if (lastCompleted.status === "completed") {
              // Same dual-shape handling as elsewhere — coerce to legacy
              // array for the toast filter UI.
              const details = asLegacyDetails(lastCompleted.details);
              setSyncResult({
                success: true,
                message: `Sync completado: ${lastCompleted.files_ingested} nuevos, ${lastCompleted.files_skipped} ya indexados${lastCompleted.files_failed ? `, ${lastCompleted.files_failed} errores` : ""}`,
                details,
              });
            } else {
              setSyncResult({
                success: false,
                message: lastCompleted.error_message || "Error durante la sincronizacion.",
              });
            }
          }
          refreshAfterSync();
        }
      } catch {
        // Silently retry on next poll
      }
    }, POLL_INTERVAL);
  }

  async function handleToggleAutoSync() {
    if (!userId || !syncStatus) return;
    const newValue = !syncStatus.auto_sync_enabled;
    try {
      const res = await fetch("/api/gdrive/sync-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultant_id: userId,
          enabled: newValue,
        }),
      });
      if (res.ok) {
        setSyncStatus((prev) =>
          prev ? { ...prev, auto_sync_enabled: newValue } : prev
        );
      }
    } catch {
      // Silently fail
    }
  }

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Base de Conocimiento
          </h1>
          <p className="text-muted-foreground">
            Navega tu Google Drive, indexa documentos y consulta con IA.
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            onChange={handleUpload}
            className="hidden"
            id="kb-upload"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            variant="outline"
          >
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {uploading ? "Subiendo..." : "Subir local"}
          </Button>
        </div>
      </div>

      {/* Toasts */}
      {uploadResult && (
        <div
          className={`flex items-center gap-2 rounded-md p-3 text-sm ${
            uploadResult.success
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {uploadResult.success ? (
            <FileText className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {uploadResult.message}
          <button onClick={() => setUploadResult(null)} className="ml-auto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {uploadFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progreso de subida (RAG General)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {uploadFiles.map((fileState) => (
              <div
                key={`${fileState.file.name}-${fileState.progress?.doc_id ?? "no-doc"}`}
                className="rounded-md border p-3"
              >
                <div className="flex items-start gap-2">
                  <File className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{fileState.file.name}</div>
                    {fileState.progress && (
                      <>
                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{stepLabels[fileState.progress.step] ?? fileState.progress.step}</span>
                          <span>{fileState.progress.percentage}%</span>
                        </div>
                        <div className="mt-1 h-2 w-full rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-vandarum-teal transition-all"
                            style={{ width: `${fileState.progress.percentage}%` }}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {stepOrder.map((step) => {
                            const current = stepOrder.indexOf(
                              fileState.progress!.step as (typeof stepOrder)[number]
                            );
                            const idx = stepOrder.indexOf(step);
                            const isCurrent = fileState.progress?.step === step;
                            const isDone = current >= 0 && idx < current;
                            return (
                              <span
                                key={`${fileState.progress?.doc_id}-${step}`}
                                className={`rounded-full px-2 py-0.5 text-[10px] border ${
                                  isCurrent
                                    ? "bg-vandarum-blue/15 border-vandarum-blue text-vandarum-blue"
                                    : isDone
                                    ? "bg-vandarum-green/15 border-vandarum-green text-vandarum-green"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {stepLabels[step]}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {fileState.error && (
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-xs text-destructive flex-1">{fileState.error}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRetryUpload(fileState)}
                          className="h-6 px-2 text-xs shrink-0"
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Reintentar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {ingestResult && (
        <div
          className={`flex items-center gap-2 rounded-md p-3 text-sm ${
            ingestResult.success
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {ingestResult.success ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {ingestResult.message}
          <button onClick={() => setIngestResult(null)} className="ml-auto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Persistent sync progress card — visible whenever a sync is running,
          regardless of whether it was started from this tab or by the 6h
          auto-sync. Reads directly from gdrive_sync_log via syncStatus.
          Renders rich progress (phase, current file, recent activity, errors)
          when the backend writes the new structured details shape. */}
      {(() => {
        const running = syncStatus?.recent_syncs?.find((s) => s.status === "running");
        if (!running) return null;
        return <RunningSyncCard sync={running} queue={syncStatus?.queue} />;
      })()}

      {/* Sync result toast */}
      {syncResult && (
        <div
          className={`flex items-start gap-2 rounded-md p-3 text-sm ${
            syncResult.success
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {syncResult.success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span className="font-medium">{syncResult.message}</span>
            </div>
            {/* Progress bar while syncing */}
            {syncing && syncStatus?.recent_syncs?.find((s) => s.status === "running") && (() => {
              const run = syncStatus.recent_syncs.find((s) => s.status === "running")!;
              // Queue model (Fase 2): the worker ingests in the background, so
              // files_ingested in the sync-log stays 0. Prefer ingest_jobs counts
              // when available so the bar reflects real progress.
              const q = syncStatus.queue;
              const useQueue = !!q && q.total > 0;
              const processed = useQueue
                ? q!.done + q!.failed
                : run.files_ingested + run.files_skipped + run.files_failed;
              const total = useQueue ? q!.total : run.total_files_found || 0;
              const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
              return total > 0 ? (
                <div className="mt-2 ml-6">
                  <div className="w-full bg-green-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-green-700 mt-1">
                    {pct}% completado
                    {useQueue
                      ? ` · ${processed} de ${total} en cola${q!.processing > 0 ? ` · ${q!.processing} procesando` : ""}`
                      : ""}
                  </p>
                </div>
              ) : null;
            })()}
            {syncResult.details && syncResult.details.length > 0 && (() => {
              const errors = syncResult.details.filter((d) => d.status === "error");
              const ingested = syncResult.details.filter((d) => d.status === "ingested");
              const skipped = syncResult.details.filter((d) => d.status === "skipped");
              const replacedMd = syncResult.details.filter((d) => d.status === "replaced");
              return (
                <div className="mt-2 ml-6 space-y-2">
                  {/* Errores primero, siempre visibles */}
                  {errors.length > 0 && (
                    <div className="rounded-md border border-red-200 bg-red-50/50 p-2">
                      <p className="text-xs font-medium text-red-800 mb-1">
                        {errors.length} error{errors.length !== 1 ? "es" : ""}:
                      </p>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {errors.map((d, i) => (
                          <div key={i} className="flex items-start gap-1 text-xs">
                            <XCircle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
                            <span className="font-medium">{d.file}</span>
                            {d.error && (
                              <span className="text-red-600">— {d.error}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Reemplazados .md → PDF */}
                  {replacedMd.length > 0 && (
                    <p className="text-xs text-blue-700">
                      <RefreshCw className="h-3 w-3 inline mr-1" />
                      {replacedMd.length} .md reemplazado{replacedMd.length !== 1 ? "s" : ""} por PDF
                    </p>
                  )}
                  {/* Resumen de exitosos y saltados */}
                  {ingested.length > 0 && (
                    <p className="text-xs text-green-700">
                      <CheckCircle2 className="h-3 w-3 inline mr-1" />
                      {ingested.length} indexado{ingested.length !== 1 ? "s" : ""} correctamente
                    </p>
                  )}
                  {skipped.length > 0 && (
                    <p className="text-xs text-gray-500">
                      <Clock className="h-3 w-3 inline mr-1" />
                      {skipped.length} ya existente{skipped.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
          <button onClick={() => setSyncResult(null)} className="shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Reclassify result */}
      {reclassifyResult && (
        <div
          className={`flex items-start gap-2 rounded-md p-3 text-sm ${
            reclassifyResult.success
              ? "bg-blue-50 text-blue-800 border border-blue-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {reclassifyResult.success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span className="font-medium">{reclassifyResult.message}</span>
            </div>
            {reclassifyResult.changes && reclassifyResult.changes.length > 0 && (
              <div className="mt-2 ml-6 rounded-md border border-blue-200 bg-blue-50/50 p-2">
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {reclassifyResult.changes.map((c, i) => (
                    <div key={i} className="flex items-start gap-1 text-xs">
                      <RefreshCw className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
                      <span className="font-medium truncate" title={c.titulo}>{c.titulo}</span>
                      <span className="text-blue-600 shrink-0">{c.old_tipo} → {c.new_tipo}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={() => setReclassifyResult(null)} className="shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Sync control bar */}
      {gdriveConnected && (
        <Card>
          <CardContent className="flex items-center gap-4 py-3">
            <Activity className="h-5 w-5 text-vandarum-teal shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  Auto-Sync Google Drive
                </span>
                {syncStatus?.auto_sync_enabled ? (
                  <Badge variant="success" className="text-xs">Activo</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Pausado</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {syncStatus?.auto_sync_enabled
                  ? "Nuevos documentos se detectan e indexan automaticamente mientras esta pagina este abierta."
                  : "Sincronizacion automatica desactivada."}
                {syncStatus?.last_synced_at && (
                  <>
                    {" "}Ultimo sync:{" "}
                    {new Date(syncStatus.last_synced_at).toLocaleString("es-ES")}
                  </>
                )}
              </p>
            </div>
            <button
              onClick={handleToggleAutoSync}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title={syncStatus?.auto_sync_enabled ? "Desactivar auto-sync" : "Activar auto-sync"}
            >
              {syncStatus?.auto_sync_enabled ? (
                <ToggleRight className="h-7 w-7 text-vandarum-teal" />
              ) : (
                <ToggleLeft className="h-7 w-7" />
              )}
            </button>
            <Button
              onClick={handleSync}
              disabled={syncing}
              size="sm"
              className="bg-vandarum-teal hover:bg-vandarum-teal/90 shrink-0"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              {syncing ? "Sincronizando..." : "Sincronizar ahora"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Documentos indexados
            </CardTitle>
            <BookOpen className="h-4 w-4 text-vandarum-teal" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_documents}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Chunks indexados
            </CardTitle>
            <Database className="h-4 w-4 text-vandarum-blue" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_chunks}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Paginas procesadas
            </CardTitle>
            <FileText className="h-4 w-4 text-vandarum-green" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_pages}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Google Drive
            </CardTitle>
            <HardDrive className="h-4 w-4 text-vandarum-orange" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {gdriveConnected ? (
                <Badge variant="success">Conectado</Badge>
              ) : (
                <Badge variant="secondary">Sin conectar</Badge>
              )}
            </div>
            {syncStatus?.last_synced_at && (
              <p className="text-xs text-muted-foreground mt-1">
                Ultimo sync:{" "}
                {new Date(syncStatus.last_synced_at).toLocaleString("es-ES", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RAG Health Alert */}
      {health && !health.ok && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="flex items-start gap-3 py-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900">
                Problemas detectados en la Base de Conocimiento
              </p>
              <p className="text-xs text-amber-800 mt-1">
                {health.diagnosis}
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-amber-700">
                <span>{health.total_documents} docs</span>
                <span>{health.chunks.total} chunks</span>
                <span>{health.chunks.with_embedding} con embedding</span>
                {health.chunks.without_embedding > 0 && (
                  <span className="font-medium text-amber-900">
                    {health.chunks.without_embedding} sin embedding
                  </span>
                )}
              </div>
              {health.documents_by_status["error"] && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-300 text-amber-900 hover:bg-amber-100"
                    onClick={() => {
                      const errorDocs = documents.filter((d) => d.estado === "error");
                      if (errorDocs.length > 0) {
                        handleReprocess(errorDocs.map((d) => d.id));
                      }
                    }}
                    disabled={reprocessing.size > 0}
                  >
                    {reprocessing.size > 0 ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3 mr-1" />
                    )}
                    Reprocesar documentos con error ({health.documents_by_status["error"]})
                  </Button>
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={loadHealth}
              className="shrink-0 h-7 w-7 p-0"
              title="Actualizar diagnostico"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {health && health.ok && health.chunks.without_embedding > 0 && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="flex items-center gap-3 py-3">
            <Heart className="h-5 w-5 text-blue-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-blue-900">
                RAG operativo. <span className="font-medium">{health.chunks.without_embedding} chunk{health.chunks.without_embedding !== 1 ? "s" : ""} sin embedding</span> (no afecta busqueda pero reduce cobertura).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => setActiveTab("drive")}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "drive"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <HardDrive className="h-4 w-4" />
          Google Drive
        </button>
        <button
          onClick={() => setActiveTab("documents")}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "documents"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="h-4 w-4" />
          Documentos indexados
        </button>
        <button
          onClick={() => setActiveTab("search")}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "search"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Search className="h-4 w-4" />
          Buscar RAG
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "drive" ? (
        <DriveTab
          connected={gdriveConnected}
          items={driveItems}
          loading={driveLoading}
          breadcrumbs={breadcrumbs}
          ingesting={ingesting}
          syncStatus={syncStatus}
          driveIngestProgress={driveIngestProgress}
          onNavigateFolder={navigateToFolder}
          onNavigateBreadcrumb={navigateToBreadcrumb}
          onIngest={handleIngestFromDrive}
          onBatchIngest={handleBatchIngestFromDrive}
        />
      ) : activeTab === "documents" ? (
        <DocumentsTab
          documents={documents}
          search={search}
          setSearch={setSearch}
          loading={loadingDocs}
          deleting={deleting}
          reprocessing={reprocessing}
          reclassifying={reclassifying}
          onDelete={handleDelete}
          onReprocess={handleReprocess}
          onReclassify={handleReclassify}
          onSearch={() => {
            setLoadingDocs(true);
            loadDocuments();
          }}
        />
      ) : (
        <SearchTab />
      )}
    </div>
  );
}

// ─── Drive Tab ──────────────────────────────────────────────
function DriveTab({
  connected,
  items,
  loading,
  breadcrumbs,
  ingesting,
  syncStatus,
  driveIngestProgress,
  onNavigateFolder,
  onNavigateBreadcrumb,
  onIngest,
  onBatchIngest,
}: {
  connected: boolean;
  items: DriveItem[];
  loading: boolean;
  breadcrumbs: BreadcrumbItem[];
  ingesting: string | null;
  syncStatus: SyncStatus | null;
  driveIngestProgress: DriveIngestProgress[];
  onNavigateFolder: (id: string, name: string) => void;
  onNavigateBreadcrumb: (index: number) => void;
  onIngest: (item: DriveItem) => void;
  onBatchIngest: () => void;
}) {
  if (!connected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <HardDrive className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-lg font-medium">Google Drive no conectado</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Conecta Google Drive desde Ajustes para navegar y sincronizar
            documentos.
          </p>
          <a href="/dashboard/settings">
            <Button variant="outline">Ir a Ajustes</Button>
          </a>
        </CardContent>
      </Card>
    );
  }

  const folders = items.filter((i) => i.isFolder);
  const files = items.filter((i) => !i.isFolder);
  const pendingFiles = files.filter((f) => !f.indexed);

  return (
    <Card>
      <CardHeader className="pb-3">
        {/* Breadcrumbs + Batch Ingest */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-sm flex-wrap">
          {breadcrumbs.map((crumb, idx) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {idx > 0 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
              {idx === breadcrumbs.length - 1 ? (
                <span className="font-medium">{crumb.name}</span>
              ) : (
                <button
                  onClick={() => onNavigateBreadcrumb(idx)}
                  className="text-vandarum-teal hover:underline"
                >
                  {idx === 0 ? (
                    <span className="flex items-center gap-1">
                      <Home className="h-3 w-3" />
                      {crumb.name}
                    </span>
                  ) : (
                    crumb.name
                  )}
                </button>
              )}
            </span>
          ))}
          </div>
          {/* Batch ingest button */}
          {pendingFiles.length > 0 && (
            <Button
              size="sm"
              onClick={onBatchIngest}
              disabled={!!ingesting}
              className="bg-vandarum-teal hover:bg-vandarum-teal/90 shrink-0"
            >
              {ingesting === "batch" ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              {ingesting === "batch"
                ? "Indexando..."
                : `Indexar todos (${pendingFiles.length})`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {driveIngestProgress.length > 0 && (
          <div className="mb-4 rounded-md border p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Progreso de indexacion desde Google Drive</p>
            {driveIngestProgress.map((progressItem) => (
              <div key={progressItem.fileId} className="flex items-center gap-2 text-xs">
                {progressItem.status === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-vandarum-green" />
                ) : progressItem.status === "error" ? (
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-vandarum-teal" />
                )}
                <span className="font-medium truncate max-w-[280px]">{progressItem.fileName}</span>
                <span className="text-muted-foreground">{progressItem.message}</span>
              </div>
            ))}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-vandarum-teal" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">Esta carpeta esta vacia.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Folders first */}
            {folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => onNavigateFolder(folder.id, folder.name)}
                className="flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-left hover:bg-muted transition-colors group"
              >
                <FolderOpen className="h-5 w-5 text-vandarum-teal shrink-0" />
                <span className="flex-1 text-sm font-medium truncate group-hover:text-vandarum-teal">
                  {folder.name.replace(/_/g, " ")}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}

            {/* Files */}
            {files.length > 0 && folders.length > 0 && (
              <div className="border-t my-2" />
            )}
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
              >
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                    {file.modifiedTime &&
                      ` · ${new Date(file.modifiedTime).toLocaleDateString("es-ES")}`}
                  </p>
                </div>
                {file.indexed ? (
                  <Badge
                    variant="success"
                    className="shrink-0 text-xs"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Indexado
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onIngest(file)}
                    disabled={!!ingesting}
                    className="shrink-0"
                  >
                    {ingesting === file.id ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3 mr-1" />
                    )}
                    Indexar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Sync history */}
      {syncStatus && syncStatus.recent_syncs.length > 0 && (
        <>
          <div className="border-t mx-6" />
          <CardContent className="pt-3">
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Historial de sincronizaciones
            </p>
            <div className="space-y-2">
              {syncStatus.recent_syncs.map((sync) => {
                // Handle both detail shapes:
                //  - legacy array (pre-PR #186 completed syncs): full per-file
                //    list, contains "replaced" status and reasons we surface
                //  - structured object (PR #186+): only keeps `recent` (last
                //    ~10) and a separate `errors[]` list with suggested actions
                const rich = asRunningDetails(sync.details);
                let errors: SyncDetail[];
                let replaced: SyncDetail[];
                let skippedPdf: SyncDetail[];
                if (rich) {
                  errors = rich.errors.map((e) => ({
                    file: e.file,
                    path: e.path,
                    status: "error",
                    error: e.error,
                  }));
                  // Structured shape doesn't track "replaced" or the
                  // PDF-skipped subset across the whole run, so leave both
                  // empty for completed syncs written in this shape.
                  replaced = [];
                  skippedPdf = [];
                } else {
                  const details = asLegacyDetails(sync.details);
                  errors = details.filter((d) => d.status === "error");
                  replaced = details.filter((d) => d.status === "replaced");
                  skippedPdf = details.filter(
                    (d) => d.status === "skipped" && d.reason === "PDF version exists",
                  );
                }
                const hasDetails =
                  errors.length > 0 || replaced.length > 0 || skippedPdf.length > 0;
                return (
                  <SyncHistoryEntry
                    key={sync.id}
                    sync={sync}
                    errors={errors}
                    replaced={replaced}
                    skippedPdf={skippedPdf}
                    hasDetails={hasDetails}
                  />
                );
              })}
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}

// ─── Running Sync Card (rich live progress) ────────────────
function RunningSyncCard({ sync, queue }: { sync: SyncLog; queue?: IngestQueue }) {
  const rich = asRunningDetails(sync.details);
  const [recentOpen, setRecentOpen] = useState(true);
  const [errorsOpen, setErrorsOpen] = useState(false);

  // Queue model (Fase 2): the worker ingests in the background, so the
  // sync-log counters stay 0. When ingest_jobs counts are available, drive the
  // progress from them so the card shows real worker progress, not "0 de N".
  const useQueue = !!queue && queue.total > 0;
  const processed = useQueue
    ? queue!.done + queue!.failed
    : sync.files_ingested + sync.files_skipped + sync.files_failed;
  const total = useQueue ? queue!.total : sync.total_files_found || 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const elapsedMs = Date.now() - new Date(sync.started_at).getTime();
  const elapsedMin = Math.max(0, Math.floor(elapsedMs / 60000));

  // Prefer backend-provided rate (processed per minute over the sync). Fallback
  // to deriving rate from elapsed time + processed count.
  const ratePerMin =
    rich && rich.rate_per_min > 0
      ? rich.rate_per_min
      : processed > 0 && elapsedMs > 0
        ? processed / (elapsedMs / 60000)
        : 0;
  const etaMin =
    total > 0 && processed < total && ratePerMin > 0
      ? Math.max(1, Math.round((total - processed) / ratePerMin))
      : total > 0 && processed > 0
        ? Math.max(
            1,
            Math.round((elapsedMs / processed) * (total - processed) / 60000),
          )
        : null;

  const phase = rich?.phase ?? null;
  const recent = rich?.recent ?? [];
  const errors = rich?.errors ?? [];

  return (
    <Card className="border-vandarum-teal/40 bg-vandarum-teal/5">
      <CardContent className="py-4 space-y-3">
        {/* Header: title + phase badge + elapsed/eta */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Loader2 className="h-4 w-4 animate-spin text-vandarum-teal" />
            <span className="font-medium text-sm">Sincronizacion en curso</span>
            {phase && (
              <Badge
                variant="outline"
                className={`text-[10px] ${SYNC_PHASE_BADGE_CLASS[phase]}`}
              >
                {SYNC_PHASE_LABELS[phase]}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            Iniciada hace {elapsedMin} min
            {etaMin !== null ? ` · ~${etaMin} min restantes` : ""}
          </span>
        </div>

        {/* Progress bar block */}
        {total > 0 ? (
          <>
            <div className="w-full bg-vandarum-teal/15 rounded-full h-2">
              <div
                className="bg-vandarum-teal h-2 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>
                {processed} de {total} ({pct}%)
              </span>
              {useQueue ? (
                <>
                  <span className="text-vandarum-green">
                    {queue!.done} indexados
                  </span>
                  {queue!.processing > 0 && (
                    <span>{queue!.processing} procesando</span>
                  )}
                  <span>{queue!.pending} en cola</span>
                  {queue!.failed > 0 && (
                    <span className="text-destructive">
                      {queue!.failed} errores
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-vandarum-green">
                    {sync.files_ingested} nuevos
                  </span>
                  <span>{sync.files_skipped} ya indexados</span>
                  {sync.files_failed > 0 && (
                    <span className="text-destructive">
                      {sync.files_failed} errores
                    </span>
                  )}
                </>
              )}
              {ratePerMin > 0 && (
                <span>{ratePerMin.toFixed(1)} archivos/min</span>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Escaneando carpetas de Google Drive...
          </p>
        )}

        {/* Procesando ahora — only when we have the new structured details */}
        {rich && (
          <div className="rounded-md border border-vandarum-teal/20 bg-background/60 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-medium text-vandarum-teal">
              <Activity className="h-3.5 w-3.5" />
              <span>Procesando ahora</span>
            </div>
            {rich.current_file ? (
              <div className="mt-1 min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  title={rich.current_file}
                >
                  {rich.current_file}
                </p>
                {rich.current_path && (
                  <p
                    className="text-xs text-muted-foreground truncate"
                    title={rich.current_path}
                  >
                    {rich.current_path}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground italic">
                Esperando siguiente archivo...
              </p>
            )}
          </div>
        )}

        {/* Actividad reciente — collapsible */}
        {rich && recent.length > 0 && (
          <div className="rounded-md border border-border/50 bg-background/40">
            <button
              type="button"
              onClick={() => setRecentOpen(!recentOpen)}
              className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/40"
            >
              {recentOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Actividad reciente</span>
              <Badge variant="outline" className="text-[10px] ml-auto">
                {recent.length}
              </Badge>
            </button>
            {recentOpen && (
              <div className="border-t border-border/50 px-3 py-2 space-y-1 max-h-56 overflow-y-auto">
                {recent.slice(0, 10).map((r, i) => {
                  const ts = (() => {
                    try {
                      return new Date(r.ts_iso).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      });
                    } catch {
                      return "";
                    }
                  })();
                  return (
                    <div
                      key={`${r.file}-${r.ts_iso}-${i}`}
                      className="flex items-start gap-2 text-xs min-w-0"
                    >
                      {r.status === "ingested" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                      ) : r.status === "skipped" ? (
                        <File className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p
                          className="font-medium truncate"
                          title={r.file}
                        >
                          {r.file}
                        </p>
                        {r.path && (
                          <p
                            className="text-[11px] text-muted-foreground truncate"
                            title={r.path}
                          >
                            {r.path}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${
                          r.status === "ingested"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : r.status === "skipped"
                              ? "bg-gray-50 text-gray-600 border-gray-200"
                              : "bg-red-50 text-red-700 border-red-200"
                        }`}
                      >
                        {r.status === "ingested"
                          ? "indexado"
                          : r.status === "skipped"
                            ? "omitido"
                            : "error"}
                      </Badge>
                      {ts && (
                        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                          {ts}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Errores detectados — collapsed by default, count in red badge */}
        {rich && errors.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50/40">
            <button
              type="button"
              onClick={() => setErrorsOpen(!errorsOpen)}
              className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-red-50/70"
            >
              {errorsOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-red-700" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-red-700" />
              )}
              <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
              <span className="text-xs font-medium text-red-800">
                Errores detectados
              </span>
              <Badge className="text-[10px] ml-auto bg-red-600 text-white hover:bg-red-600">
                {errors.length}
              </Badge>
            </button>
            {errorsOpen && (
              <div className="border-t border-red-200 px-3 py-2 space-y-3 max-h-80 overflow-y-auto">
                {errors.map((e, i) => (
                  <div
                    key={`${e.file}-${i}`}
                    className="space-y-1.5"
                  >
                    <div className="min-w-0">
                      <p
                        className="text-xs font-semibold truncate"
                        title={e.file}
                      >
                        {e.file}
                      </p>
                      {e.path && (
                        <p
                          className="text-[11px] text-muted-foreground truncate"
                          title={e.path}
                        >
                          {e.path}
                        </p>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-red-700 break-words whitespace-pre-wrap">
                      {e.error}
                    </p>
                    {e.suggested_action && (
                      <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 flex items-start gap-1.5">
                        <Lightbulb className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-900 leading-snug">
                          {e.suggested_action}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sync History Entry (expandable) ────────────────────────
function SyncHistoryEntry({
  sync,
  errors,
  replaced,
  skippedPdf,
  hasDetails,
}: {
  sync: SyncLog;
  errors: SyncDetail[];
  replaced: SyncDetail[];
  skippedPdf: SyncDetail[];
  hasDetails: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md bg-muted/50 text-xs">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex items-center gap-3 w-full px-3 py-2 text-left ${hasDetails ? "cursor-pointer hover:bg-muted/80" : "cursor-default"}`}
      >
        {sync.status === "completed" ? (
          sync.files_failed > 0 ? (
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          )
        ) : sync.status === "running" ? (
          <Loader2 className="h-4 w-4 animate-spin text-vandarum-teal shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500 shrink-0" />
        )}
        <span className="text-muted-foreground shrink-0">
          {new Date(sync.started_at).toLocaleString("es-ES", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="flex-1 truncate">
          {sync.status === "running"
            ? "En progreso..."
            : sync.status === "error"
              ? sync.error_message || "Error"
              : `${sync.files_ingested} nuevos, ${sync.files_skipped} existentes${sync.files_failed ? `, ${sync.files_failed} errores` : ""}${replaced.length ? `, ${replaced.length} reemplazados` : ""}`}
        </span>
        {sync.total_files_found > 0 && (
          <Badge variant="outline" className="text-[10px] shrink-0">
            {sync.total_files_found} archivos
          </Badge>
        )}
        {hasDetails && (
          expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          )
        )}
      </button>

      {expanded && hasDetails && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/50 pt-2 ml-7">
          {/* Errors */}
          {errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2">
              <p className="font-medium text-red-800 mb-1">
                {errors.length} archivo{errors.length !== 1 ? "s" : ""} con error:
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {errors.map((d, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <XCircle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
                    <span className="font-medium">{d.file}</span>
                    {d.error && (
                      <span className="text-red-600 truncate" title={d.error}>— {d.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Replaced .md → PDF */}
          {replaced.length > 0 && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-2">
              <p className="font-medium text-blue-800 mb-1">
                {replaced.length} .md reemplazado{replaced.length !== 1 ? "s" : ""} por PDF:
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {replaced.map((d, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <RefreshCw className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
                    <span>{d.file}</span>
                    {d.reason && (
                      <span className="text-blue-600">— {d.reason}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skipped .md (PDF exists) */}
          {skippedPdf.length > 0 && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
              <p className="font-medium text-gray-700 mb-1">
                {skippedPdf.length} .md omitido{skippedPdf.length !== 1 ? "s" : ""} (PDF disponible):
              </p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {skippedPdf.map((d, i) => (
                  <div key={i} className="flex items-start gap-1 text-gray-600">
                    <File className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{d.file}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Documents Tab (folder structure like GD) ──────────────
function DocumentsTab({
  documents,
  search,
  setSearch,
  loading,
  deleting,
  reprocessing,
  reclassifying,
  onDelete,
  onReprocess,
  onReclassify,
  onSearch,
}: {
  documents: KBDocument[];
  search: string;
  setSearch: (s: string) => void;
  loading: boolean;
  deleting: string | null;
  reprocessing: Set<string>;
  reclassifying: boolean;
  onDelete: (id: string) => void;
  onReprocess: (ids: string[]) => void;
  onReclassify: () => void;
  onSearch: () => void;
}) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredDocs =
    statusFilter === "all"
      ? documents
      : statusFilter === "sin_chunks"
        ? documents.filter(
            (d) => d.estado === "indexado" && (!d.total_chunks || d.total_chunks === 0)
          )
        : documents.filter((d) => d.estado === statusFilter);

  // Agrupar por tipo (replica estructura de carpetas de GD)
  const grouped = filteredDocs.reduce<Record<string, KBDocument[]>>((acc, doc) => {
    const tipo = doc.tipo || "sin_clasificar";
    if (!acc[tipo]) acc[tipo] = [];
    acc[tipo].push(doc);
    return acc;
  }, {});

  // Ordenar carpetas por nombre
  const sortedFolders = Object.keys(grouped).sort((a, b) => {
    const labelA = knowledgeTypeLabels[a] ?? a;
    const labelB = knowledgeTypeLabels[b] ?? b;
    return labelA.localeCompare(labelB);
  });

  function toggleFolder(tipo: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(tipo)) next.delete(tipo);
      else next.add(tipo);
      return next;
    });
  }

  const docsWithIssues = documents.filter(
    (d) =>
      d.estado === "error" ||
      (d.estado === "indexado" && (!d.total_chunks || d.total_chunks === 0))
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por titulo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
            />
          </div>
          <Button variant="outline" size="sm" onClick={onSearch}>
            <Search className="h-4 w-4" />
          </Button>
        </div>
        {/* Status filter + bulk reprocess */}
        {documents.length > 0 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {[
              { key: "all", label: "Todos", count: documents.length },
              { key: "indexado", label: "Indexados", count: documents.filter((d) => d.estado === "indexado").length },
              { key: "error", label: "Con error", count: documents.filter((d) => d.estado === "error").length },
              { key: "sin_chunks", label: "Sin chunks", count: documents.filter((d) => d.estado === "indexado" && (!d.total_chunks || d.total_chunks === 0)).length },
            ]
              .filter((f) => f.count > 0 || f.key === "all")
              .map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    statusFilter === f.key
                      ? f.key === "error"
                        ? "bg-red-100 border-red-300 text-red-800"
                        : f.key === "sin_chunks"
                          ? "bg-amber-100 border-amber-300 text-amber-800"
                          : "bg-vandarum-teal/10 border-vandarum-teal/30 text-vandarum-teal"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 text-xs"
              onClick={onReclassify}
              disabled={reclassifying}
            >
              {reclassifying ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              {reclassifying ? "Reclasificando..." : "Reclasificar tipos"}
            </Button>
            {docsWithIssues.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onReprocess(docsWithIssues.map((d) => d.id))}
                disabled={reprocessing.size > 0}
              >
                {reprocessing.size > 0 ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3 mr-1" />
                )}
                Reprocesar problematicos ({docsWithIssues.length})
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-vandarum-teal" />
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              No hay documentos indexados.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Sube documentos o indexa archivos desde Google Drive.
            </p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-muted-foreground text-sm">
              Ningun documento coincide con el filtro seleccionado.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedFolders.map((tipo) => {
              const docs = grouped[tipo];
              const isOpen = openFolders.has(tipo);
              const folderLabel = knowledgeTypeLabels[tipo] ?? tipo;
              const errorCount = docs.filter((d) => d.estado === "error").length;
              const noChunkCount = docs.filter(
                (d) => d.estado === "indexado" && (!d.total_chunks || d.total_chunks === 0)
              ).length;

              return (
                <div key={tipo}>
                  {/* Folder row */}
                  <button
                    onClick={() => toggleFolder(tipo)}
                    className="flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-left hover:bg-muted transition-colors group"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <FolderOpen className="h-5 w-5 text-vandarum-teal shrink-0" />
                    <span className="flex-1 text-sm font-medium group-hover:text-vandarum-teal">
                      {folderLabel}
                    </span>
                    <div className="flex items-center gap-2">
                      {errorCount > 0 && (
                        <Badge variant="destructive" className="text-[10px]">
                          {errorCount} error{errorCount !== 1 ? "es" : ""}
                        </Badge>
                      )}
                      {noChunkCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800">
                          {noChunkCount} sin chunks
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {docs.length} doc{docs.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </button>

                  {/* Documents inside folder */}
                  {isOpen && (
                    <div className="ml-8 border-l pl-4 space-y-0.5 mb-2">
                      {docs.map((doc) => {
                        const hasChunkIssue =
                          doc.estado === "indexado" &&
                          (!doc.total_chunks || doc.total_chunks === 0);
                        const isError = doc.estado === "error";
                        const canReprocess = hasChunkIssue || isError;
                        const isReprocessing = reprocessing.has(doc.id);

                        return (
                          <div
                            key={doc.id}
                            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                              isError
                                ? "bg-red-50/50"
                                : hasChunkIssue
                                  ? "bg-amber-50/50"
                                  : "hover:bg-muted/50"
                            } transition-colors`}
                          >
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {doc.titulo || "Sin titulo"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {doc.naturaleza_pdf || "---"}
                                {doc.total_paginas ? ` · ${doc.total_paginas} pags` : ""}
                                {doc.total_chunks ? ` · ${doc.total_chunks} chunks` : ""}
                                {doc.fecha_ingesta &&
                                  ` · ${new Date(doc.fecha_ingesta).toLocaleDateString("es-ES")}`}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {hasChunkIssue && (
                                <span title="Sin chunks"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></span>
                              )}
                              <Badge
                                variant={
                                  isError
                                    ? "destructive"
                                    : hasChunkIssue
                                      ? "secondary"
                                      : "success"
                                }
                                className="text-[10px]"
                              >
                                {doc.estado || "---"}
                              </Badge>
                              {canReprocess && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onReprocess([doc.id])}
                                  disabled={isReprocessing}
                                  className="h-7 w-7 p-0 text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                                  title="Reprocesar"
                                >
                                  {isReprocessing ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onDelete(doc.id)}
                                disabled={deleting === doc.id}
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                title="Eliminar"
                              >
                                {deleting === doc.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Search Tab ──────────────────────────────────────────────
interface RagSource {
  document_id: string;
  title: string;
  doc_type: string;
  chunk_type: string;
  similarity: number;
  semantic_similarity: number;
  text_rank: number;
  scope: "general" | "project";
  excerpt: string;
}

interface SearchResults {
  answer: string;
  sources: RagSource[];
  retrieval?: {
    mode: string;
    candidates: number;
    top_k: number;
  };
  error?: string;
}

function SearchTab() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topK, setTopK] = useState(10);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    setResults(null);
    setExpandedDocs(new Set());

    try {
      const res = await fetch("/api/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, scope: "general", top_k: topK }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }

      const data: SearchResults = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResults(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSearching(false);
    }
  }

  // Group sources by document for the document-level view
  const groupedByDoc = results?.sources
    ? Object.entries(
        results.sources.reduce<Record<string, RagSource[]>>((acc, s) => {
          const key = s.document_id;
          if (!acc[key]) acc[key] = [];
          acc[key].push(s);
          return acc;
        }, {})
      ).sort(
        ([, a], [, b]) =>
          Math.max(...b.map((c) => c.similarity)) -
          Math.max(...a.map((c) => c.similarity))
      )
    : [];

  const toggleDoc = (docId: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Buscar en el RAG
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Busca por tema, provincia, normativa o cualquier concepto para verificar cobertura en la base de conocimiento.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search controls */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Ej: residuos Castilla y León, Decreto 22/2011, BREF tratamiento superficies..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full rounded-md border border-input bg-background px-9 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <select
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={15}>Top 15</option>
          </select>
          <Button onClick={handleSearch} disabled={searching || !query.trim()}>
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Buscar
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Loading */}
        {searching && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Buscando en la base de conocimiento...
          </div>
        )}

        {/* Results */}
        {results && !searching && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center gap-4 text-sm">
              <Badge variant="outline" className="gap-1">
                <Database className="h-3 w-3" />
                {groupedByDoc.length} documento{groupedByDoc.length !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <FileText className="h-3 w-3" />
                {results.sources.length} chunk{results.sources.length !== 1 ? "s" : ""} relevantes
              </Badge>
              {results.retrieval && (
                <span className="text-muted-foreground">
                  {results.retrieval.candidates} candidatos evaluados · {results.retrieval.mode}
                </span>
              )}
            </div>

            {/* No results */}
            {results.sources.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
                <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-amber-800">
                  No se encontraron resultados para &ldquo;{query}&rdquo;
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  Prueba con otros términos o verifica que los documentos relevantes están indexados.
                </p>
              </div>
            )}

            {/* Document list */}
            {groupedByDoc.map(([docId, chunks]) => {
              const bestScore = Math.max(...chunks.map((c) => c.similarity));
              const isExpanded = expandedDocs.has(docId);
              const title = chunks[0].title;
              const docType = chunks[0].doc_type;

              return (
                <div
                  key={docId}
                  className="rounded-lg border bg-card overflow-hidden"
                >
                  {/* Document header */}
                  <button
                    onClick={() => toggleDoc(docId)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <FileText className="h-4 w-4 shrink-0 text-teal-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {(knowledgeTypeLabels[docType] || docType || "").replace(/_/g, " ")}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {chunks.length} chunk{chunks.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`text-xs font-mono font-medium ${
                          bestScore >= 0.8
                            ? "text-green-600"
                            : bestScore >= 0.6
                              ? "text-amber-600"
                              : "text-red-500"
                        }`}
                      >
                        {(bestScore * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-muted-foreground">relevancia</div>
                    </div>
                  </button>

                  {/* Expanded chunks */}
                  {isExpanded && (
                    <div className="border-t divide-y">
                      {chunks
                        .sort((a, b) => b.similarity - a.similarity)
                        .map((chunk, i) => (
                          <div key={i} className="px-4 py-3 bg-muted/30">
                            <div className="flex items-center gap-2 mb-1.5">
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {chunk.chunk_type}
                              </Badge>
                              <span
                                className={`text-[10px] font-mono ${
                                  chunk.similarity >= 0.8
                                    ? "text-green-600"
                                    : chunk.similarity >= 0.6
                                      ? "text-amber-600"
                                      : "text-red-500"
                                }`}
                              >
                                {(chunk.similarity * 100).toFixed(1)}% sim
                              </span>
                              {chunk.text_rank > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  · texto: {chunk.text_rank.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                              {chunk.excerpt}
                            </p>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


