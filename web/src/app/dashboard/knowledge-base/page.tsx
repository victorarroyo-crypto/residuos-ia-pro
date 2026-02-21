"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  BookOpen,
  Upload,
  Search,
  Send,
  FileText,
  Trash2,
  Loader2,
  MessageSquare,
  Database,
  X,
  File,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

interface RAGSource {
  document_id: string;
  title: string;
  doc_type: string;
  chunk_type: string;
  similarity: number;
  scope: string;
  excerpt: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: RAGSource[];
}

const docTypeLabels: Record<string, string> = {
  normativa: "Normativa",
  manual_interno: "Manual",
  autorizacion_ambiental_integrada: "AAI",
  desconocido: "Sin clasificar",
  permiso_ambiental: "Permiso",
};

const ACCEPTED_EXTENSIONS =
  ".pdf,.docx,.doc,.txt,.html,.htm,.md,.xlsx,.xls,.csv";

// ─── Component ──────────────────────────────────────────────
export default function KnowledgeBasePage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<"documents" | "chat">(
    "documents"
  );

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);

  // ─── Load documents ───────────────────────────────────────
  const loadDocuments = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/knowledge-base?${params.toString()}`);
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
      const PIPELINE_URL =
        process.env.NEXT_PUBLIC_PIPELINE_API_URL || "http://localhost:8000";
      const res = await fetch(`${PIPELINE_URL}/api/knowledge-base/stats`);
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {
      // Pipeline might not be running
    }
  }, []);

  useEffect(() => {
    loadDocuments();
    loadStats();
  }, [loadDocuments, loadStats]);

  // ─── Upload handler ───────────────────────────────────────
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadResult(null);

    let successCount = 0;
    let errorCount = 0;

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("rag_scope", "general");
      // No client_id → goes to general knowledge base

      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
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

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Reload docs and stats
    setLoadingDocs(true);
    await Promise.all([loadDocuments(), loadStats()]);
  }

  // ─── Delete handler ───────────────────────────────────────
  async function handleDelete(docId: string) {
    setDeleting(docId);
    try {
      const PIPELINE_URL =
        process.env.NEXT_PUBLIC_PIPELINE_API_URL || "http://localhost:8000";
      const res = await fetch(`${PIPELINE_URL}/api/knowledge-base/${docId}`, {
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

  // ─── Chat handler ─────────────────────────────────────────
  async function handleSendMessage() {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setChatLoading(true);

    try {
      const res = await fetch("/api/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userMessage,
          scope: "general",
          top_k: 5,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer,
            sources: data.sources,
          },
        ]);
      } else {
        const err = await res.json().catch(() => ({}));
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${err.error || "No se pudo procesar la consulta"}`,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Error: No se pudo conectar con el servidor. Verifica que el pipeline API esta activo.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
            Documentos normativos y tecnicos generales disponibles para todos
            los proyectos.
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
            className="bg-vandarum-teal hover:bg-vandarum-teal/90"
          >
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {uploading ? "Subiendo..." : "Subir documento"}
          </Button>
        </div>
      </div>

      {/* Upload result toast */}
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
          <button
            onClick={() => setUploadResult(null)}
            className="ml-auto"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Documentos generales
            </CardTitle>
            <BookOpen className="h-4 w-4 text-vandarum-teal" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_documents}</div>
            <p className="text-xs text-muted-foreground">
              En la base de conocimiento
            </p>
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
            <p className="text-xs text-muted-foreground">
              Fragmentos para busqueda semantica
            </p>
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
            <p className="text-xs text-muted-foreground">
              Total de paginas analizadas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Tipos de documento
            </CardTitle>
            <File className="h-4 w-4 text-vandarum-orange" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Object.keys(stats.by_type).length}
            </div>
            <p className="text-xs text-muted-foreground">
              Categorias diferentes
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => setActiveTab("documents")}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "documents"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="h-4 w-4" />
          Documentos
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "chat"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Consultar RAG
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "documents" ? (
        <DocumentsTab
          documents={documents}
          search={search}
          setSearch={setSearch}
          loading={loadingDocs}
          deleting={deleting}
          onDelete={handleDelete}
          onSearch={() => {
            setLoadingDocs(true);
            loadDocuments();
          }}
        />
      ) : (
        <ChatTab
          messages={messages}
          chatInput={chatInput}
          setChatInput={setChatInput}
          chatLoading={chatLoading}
          onSend={handleSendMessage}
          chatEndRef={chatEndRef}
        />
      )}
    </div>
  );
}

