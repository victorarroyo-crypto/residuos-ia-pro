"use client";

import { useState, useEffect } from "react";
import {
  User,
  Shield,
  Loader2,
  Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
