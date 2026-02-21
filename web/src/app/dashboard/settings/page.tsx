"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  User,
  Shield,
  Loader2,
  Check,
  HardDrive,
  ExternalLink,
  Unlink,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="h-5 w-5 text-vandarum-teal" />
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

interface GDriveStatus {
  connected: boolean;
  root_folder_id?: string;
  connected_at?: string;
  configured?: boolean;
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Google Drive state
  const [gdriveStatus, setGdriveStatus] = useState<GDriveStatus | null>(null);
  const [gdriveLoading, setGdriveLoading] = useState(false);
  const [gdriveError, setGdriveError] = useState<string | null>(null);
  const [gdriveSuccess, setGdriveSuccess] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id || "";
      setNombre(data.user?.user_metadata?.nombre || "");
      setEmail(data.user?.email || "");
      setUserId(uid);
      setLoading(false);

      // Fetch Google Drive status
      if (uid) {
        fetchGdriveStatus(uid);
      }
    });
  }, []);

  // Handle OAuth callback result from URL params
  useEffect(() => {
    const gdriveParam = searchParams.get("gdrive");
    if (gdriveParam === "connected") {
      setGdriveSuccess(true);
      setTimeout(() => setGdriveSuccess(false), 5000);
      // Refresh status
      if (userId) fetchGdriveStatus(userId);
    } else if (gdriveParam === "error") {
      const errorDetail = searchParams.get("gdrive_error") || "Error desconocido";
      setGdriveError(`Error al conectar Google Drive: ${errorDetail}`);
    }
  }, [searchParams, userId]);

  async function fetchGdriveStatus(consultantId: string) {
    try {
      const res = await fetch(`/api/gdrive/status?consultant_id=${consultantId}`);
      if (res.ok) {
        setGdriveStatus(await res.json());
      }
    } catch {
      // Pipeline not available - not critical
    }
  }

  async function handleConnectGdrive() {
    setGdriveLoading(true);
    setGdriveError(null);
    try {
      const res = await fetch(`/api/gdrive/auth-url?consultant_id=${userId}`);
      if (!res.ok) {
        const err = await res.json();
        setGdriveError(err.error || "Error generando URL de autorizacion.");
        setGdriveLoading(false);
        return;
      }
      const { auth_url } = await res.json();
      // Redirect to Google consent screen
      window.location.href = auth_url;
    } catch {
      setGdriveError("Pipeline API no disponible. Asegurate de que el servidor Python esta corriendo.");
      setGdriveLoading(false);
    }
  }

  async function handleDisconnectGdrive() {
    if (!confirm("Se desconectara Google Drive. Los archivos en Drive no se eliminaran.")) {
      return;
    }
    setGdriveLoading(true);
    try {
      const res = await fetch(
        `/api/gdrive/disconnect?consultant_id=${userId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setGdriveStatus({ connected: false });
      }
    } catch {
      setGdriveError("Error al desconectar.");
    }
    setGdriveLoading(false);
  }

  async function handleSaveProfile() {
    setSaving(true);
    setSaved(false);
    const supabase = createClient();
    await supabase.auth.updateUser({
      data: { nombre },
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleChangePassword() {
    const supabase = createClient();
    if (!email) return;
    await supabase.auth.resetPasswordForEmail(email);
    alert("Se ha enviado un email para cambiar la contrasena.");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-vandarum-teal" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ajustes</h1>
        <p className="text-muted-foreground">
          Configura tu cuenta de consultor.
        </p>
      </div>

      <div className="grid gap-6 max-w-2xl">
        {/* Profile */}
        <SettingsSection
          icon={User}
          title="Perfil"
          description="Informacion de tu cuenta de consultor."
        >
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Nombre</label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="mt-1 w-full rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSaveProfile} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : saved ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : null}
                {saved ? "Guardado" : "Guardar perfil"}
              </Button>
            </div>
          </div>
        </SettingsSection>

        {/* Google Drive */}
        <SettingsSection
          icon={HardDrive}
          title="Google Drive"
          description="Sincroniza documentos con tu Google Drive. Se crea una estructura de carpetas organizada por cliente y tipo de documento."
        >
          <div className="space-y-4">
            {gdriveSuccess && (
              <div className="flex items-center gap-2 rounded-md bg-vandarum-green/10 px-3 py-2 text-sm text-vandarum-green">
                <CheckCircle2 className="h-4 w-4" />
                Google Drive conectado correctamente. Estructura de carpetas creada.
              </div>
            )}

            {gdriveError && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {gdriveError}
              </div>
            )}

            {gdriveStatus?.connected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="success">Conectado</Badge>
                    {gdriveStatus.connected_at && (
                      <span className="text-xs text-muted-foreground">
                        desde {new Date(gdriveStatus.connected_at).toLocaleDateString("es-ES")}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDisconnectGdrive}
                    disabled={gdriveLoading}
                  >
                    <Unlink className="mr-1 h-3 w-3" />
                    Desconectar
                  </Button>
                </div>

                {gdriveStatus.root_folder_id && (
                  <a
                    href={`https://drive.google.com/drive/folders/${gdriveStatus.root_folder_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-vandarum-teal hover:underline"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Abrir carpeta en Google Drive
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}

                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <p className="font-medium mb-1">Estructura creada:</p>
                  <pre className="font-mono">
{`RAG_Residuos_Industriales/
├── 01_Legislacion_Regulacion/
│   ├── 01_Europea_UE/
│   ├── 02_Nacional_Espana/
│   └── 03_Comunidades_Autonomas/ (19 CCAA + provincias)
├── 02_Documentacion_Tecnica/ (16 sectores industriales)
├── 03_Gestores_Residuos/ (nacional + por CCAA)
├── 04_Clasificacion_Residuos/
├── 05_Gestion_Operativa/
├── 06_Referencia/
└── 07_Config_RAG/`}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Al conectar Google Drive, se creara automaticamente una estructura de carpetas
                  organizada para todos tus clientes. Los documentos que subas se copiaran a Drive
                  ademas de procesarse en la plataforma.
                </p>
                <Button
                  onClick={handleConnectGdrive}
                  disabled={gdriveLoading}
                >
                  {gdriveLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <HardDrive className="mr-2 h-4 w-4" />
                  )}
                  Conectar Google Drive
                </Button>
              </div>
            )}
          </div>
        </SettingsSection>

        {/* Security */}
        <SettingsSection
          icon={Shield}
          title="Seguridad"
          description="Gestiona la seguridad de tu cuenta."
        >
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">Cambiar contrasena</p>
              <p className="text-xs text-muted-foreground">
                Se enviara un email con el enlace de cambio.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleChangePassword}>
              Cambiar
            </Button>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-vandarum-teal" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}
