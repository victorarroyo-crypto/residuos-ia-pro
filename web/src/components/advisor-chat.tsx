"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Paperclip,
  FileText,
  X,
  Loader2,
  BookOpen,
  Sparkles,
  AlertTriangle,
  Trash2,
  Image as ImageIcon,
  Link as LinkIcon,
  FileSpreadsheet,
  File,
  Globe,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { exportToWord } from "@/lib/export-word";

// ─── Constants ───────────────────────────────────────────────────

const MAX_FILES = 6;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const DIRECT_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

const ACCEPTED_EXTENSIONS =
  ".pdf,.xlsx,.xls,.csv,.txt,.json,.xml,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.tif";

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

// ─── Types ──────────────────────────────────────────────────────

interface Source {
  document_id: string;
  title: string;
  doc_type: string;
  similarity: number;
  scope: string;
  excerpt: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  fileNames?: string[];
  ragUsed?: boolean;
  webSearchUsed?: boolean;
}

// ─── Props ──────────────────────────────────────────────────────

export interface AnalysisContext {
  phase: "plan_review" | "results_review";
  plan?: Record<string, unknown>;
  findings?: Record<string, unknown>[];
  projectName?: string;
}

export interface AdvisorChatProps {
  /** Project ID for project-scoped RAG */
  projectId?: string;
  /** Analysis context for HITL-embedded advisor */
  analysisContext?: AnalysisContext;
  /** Compact mode for embedding */
  compact?: boolean;
  /** Placeholder override */
  placeholder?: string;
  /** Suggested questions override */
  suggestions?: { category: string; questions: string[] }[];
  /** Empty state message */
  emptyMessage?: string;
  /** CSS class */
  className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function getFileIcon(fileName: string) {
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(fileName)) return ImageIcon;
  if (/\.(xlsx?|csv)$/i.test(fileName)) return FileSpreadsheet;
  if (/\.(pdf)$/i.test(fileName)) return FileText;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/^#### (.*$)/gm, '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>')
    .replace(/^### (.*$)/gm, '<h3 class="text-base font-semibold mt-4 mb-1.5">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 class="text-lg font-bold mt-5 mb-2">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 class="text-xl font-bold mt-5 mb-2">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>')
    .replace(/^- (.*$)/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.*$)/gm, '<li class="ml-4 list-decimal"><strong>$1.</strong> $2</li>')
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

// ─── Default suggestions ────────────────────────────────────────

const DEFAULT_SUGGESTIONS = [
  {
    category: "Clasificacion",
    questions: [
      "Tengo un residuo con codigo espejo 16 02 13*/16 02 14. Como determino si es peligroso?",
      "Que analisis necesito para clasificar un lodo de depuradora industrial?",
    ],
  },
  {
    category: "Desclasificacion",
    questions: [
      "Que estrategias existen para desclasificar un residuo con HP14 (ecotoxico)?",
      "Como puedo demostrar que un residuo con codigo espejo no tiene la propiedad HP7?",
    ],
  },
  {
    category: "Normativa",
    questions: [
      "Cuales son las obligaciones del productor de residuos peligrosos segun la Ley 7/2022?",
      "Que plazos de almacenamiento temporal aplican a residuos peligrosos y no peligrosos?",
    ],
  },
  {
    category: "Gestion",
    questions: [
      "Que opciones de valorizacion existen para residuos de emulsiones de mecanizado?",
      "Como optimizar el coste de gestion de residuos metalicos en una planta de automocion?",
    ],
  },
];

// ─── Component ──────────────────────────────────────────────────

export function AdvisorChat({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  projectId,
  analysisContext,
  compact = false,
  placeholder,
  suggestions,
  emptyMessage,
  className = "",
}: AdvisorChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!compact) inputRef.current?.focus();
  }, [compact]);

  const totalAttachments = attachedFiles.length + urls.length;
  const hasFiles = attachedFiles.length > 0;
  const effectiveSuggestions = suggestions ?? (compact ? undefined : DEFAULT_SUGGESTIONS);
  const effectivePlaceholder = placeholder ?? "Pregunta sobre residuos, normativa, clasificacion, LER, desclasificacion...";
  const effectiveEmpty = emptyMessage ?? "Como puedo ayudarte?";

  const sendMessage = useCallback(async () => {
    const query = input.trim();
    if (!query || loading) return;

    setError(null);

    const fileNames = [
      ...attachedFiles.map((f) => f.name),
      ...urls.map((u) => u),
    ];

    const userMsg: ChatMessage = {
      role: "user",
      content: query,
      fileNames: fileNames.length > 0 ? fileNames : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const currentFiles = [...attachedFiles];
    const currentUrls = [...urls];
    const hasFileAttachments = currentFiles.length > 0;

    setAttachedFiles([]);
    setUrls([]);
    setShowUrlInput(false);
    setUrlInput("");

    try {
      const conversationHistory = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let res: Response;

      if (hasFileAttachments) {
        const base64Files: { name: string; type: string; base64: string }[] = [];
        const storagePaths: { name: string; type: string; storage_path: string }[] = [];

        for (const file of currentFiles) {
          if (file.size > DIRECT_UPLOAD_THRESHOLD) {
            try {
              const urlRes = await fetch("/api/upload-signed-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: file.name }),
              });
              if (!urlRes.ok) throw new Error("No se pudo obtener URL de subida");
              const { signed_url, storage_path } = await urlRes.json();

              const uploadRes = await fetch(signed_url, {
                method: "PUT",
                headers: { "Content-Type": file.type || "application/octet-stream" },
                body: file,
              });
              if (!uploadRes.ok) throw new Error("Error subiendo archivo a Storage");

              storagePaths.push({ name: file.name, type: file.type, storage_path });
            } catch (e) {
              throw new Error(
                `Error subiendo ${file.name}: ${e instanceof Error ? e.message : e}`
              );
            }
          } else {
            base64Files.push({
              name: file.name,
              type: file.type,
              base64: await fileToBase64(file),
            });
          }
        }

        res = await fetch("/api/advisor/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            conversation_history: conversationHistory,
            urls: currentUrls.length > 0 ? currentUrls : undefined,
            files: base64Files.length > 0 ? base64Files : undefined,
            storage_files: storagePaths.length > 0 ? storagePaths : undefined,
            analysis_context: analysisContext ?? undefined,
          }),
        });
      } else {
        res = await fetch("/api/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            conversation_history: conversationHistory,
            urls: currentUrls.length > 0 ? currentUrls : undefined,
            analysis_context: analysisContext ?? undefined,
          }),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        const errMsg = errData?.error || errData?.detail || `Error ${res.status}`;
        throw new Error(errMsg);
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.answer,
        sources: data.sources,
        ragUsed: data.rag_context_used,
        webSearchUsed: data.web_search_used,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes("Failed to fetch") || detail.includes("NetworkError")) {
        setError("Error de red. Verifica tu conexion y que el servidor esta activo.");
      } else {
        setError(detail);
      }
    } finally {
      setLoading(false);
    }
  }, [input, loading, attachedFiles, urls, messages, analysisContext]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const remaining = MAX_FILES - totalAttachments;
    if (remaining <= 0) {
      setError(`Maximo ${MAX_FILES} archivos adjuntos.`);
      e.target.value = "";
      return;
    }

    const filesToAdd = selectedFiles.slice(0, remaining);
    const rejected: string[] = [];

    const validFiles = filesToAdd.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        rejected.push(`${f.name} (excede ${formatFileSize(MAX_FILE_SIZE)})`);
        return false;
      }
      return true;
    });

    if (rejected.length > 0) setError(`Archivos rechazados: ${rejected.join(", ")}`);
    if (selectedFiles.length > remaining) {
      setError(`Solo se pueden adjuntar ${MAX_FILES} archivos. Se anadieron los primeros ${remaining}.`);
    }

    setAttachedFiles((prev) => [...prev, ...validFiles]);
    e.target.value = "";
  }

  function removeFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function addUrl() {
    const url = urlInput.trim();
    if (!url) return;
    try {
      new URL(url.startsWith("http") ? url : `https://${url}`);
    } catch {
      setError("URL no valida. Incluye http:// o https://");
      return;
    }
    if (totalAttachments >= MAX_FILES) {
      setError(`Maximo ${MAX_FILES} adjuntos (archivos + URLs).`);
      return;
    }
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    setUrls((prev) => [...prev, normalizedUrl]);
    setUrlInput("");
    setShowUrlInput(false);
  }

  function removeUrl(index: number) {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }

  function clearConversation() {
    setMessages([]);
    setError(null);
    setAttachedFiles([]);
    setUrls([]);
    setShowUrlInput(false);
    setUrlInput("");
  }

  function selectSuggestion(question: string) {
    setInput(question);
    inputRef.current?.focus();
  }

  const chatHeight = compact ? "h-[400px]" : "flex-1";

  return (
    <div className={`flex flex-col ${compact ? "" : "min-h-0"} ${className}`}>
      {/* Compact header */}
      {compact && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-vandarum-teal" />
            <span className="text-sm font-medium">Asesor IA</span>
            {analysisContext && (
              <Badge variant="outline" className="text-xs">
                {analysisContext.phase === "plan_review" ? "Planificacion" : "Resultados"}
              </Badge>
            )}
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearConversation} className="h-7 px-2">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Chat area */}
      <div className={`${chatHeight} overflow-y-auto border rounded-lg p-3 space-y-3 bg-background`}>
        {/* Empty state */}
        {messages.length === 0 && !compact && effectiveSuggestions && (
          <div className="flex flex-col items-center justify-center h-full">
            <Sparkles className="h-12 w-12 text-vandarum-teal/20 mb-4" />
            <p className="text-base font-medium mb-1">{effectiveEmpty}</p>
            <p className="text-sm text-muted-foreground mb-6 max-w-md text-center">
              Soy un asesor experto en gestion de residuos industriales. Puedo
              analizar documentos, clasificar residuos, resolver dudas normativas
              y proponer estrategias de optimizacion.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 max-w-2xl w-full">
              {effectiveSuggestions.map((cat) => (
                <div key={cat.category} className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {cat.category}
                  </p>
                  {cat.questions.map((q) => (
                    <button
                      key={q}
                      onClick={() => selectSuggestion(q)}
                      className="w-full text-left rounded-lg border p-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.length === 0 && compact && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Sparkles className="h-8 w-8 text-vandarum-teal/20 mb-2" />
            <p className="text-sm text-muted-foreground">{effectiveEmpty}</p>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                msg.role === "user"
                  ? "bg-vandarum-teal text-white"
                  : "bg-muted"
              }`}
            >
              {msg.fileNames && msg.fileNames.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5 text-xs opacity-80">
                  <Paperclip className="h-3 w-3 shrink-0" />
                  {msg.fileNames.map((name, j) => (
                    <span key={j} className="bg-white/15 rounded px-1.5 py-0.5">
                      {name.length > 30 ? name.slice(0, 27) + "..." : name}
                    </span>
                  ))}
                </div>
              )}

              {msg.role === "assistant" ? (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert text-sm"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              ) : (
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              )}

              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 border-t border-border/30 pt-1.5">
                  <p className="text-xs font-medium mb-1 opacity-70 flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />
                    Fuentes:
                  </p>
                  <div className="space-y-0.5">
                    {msg.sources.map((src, j) =>
                      src.scope === "web" ? (
                        <a
                          key={j}
                          href={src.excerpt}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs opacity-70 hover:opacity-100"
                        >
                          <Globe className="h-3 w-3 shrink-0 text-blue-500" />
                          <span className="truncate underline">{src.title || src.excerpt}</span>
                          <Badge variant="outline" className="text-[10px] py-0 shrink-0 border-blue-300 text-blue-600">Web</Badge>
                        </a>
                      ) : (
                        <div key={j} className="flex items-center gap-1.5 text-xs opacity-70">
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{src.title}</span>
                          <Badge variant="outline" className="text-[10px] py-0 shrink-0">{Math.round(src.similarity * 100)}%</Badge>
                          <Badge variant="outline" className="text-[10px] py-0 shrink-0">{src.scope === "general" ? "KB" : "Proyecto"}</Badge>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {msg.role === "assistant" && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs opacity-60">
                  {msg.ragUsed === false && !msg.webSearchUsed && (
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Conocimiento experto
                    </span>
                  )}
                  {msg.webSearchUsed && (
                    <span className="flex items-center gap-1 text-blue-500">
                      <Globe className="h-3 w-3" />
                      Web
                    </span>
                  )}
                  <button
                    onClick={() => {
                      const userQuery = i > 0 && messages[i - 1]?.role === "user"
                        ? messages[i - 1].content
                        : "Consulta del asesor";
                      exportToWord(msg.content, userQuery, msg.sources);
                    }}
                    className="flex items-center gap-1 hover:opacity-100 opacity-60 transition-opacity ml-auto text-vandarum-teal"
                    title="Descargar como Word"
                  >
                    <Download className="h-3 w-3" />
                    Word
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-vandarum-teal" />
              <span>{hasFiles ? "Extrayendo y analizando..." : "Analizando..."}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive max-w-md text-center">
              {error}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input area */}
      <div className="mt-2">
        {(attachedFiles.length > 0 || urls.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {attachedFiles.map((file, i) => {
              const Icon = getFileIcon(file.name);
              return (
                <div key={`file-${i}`} className="flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded px-2 py-1">
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[120px]">{file.name}</span>
                  <span className="opacity-60 shrink-0">{formatFileSize(file.size)}</span>
                  <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-foreground ml-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            {urls.map((url, i) => (
              <div key={`url-${i}`} className="flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded px-2 py-1">
                <LinkIcon className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[150px]">{url}</span>
                <button onClick={() => removeUrl(i)} className="text-muted-foreground hover:text-foreground ml-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showUrlInput && (
          <div className="flex gap-1.5 mb-1.5">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addUrl(); }
                if (e.key === "Escape") { setShowUrlInput(false); setUrlInput(""); }
              }}
              placeholder="https://ejemplo.com/pagina"
              className="flex-1 rounded-md border bg-background px-2.5 py-1 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
              autoFocus
            />
            <Button size="sm" variant="outline" onClick={addUrl} className="h-7">Anadir</Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowUrlInput(false); setUrlInput(""); }} className="h-7 px-1.5">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <div className="flex gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={ACCEPTED_EXTENSIONS}
            multiple
            onChange={handleFileSelect}
          />
          <Button
            variant="outline"
            size="icon"
            className={compact ? "h-8 w-8" : ""}
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || totalAttachments >= MAX_FILES}
            title={`Adjuntar archivos (${totalAttachments}/${MAX_FILES})`}
          >
            <Paperclip className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className={compact ? "h-8 w-8" : ""}
            onClick={() => setShowUrlInput(!showUrlInput)}
            disabled={loading || totalAttachments >= MAX_FILES}
            title="Adjuntar URL"
          >
            <LinkIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </Button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            }}
            placeholder={effectivePlaceholder}
            className={`flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20 ${compact ? "py-1.5" : "py-2"}`}
            disabled={loading}
          />
          <Button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className={`bg-vandarum-teal hover:bg-vandarum-teal/90 ${compact ? "h-8 w-8 p-0" : ""}`}
            size={compact ? "icon" : "default"}
          >
            <Send className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </Button>
        </div>
      </div>
    </div>
  );
}
