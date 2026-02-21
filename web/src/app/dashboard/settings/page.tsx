"use client";

import { useState, useEffect } from "react";
import {
  User,
  Bell,
  Database,
  Palette,
  Shield,
  Loader2,
  Check,
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

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ defaultChecked = false }: { defaultChecked?: boolean }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <div className="h-6 w-11 rounded-full bg-muted peer-checked:bg-vandarum-teal after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
    </label>
  );
}

export default function SettingsPage() {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setNombre(data.user?.user_metadata?.nombre || "");
      setEmail(data.user?.email || "");
      setLoading(false);
    });
  }, []);

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
          Configura tu cuenta y preferencias de la plataforma.
        </p>
      </div>

      <div className="grid gap-6">
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

        {/* Notifications */}
        <SettingsSection
          icon={Bell}
          title="Notificaciones"
          description="Controla que alertas recibes y como."
        >
          <div>
            <SettingsRow
              label="Alertas criticas por email"
              description="Recibir un email cuando se detecte una alerta critica."
            >
              <Toggle defaultChecked />
            </SettingsRow>
            <SettingsRow
              label="Resumen semanal"
              description="Email con resumen de alertas y oportunidades de la semana."
            >
              <Toggle defaultChecked />
            </SettingsRow>
            <SettingsRow
              label="Vencimiento de contratos"
              description="Aviso 30 dias antes de que venza un contrato."
            >
              <Toggle defaultChecked />
            </SettingsRow>
            <SettingsRow
              label="Nuevas oportunidades de ahorro"
              description="Notificar cuando la IA detecte nuevas oportunidades."
            >
              <Toggle />
            </SettingsRow>
          </div>
        </SettingsSection>

        {/* Integrations */}
        <SettingsSection
          icon={Database}
          title="Integraciones"
          description="Conexiones con servicios externos."
        >
          <div>
            <SettingsRow
              label="Supabase"
              description="Base de datos y almacenamiento."
            >
              <Badge variant="success">Conectado</Badge>
            </SettingsRow>
            <SettingsRow
              label="Google Drive"
              description="Almacenamiento de documentos originales."
            >
              <Button variant="outline" size="sm">
                Conectar
              </Button>
            </SettingsRow>
          </div>
        </SettingsSection>

        {/* Appearance */}
        <SettingsSection
          icon={Palette}
          title="Apariencia"
          description="Personaliza la interfaz."
        >
          <div>
            <SettingsRow
              label="Formato de fechas"
              description="Como se muestran las fechas en la plataforma."
            >
              <select className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none">
                <option>DD/MM/AAAA</option>
                <option>AAAA-MM-DD</option>
              </select>
            </SettingsRow>
          </div>
        </SettingsSection>

        {/* Security */}
        <SettingsSection
          icon={Shield}
          title="Seguridad"
          description="Gestiona la seguridad de tu cuenta."
        >
          <div>
            <SettingsRow
              label="Cambiar contrasena"
              description="Se enviara un email con el enlace de cambio."
            >
              <Button variant="outline" size="sm" onClick={handleChangePassword}>
                Cambiar
              </Button>
            </SettingsRow>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
