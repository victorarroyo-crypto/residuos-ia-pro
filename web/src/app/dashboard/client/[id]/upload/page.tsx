"use client";

import { use, useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, FileUp, CheckCircle2, XCircle, Loader2, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/client";
import type { PipelineProgress, Client } from "@/types/database";

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
];

const ACCEPTED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".csv"];

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

interface FileUploadState {
  file: File;
  status: "pending" | "uploading" | "processing" | "done" | "error";
  progress: PipelineProgress | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

export default function UploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [client, setClient] = useState<Client | null>(null);
  const [files, setFiles] = useState<FileUploadState[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        setClient(data);
        setLoading(false);
      });
  }, [id]);

  // Subscribe to pipeline_progress via Supabase Realtime
  useEffect(() => {
    const processingFiles = files.filter((f) => f.status === "processing");
    if (processingFiles.length === 0) return;

    const supabase = createClient();
    const channel = supabase
      .channel("pipeline-progress")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pipeline_progress",
        },
        (payload) => {
          const progress = payload.new as PipelineProgress;
          setFiles((prev) =>
            prev.map((f) => {
              if (f.status !== "processing") return f;
              // Match by filename pattern
              if (progress.doc_id && progress.doc_id.includes(f.file.name)) {
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
              }
              return f;
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [files]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const validFiles = Array.from(newFiles).filter((file) => {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      return (
        ACCEPTED_TYPES.includes(file.type) ||
        ACCEPTED_EXTENSIONS.includes(ext)
      );
    });

    setFiles((prev) => [
      ...prev,
      ...validFiles.map((file) => ({
        file,
        status: "pending" as const,
        progress: null,
        error: null,
        result: null,
      })),
    ]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const uploadFile = useCallback(
    async (index: number) => {
      const fileState = files[index];
      if (!fileState) return;

      // Phase 1: Uploading
      setFiles((prev) =>
        prev.map((f, i) =>
          i === index
            ? {
                ...f,
                status: "uploading",
                progress: {
                  doc_id: "",
                  step: "subiendo",
                  percentage: 5,
                  mensaje: "Subiendo archivo...",
                  error: null,
                },
              }
            : f
        )
      );

      // Send to API
      const formData = new FormData();
      formData.append("file", fileState.file);
      formData.append("client_id", id);

      try {
        // Phase 2: Processing
        setFiles((prev) =>
          prev.map((f, i) =>
            i === index
              ? {
                  ...f,
                  status: "processing",
                  progress: {
                    doc_id: "",
                    step: "detectando_tipo",
                    percentage: 10,
                    mensaje: "Enviado al pipeline, procesando...",
                    error: null,
                  },
                }
              : f
          )
        );

        const response = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
        });

        const result = await response.json();

        if (!response.ok || result.error) {
          setFiles((prev) =>
            prev.map((f, i) =>
              i === index
                ? {
                    ...f,
                    status: "error",
                    error: result.error || result.detail || "Error en el procesamiento",
                    progress: {
                      doc_id: "",
                      step: "error",
                      percentage: 0,
                      mensaje: null,
                      error: result.error || "Error",
                    },
                  }
                : f
            )
          );
          return;
        }

        // Phase 3: Done
        setFiles((prev) =>
          prev.map((f, i) =>
            i === index
              ? {
                  ...f,
                  status: "done",
                  result,
                  progress: {
                    doc_id: result.doc_id || "",
                    step: "completado",
                    percentage: 100,
                    mensaje: "Completado",
                    error: null,
                  },
                }
              : f
          )
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f, i) =>
            i === index
              ? {
                  ...f,
                  status: "error",
                  error:
                    err instanceof Error
                      ? err.message
                      : "Error de conexion con el pipeline",
                }
              : f
          )
        );
      }
    },
    [files, id]
  );

  const handleUploadAll = useCallback(async () => {
    const pendingIndices = files
      .map((f, i) => (f.status === "pending" ? i : -1))
      .filter((i) => i >= 0);

    for (const i of pendingIndices) {
      await uploadFile(i);
    }
  }, [files, uploadFile]);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-vandarum-teal" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg text-muted-foreground">Cliente no encontrado</p>
        <Link href="/dashboard" className="mt-4 text-vandarum-teal hover:underline">
          Volver al dashboard
        </Link>
      </div>
    );
  }

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <Link
          href={`/dashboard/client/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> {client.nombre}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Subir documentos</h1>
        <p className="text-muted-foreground">
          Arrastra PDFs, Excel o CSV. El pipeline los procesara automaticamente.
        </p>
      </div>

      {/* Drop zone */}
      <Card>
        <CardContent className="p-0">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
              isDragging
                ? "border-vandarum-teal bg-vandarum-teal/5"
                : "border-muted-foreground/25 hover:border-vandarum-teal/50"
            }`}
          >
            <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-lg font-medium">
              {isDragging
                ? "Suelta los archivos aqui"
                : "Arrastra archivos o haz clic para seleccionar"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              PDF, Excel (.xlsx, .xls), CSV
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_EXTENSIONS.join(",")}
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>
        </CardContent>
      </Card>

      {/* File list */}
      {files.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileUp className="h-5 w-5 text-vandarum-blue" />
              Archivos ({files.length})
              {doneCount > 0 && (
                <Badge variant="success">
                  {doneCount}/{files.length} completados
                </Badge>
              )}
            </CardTitle>
            {pendingCount > 0 && (
              <Button onClick={handleUploadAll}>
                <Upload className="mr-2 h-4 w-4" />
                Procesar {pendingCount > 1 ? `${pendingCount} archivos` : "archivo"}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {files.map((fileState, index) => (
                <div
                  key={`${fileState.file.name}-${index}`}
                  className="rounded-md border p-4"
                >
                  <div className="flex items-center gap-3">
                    <File className="h-5 w-5 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">
                          {fileState.file.name}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          ({(fileState.file.size / 1024).toFixed(0)} KB)
                        </span>
                      </div>

                      {fileState.status === "pending" && (
                        <p className="text-xs text-muted-foreground">
                          Pendiente de procesar
                        </p>
                      )}

                      {fileState.status === "uploading" && fileState.progress && (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin text-vandarum-teal" />
                            <span className="text-xs text-vandarum-teal">
                              {stepLabels[fileState.progress.step] ?? "Subiendo..."}
                            </span>
                          </div>
                          <Progress value={fileState.progress.percentage} />
                        </div>
                      )}

                      {fileState.status === "processing" &&
                        fileState.progress && (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {stepLabels[fileState.progress.step] ??
                                  fileState.progress.step}
                              </span>
                              <span className="font-medium">
                                {fileState.progress.percentage}%
                              </span>
                            </div>
                            <Progress value={fileState.progress.percentage} />
                          </div>
                        )}

                      {fileState.status === "done" && (
                        <div className="mt-1 space-y-1">
                          <div className="flex items-center gap-1 text-xs text-vandarum-green">
                            <CheckCircle2 className="h-3 w-3" />
                            Documento indexado correctamente
                          </div>
                          {fileState.result && (
                            <div className="flex flex-wrap gap-2 mt-1">
                              {"doc_type" in fileState.result && (
                                <Badge variant="outline" className="text-xs">
                                  {String(fileState.result.doc_type).replace(/_/g, " ")}
                                </Badge>
                              )}
                              {"num_chunks" in fileState.result && (
                                <span className="text-xs text-muted-foreground">
                                  {String(fileState.result.num_chunks)} chunks
                                </span>
                              )}
                              {Array.isArray(fileState.result.ler_codes_found) &&
                                fileState.result.ler_codes_found.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    LERs: {(fileState.result.ler_codes_found as string[]).join(", ")}
                                  </span>
                                )}
                            </div>
                          )}
                        </div>
                      )}

                      {fileState.status === "error" && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                          <XCircle className="h-3 w-3" />
                          {fileState.error ?? "Error en el procesamiento"}
                        </div>
                      )}
                    </div>

                    {fileState.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