// ─── Documents Tab ──────────────────────────────────────────
function DocumentsTab({
  documents,
  search,
  setSearch,
  loading,
  deleting,
  onDelete,
  onSearch,
}: {
  documents: KBDocument[];
  search: string;
  setSearch: (s: string) => void;
  loading: boolean;
  deleting: string | null;
  onDelete: (id: string) => void;
  onSearch: () => void;
}) {
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
              No hay documentos en la base de conocimiento.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Sube normativas, BREFs, guias tecnicas y otros documentos
              generales.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titulo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Formato</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Pags</TableHead>
                <TableHead className="text-right">Chunks</TableHead>
                <TableHead>Fecha ingesta</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="max-w-[300px] truncate font-medium">
                    {doc.titulo || "Sin titulo"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {doc.tipo
                        ? docTypeLabels[doc.tipo] ?? doc.tipo
                        : "---"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {doc.naturaleza_pdf || "---"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        doc.estado === "indexado"
                          ? "success"
                          : doc.estado === "error"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {doc.estado || "---"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {doc.total_paginas ?? "---"}
                  </TableCell>
                  <TableCell className="text-right">
                    {doc.total_chunks ?? "---"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {doc.fecha_ingesta
                      ? new Date(doc.fecha_ingesta).toLocaleDateString("es-ES")
                      : "---"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(doc.id)}
                      disabled={deleting === doc.id}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      {deleting === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Chat Tab ───────────────────────────────────────────────
function ChatTab({
  messages,
  chatInput,
  setChatInput,
  chatLoading,
  onSend,
  chatEndRef,
}: {
  messages: ChatMessage[];
  chatInput: string;
  setChatInput: (s: string) => void;
  chatLoading: boolean;
  onSend: () => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <Card className="flex flex-col" style={{ height: "calc(100vh - 420px)" }}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquare className="h-5 w-5 text-vandarum-teal" />
          Consultar Base de Conocimiento
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Pregunta sobre normativa, procedimientos tecnicos, codigos LER,
          obligaciones legales y mas.
        </p>
      </CardHeader>

      {/* Messages area */}
      <CardContent className="flex-1 overflow-y-auto space-y-4 pb-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-sm">
              Escribe una pregunta para consultar la base de conocimiento.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {[
                "Que dice la normativa sobre almacenamiento temporal de residuos peligrosos?",
                "Cuales son las obligaciones del productor segun la Ley 7/2022?",
                "Que es un codigo LER y como se clasifica?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setChatInput(suggestion);
                  }}
                  className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-vandarum-teal text-white"
                  : "bg-muted"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>

              {/* Sources */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-3 border-t border-border/50 pt-2">
                  <p className="text-xs font-medium mb-1 opacity-70">
                    Fuentes:
                  </p>
                  <div className="space-y-1">
                    {msg.sources.map((src, j) => (
                      <div
                        key={j}
                        className="flex items-center gap-2 text-xs opacity-70"
                      >
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="truncate">{src.title}</span>
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 shrink-0"
                        >
                          {src.similarity > 0
                            ? `${Math.round(src.similarity * 100)}%`
                            : src.doc_type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {chatLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-3 text-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-vandarum-teal" />
              Consultando base de conocimiento...
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </CardContent>

      {/* Input area */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && onSend()}
            placeholder="Escribe tu pregunta sobre normativa o procedimientos..."
            className="flex-1 rounded-md border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
            disabled={chatLoading}
          />
          <Button
            onClick={onSend}
            disabled={chatLoading || !chatInput.trim()}
            className="bg-vandarum-teal hover:bg-vandarum-teal/90"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
