"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  MessageSquare,
  Trash2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GoogleDrivePicker } from "@/components/google-drive-picker";
import { AdvisorChat, ChatMessage } from "@/components/advisor-chat";
import { createClient } from "@/lib/supabase/client";

// ─── Chat session types ─────────────────────────────────────────

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "residusia-advisor-sessions";
const ACTIVE_SESSION_KEY = "residusia-advisor-active";

// ─── LocalStorage helpers ────────────────────────────────────────

function loadSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function loadActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_SESSION_KEY);
}

function saveActiveSessionId(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_SESSION_KEY, id);
}

function generateId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Nuevo chat";
  const text = first.content.slice(0, 50);
  return text.length < first.content.length ? text + "..." : text;
}

// ─── Page Component ──────────────────────────────────────────────

export default function AdvisorPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [consultantId, setConsultantId] = useState<string>("");
  const [useGDriveFolder, setUseGDriveFolder] = useState(false);
  const [gdriveFolderId, setGdriveFolderId] = useState<string>("");
  const [gdriveFolderName, setGdriveFolderName] = useState<string>("");
  const [gdriveMaxFiles, setGdriveMaxFiles] = useState<number>(12);

  // Load from localStorage on mount
  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    const savedActive = loadActiveSessionId();
    if (savedActive && loaded.some((s) => s.id === savedActive)) {
      setActiveId(savedActive);
    } else if (loaded.length > 0) {
      setActiveId(loaded[0].id);
    } else {
      // Create first session
      const first: ChatSession = {
        id: generateId(),
        title: "Nuevo chat",
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setSessions([first]);
      setActiveId(first.id);
      saveSessions([first]);
      saveActiveSessionId(first.id);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function bootstrapAdvisorScope() {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id || "";
      if (!userId || cancelled) return;

      setConsultantId(userId);

      try {
        const statusRes = await fetch(`/api/gdrive/status?consultant_id=${encodeURIComponent(userId)}`);
        if (!statusRes.ok) return;
        const status = await statusRes.json();
        const root = typeof status?.root_folder_id === "string" ? status.root_folder_id : "";
        if (root && !cancelled) {
          setGdriveFolderId(root);
          setGdriveFolderName("Carpeta raíz conectada");
        }
      } catch {
        // Non-blocking: advisor works without Drive folder mode
      }
    }

    bootstrapAdvisorScope();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeSession = sessions.find((s) => s.id === activeId) || null;

  // Persist sessions to localStorage on change
  useEffect(() => {
    if (sessions.length > 0) saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (activeId) saveActiveSessionId(activeId);
  }, [activeId]);

  const handleMessagesChange = useCallback(
    (newMessages: ChatMessage[]) => {
      if (!activeId) return;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                messages: newMessages,
                title: newMessages.length > 0 ? generateTitle(newMessages) : "Nuevo chat",
                updatedAt: new Date().toISOString(),
              }
            : s
        )
      );
    },
    [activeId]
  );

  function createNewChat() {
    const session: ChatSession = {
      id: generateId(),
      title: "Nuevo chat",
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
  }

  function switchToSession(id: string) {
    setActiveId(id);
  }

  function deleteSession(id: string) {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (activeId === id) {
        if (filtered.length > 0) {
          setActiveId(filtered[0].id);
        } else {
          const fresh: ChatSession = {
            id: generateId(),
            title: "Nuevo chat",
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setActiveId(fresh.id);
          return [fresh];
        }
      }
      return filtered;
    });
  }

  const containerClass = fullscreen
    ? "fixed inset-0 z-50 bg-background flex flex-col p-4"
    : "flex h-[calc(100vh-6rem)] flex-col gap-4";

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="h-8 w-8"
            title={sidebarOpen ? "Ocultar historial" : "Mostrar historial"}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-vandarum-teal" />
              Asesor IA
            </h1>
            {!fullscreen && (
              <p className="text-sm text-muted-foreground mt-1">
                Experto en gestion de residuos industriales. Adjunta documentos, URLs o imagenes para un analisis mas preciso.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={createNewChat}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nuevo chat
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFullscreen(!fullscreen)}
            className="h-8 w-8"
            title={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {fullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {!fullscreen && (
        <div className="shrink-0 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useGDriveFolder}
                onChange={(e) => setUseGDriveFolder(e.target.checked)}
              />
              Analizar carpeta de Google Drive en este chat
            </label>
            <GoogleDrivePicker
              consultantId={consultantId}
              disabled={!useGDriveFolder || !consultantId}
              onFolderSelected={(folderId, folderName) => {
                setGdriveFolderId(folderId);
                setGdriveFolderName(folderName);
              }}
              onError={(err) => {
                console.error("[advisor-page] picker error", err);
              }}
            />

            {gdriveFolderId && (
              <Badge variant="secondary" className="max-w-[420px] truncate">
                {gdriveFolderName ? `Drive > ${gdriveFolderName}` : `Drive > ${gdriveFolderId}`}
              </Badge>
            )}

            <input
              type="number"
              min={1}
              max={30}
              value={gdriveMaxFiles}
              onChange={(e) => setGdriveMaxFiles(Math.max(1, Math.min(30, Number(e.target.value) || 12)))}
              disabled={!useGDriveFolder}
              className="h-9 w-24 rounded-md border px-2 text-sm disabled:opacity-50"
              title="Maximo de archivos a analizar"
            />
          </div>

          {useGDriveFolder && (
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Opciones avanzadas (ID manual)</summary>
              <input
                type="text"
                placeholder="Pegar ID de carpeta manualmente"
                value={gdriveFolderId}
                onChange={(e) => {
                  setGdriveFolderId(e.target.value);
                  if (!e.target.value.trim()) setGdriveFolderName("");
                }}
                className="mt-2 h-8 w-full rounded-md border px-2 text-xs"
              />
            </details>
          )}
        </div>
      )}

      {/* Main content: sidebar + chat */}
      <div className="flex flex-1 min-h-0 gap-3">
        {/* Sidebar - chat history */}
        {sidebarOpen && (
          <div className="w-64 shrink-0 border rounded-lg bg-background overflow-hidden flex flex-col">
            <div className="p-2 border-b">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                Historial de chats
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                    session.id === activeId
                      ? "bg-vandarum-teal/10 text-foreground"
                      : "hover:bg-muted text-muted-foreground"
                  }`}
                  onClick={() => switchToSession(session.id)}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-sm truncate flex-1">{session.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(session.id);
                    }}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                    title="Eliminar chat"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {sessions.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Sin conversaciones
                </p>
              )}
            </div>
          </div>
        )}

        {/* Chat area */}
        <Card className="flex-1 flex flex-col min-h-0 p-4">
          {activeSession ? (
            <AdvisorChat
              key={activeId}
              className="flex-1 min-h-0"
              consultantId={useGDriveFolder ? consultantId : undefined}
              gdriveFolderId={useGDriveFolder ? gdriveFolderId : undefined}
              gdriveMaxFiles={gdriveMaxFiles}
              messages={activeSession.messages}
              onMessagesChange={handleMessagesChange}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <Sparkles className="h-8 w-8 mr-2 opacity-20" />
              Selecciona o crea un chat
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
