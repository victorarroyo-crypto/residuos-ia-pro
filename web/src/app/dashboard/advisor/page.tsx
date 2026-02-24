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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ─── Constants ───────────────────────────────────────────────────

const MAX_FILES = 6;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB per file

const ACCEPTED_EXTENSIONS =
  ".pdf,.xlsx,.xls,.csv,.txt,.json,.xml,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.tif";

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

// ─── Suggested questions ────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
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

// ─── Markdown renderer ──────────────────────────────────────────

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

// ─── Component ──────────────────────────────────────────────────

export default function AdvisorPage() {
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
    inputRef.current?.focus();
  }, []);

  const totalAttachments = attachedFiles.length + urls.length;
  const hasFiles = attachedFiles.length > 0;

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

    // Capture current state before clearing
    const currentFiles = [...attachedFiles];
    const currentUrls = [...urls];
    const hasFileAttachments = currentFiles.length > 0;

    setAttachedFiles([]);
    setUrls([]);
    setShowUrlInput(false);
    setUrlInput("");

    try {
      const conversationHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let res: Response;

      if (hasFileAttachments) {
        // ── FormData: send files through Next.js proxy ──
        const formData = new FormData();
        formData.append("query", query);
        formData.append("conversation_history", JSON.stringify(conversationHistory));
        if (currentUrls.length > 0) {
          formData.append("urls", JSON.stringify(currentUrls));
        }
        for (const file of currentFiles) {
          formData.append("files", file);
        }

        res = await fetch("/api/advisor/chat", {
          method: "POST",
          body: formData,
          // No Content-Type header - browser sets it with boundary for multipart
        });
      } else {
        // ── JSON: text-only queries through Next.js proxy ──
        res = await fetch("/api/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            conversation_history: conversationHistory,
            urls: currentUrls.length > 0 ? currentUrls : undefined,
          }),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        const errMsg =
          errData?.error || errData?.detail || `Error ${res.status}`;
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
        setError(
          "Error de red. Verifica tu conexion y que el servidor esta activo."
        );
      } else {
        setError(detail);
      }
    } finally {
      setLoading(false);
    }
  }, [input, loading, attachedFiles, urls, messages, hasFiles]);

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

    if (rejected.length > 0) {
      setError(`Archivos rechazados: ${rejected.join(", ")}`);
    }

    if (selectedFiles.length > remaining) {
      setError(
        `Solo se pueden adjuntar ${MAX_FILES} archivos. Se anadieron los primeros ${remaining}.`
      );
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

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Sparkles className="h-8 w-8 text-vandarum-teal" />
            Asesor IA
          </h1>
          <p className="text-muted-foreground">
            Experto en gestion de residuos industriales. Adjunta hasta{" "}
            {MAX_FILES} archivos (PDF, Excel, Word, fotos) o URLs.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearConversation}>
            <Trash2 className="mr-2 h-4 w-4" />
            Nueva conversacion
          </Button>
        )}
      </div>

      {/* Chat area */}
      <Card className="flex-1 flex flex-col min-h-0">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Empty state with suggestions */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full">
              <Sparkles className="h-16 w-16 text-vandarum-teal/20 mb-6" />
              <p className="text-lg font-medium mb-2">Como puedo ayudarte?</p>
              <p className="text-sm text-muted-foreground mb-8 max-w-md text-center">
                Soy un asesor experto en gestion de residuos industriales. Puedo
                analizar documentos, fotos, hojas de calculo, clasificar
                residuos, resolver dudas normativas y proponer estrategias de
                optimizacion. Adjunta hasta {MAX_FILES} archivos o URLs por
                consulta.
              </p>

              <div className="grid gap-4 sm:grid-cols-2 max-w-2xl w-full">
                {SUGGESTED_QUESTIONS.map((cat) => (
                  <div key={cat.category} className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {cat.category}
                    </p>
                    {cat.questions.map((q) => (
                      <button
                        key={q}
                        onClick={() => selectSuggestion(q)}
                        className="w-full text-left rounded-lg border p-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-vandarum-teal text-white"
                    : "bg-muted"
                }`}
              >
                {/* File attachments indicator */}
                {msg.fileNames && msg.fileNames.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mb-2 text-xs opacity-80">
                    <Paperclip className="h-3 w-3 shrink-0" />
                    {msg.fileNames.map((name, j) => (
                      <span
                        key={j}
                        className="bg-white/15 rounded px-1.5 py-0.5"
                      >
                        {name.length > 30 ? name.slice(0, 27) + "..." : name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Message content */}
                {msg.role === "assistant" ? (
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert text-sm"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(msg.content),
                    }}
                  />
                ) : (
                  <div className="text-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                )}

                {/* Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 border-t border-border/30 pt-2">
                    <p className="text-xs font-medium mb-1.5 opacity-70 flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />
                      Fuentes consultadas:
                    </p>
                    <div className="space-y-1">
                      {msg.sources.map((src, j) =>
                        src.scope === "web" ? (
                          <a
                            key={j}
                            href={src.excerpt}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs opacity-70 hover:opacity-100 transition-opacity"
                          >
                            <Globe className="h-3 w-3 shrink-0 text-blue-500" />
                            <span className="truncate underline">
                              {src.title || src.excerpt}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 shrink-0 border-blue-300 text-blue-600"
                            >
                              Web
                            </Badge>
                          </a>
                        ) : (
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
                              {Math.round(src.similarity * 100)}%
                            </Badge>
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 shrink-0"
                            >
                              {src.scope === "general" ? "KB" : "Proyecto"}
                            </Badge>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Context indicators */}
                {msg.role === "assistant" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-60">
                    {msg.ragUsed === false && !msg.webSearchUsed && (
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Respuesta basada en conocimiento experto
                      </span>
                    )}
                    {msg.webSearchUsed && (
                      <span className="flex items-center gap-1 text-blue-500">
                        <Globe className="h-3 w-3" />
                        Busqueda web utilizada
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-3 text-sm flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-vandarum-teal" />
                <span>
                  {hasFiles
                    ? "Extrayendo contenido y analizando..."
                    : "Analizando y razonando..."}
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex justify-center">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive max-w-md text-center">
                {error}
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </CardContent>

        {/* Input area */}
        <div className="border-t p-4">
          {/* Attached files list */}
          {(attachedFiles.length > 0 || urls.length > 0) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachedFiles.map((file, i) => {
                const Icon = getFileIcon(file.name);
                return (
                  <div
                    key={`file-${i}`}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground bg-muted rounded-md px-2.5 py-1.5"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate max-w-[150px]">{file.name}</span>
                    <span className="text-xs shrink-0 opacity-60">
                      {formatFileSize(file.size)}
                    </span>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-muted-foreground hover:text-foreground ml-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              {urls.map((url, i) => (
                <div
                  key={`url-${i}`}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground bg-muted rounded-md px-2.5 py-1.5"
                >
                  <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate max-w-[200px]">{url}</span>
                  <button
                    onClick={() => removeUrl(i)}
                    className="text-muted-foreground hover:text-foreground ml-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="text-xs text-muted-foreground self-center opacity-60">
                {totalAttachments}/{MAX_FILES}
              </div>
            </div>
          )}

          {/* URL input row */}
          {showUrlInput && (
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addUrl();
                  }
                  if (e.key === "Escape") {
                    setShowUrlInput(false);
                    setUrlInput("");
                  }
                }}
                placeholder="https://ejemplo.com/pagina"
                className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
                autoFocus
              />
              <Button size="sm" variant="outline" onClick={addUrl}>
                Anadir
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowUrlInput(false);
                  setUrlInput("");
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            {/* Hidden file input (multiple) */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={ACCEPTED_EXTENSIONS}
              multiple
              onChange={handleFileSelect}
            />

            {/* Attach file button */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || totalAttachments >= MAX_FILES}
              title={`Adjuntar archivos (${totalAttachments}/${MAX_FILES})`}
            >
              <Paperclip className="h-4 w-4" />
            </Button>

            {/* Attach URL button */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowUrlInput(!showUrlInput)}
              disabled={loading || totalAttachments >= MAX_FILES}
              title="Adjuntar URL de pagina web"
            >
              <LinkIcon className="h-4 w-4" />
            </Button>

            {/* Text input */}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Pregunta sobre residuos, normativa, clasificacion, LER, desclasificacion..."
              className="flex-1 rounded-md border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
              disabled={loading}
            />

            {/* Send button */}
            <Button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="bg-vandarum-teal hover:bg-vandarum-teal/90"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
