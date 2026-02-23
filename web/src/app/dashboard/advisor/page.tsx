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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ─── Types ──────────────────────────────────────────────────────────

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
  fileName?: string;
  ragUsed?: boolean;
}

// ─── Text extraction from files ─────────────────────────────────────

async function extractTextFromFile(file: File): Promise<string> {
  // For text-based files, read directly
  const textTypes = [
    "text/plain",
    "text/csv",
    "application/json",
    "text/xml",
    "application/xml",
  ];

  if (textTypes.some((t) => file.type.includes(t)) || file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
    return await file.text();
  }

  // For PDFs and other binary files, we can't extract client-side easily.
  // We'll send the raw text representation or indicate it needs server processing.
  // For now, attempt to read as text (works for some formats).
  try {
    const text = await file.text();
    // If it looks like binary garbage, indicate we need server-side processing
    if (text.includes("\x00") || text.includes("�")) {
      return `[Archivo: ${file.name} (${(file.size / 1024).toFixed(1)} KB) - Formato binario. El archivo ha sido adjuntado pero su contenido requiere procesamiento especial. Describe su contenido en tu pregunta para obtener mejor ayuda.]`;
    }
    return text;
  } catch {
    return `[Archivo: ${file.name} - No se pudo leer el contenido]`;
  }
}

// ─── Suggested questions ────────────────────────────────────────────

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

// ─── Markdown renderer ──────────────────────────────────────────────

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

// ─── Component ──────────────────────────────────────────────────────

export default function AdvisorPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(async () => {
    const query = input.trim();
    if (!query || loading) return;

    setError(null);

    // Build user message
    const userMsg: ChatMessage = {
      role: "user",
      content: query,
      fileName: attachedFile?.name,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Extract file content if attached
      let fileContent: string | undefined;
      let fileName: string | undefined;
      if (attachedFile) {
        fileContent = await extractTextFromFile(attachedFile);
        fileName = attachedFile.name;
        setAttachedFile(null);
      }

      // Build conversation history (without the current message)
      const conversationHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          conversation_history: conversationHistory,
          file_content: fileContent,
          file_name: fileName,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(errData.error || `Error ${res.status}`);
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.answer,
        sources: data.sources,
        ragUsed: data.rag_context_used,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(detail);
    } finally {
      setLoading(false);
    }
  }, [input, loading, attachedFile, messages]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setAttachedFile(file);
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  }

  function clearConversation() {
    setMessages([]);
    setError(null);
    setAttachedFile(null);
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
            Experto en gestion de residuos industriales. Pregunta sobre clasificacion, normativa, desclasificacion, LER, propiedades HP y mas.
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
              <p className="text-lg font-medium mb-2">
                Como puedo ayudarte?
              </p>
              <p className="text-sm text-muted-foreground mb-8 max-w-md text-center">
                Soy un asesor experto en gestion de residuos industriales.
                Puedo analizar documentos, clasificar residuos, resolver dudas normativas
                y proponer estrategias de optimizacion.
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
                {/* File attachment indicator */}
                {msg.fileName && (
                  <div className="flex items-center gap-2 mb-2 text-xs opacity-80">
                    <Paperclip className="h-3 w-3" />
                    <span>{msg.fileName}</span>
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
                  <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                )}

                {/* Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 border-t border-border/30 pt-2">
                    <p className="text-xs font-medium mb-1.5 opacity-70 flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />
                      Fuentes consultadas:
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
                            {Math.round(src.similarity * 100)}%
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 shrink-0"
                          >
                            {src.scope === "general" ? "KB" : "Proyecto"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* RAG indicator */}
                {msg.role === "assistant" && msg.ragUsed === false && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs opacity-60">
                    <AlertTriangle className="h-3 w-3" />
                    Respuesta basada en conocimiento experto (sin documentos RAG)
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
                <span>Analizando y razonando...</span>
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
          {/* Attached file indicator */}
          {attachedFile && (
            <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground bg-muted rounded-md px-3 py-1.5">
              <Paperclip className="h-3.5 w-3.5" />
              <span className="truncate flex-1">{attachedFile.name}</span>
              <span className="text-xs shrink-0">
                ({(attachedFile.size / 1024).toFixed(1)} KB)
              </span>
              <button
                onClick={() => setAttachedFile(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex gap-2">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.xlsx,.xls,.csv,.txt,.json,.xml,.doc,.docx"
              onChange={handleFileSelect}
            />

            {/* Attach button */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Adjuntar documento (analisis, ficha seguridad, etc.)"
            >
              <Paperclip className="h-4 w-4" />
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
