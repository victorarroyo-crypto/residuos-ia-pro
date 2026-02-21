"use client";

import {
  User,
  Bell,
  Database,
  Palette,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
          <Icon className="h-5 w-5" />
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
      <div className="h-6 w-11 rounded-full bg-muted peer-checked:bg-primary after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
    </label>
  );
}

export default function SettingsPage() {
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
          description="Información de tu cuenta de consultor."
        >
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Nombre</label>
                <input
                  type="text"
                  defaultValue="Consultor Demo"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  defaultValue="consultor@empresa.com"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Empresa</label>
                <input
                  type="text"
                  defaultValue="Consultoría Ambiental S.L."
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Teléfono</label>
                <input
                  type="tel"
                  defaultValue="+34 600 000 000"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button>Guardar perfil</Button>
            </div>
          </div>
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection
          icon={Bell}
          title="Notificaciones"
          description="Controla qué alertas recibes y cómo."
        >
          <div>
            <SettingsRow
              label="Alertas críticas por email"
              description="Recibir un email cuando se detecte una alerta crítica."
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
              description="Aviso 30 días antes de que venza un contrato."
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
            <SettingsRow
              label="Email SMTP"
              description="Envío de notificaciones por email."
            >
              <Button variant="outline" size="sm">
                Configurar
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
              label="Tema oscuro"
              description="Cambiar entre tema claro y oscuro."
            >
              <Toggle />
            </SettingsRow>
            <SettingsRow
              label="Formato de fechas"
              description="Cómo se muestran las fechas en la plataforma."
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
              label="Cambiar contraseña"
              description="Última actualización hace 3 meses."
            >
              <Button variant="outline" size="sm">
                Cambiar
              </Button>
            </SettingsRow>
            <SettingsRow
              label="Autenticación en dos pasos"
              description="Añade una capa extra de seguridad."
            >
              <Toggle />
            </SettingsRow>
            <SettingsRow
              label="Sesiones activas"
              description="1 sesión activa en este dispositivo."
            >
              <Button variant="outline" size="sm">
                Ver sesiones
              </Button>
            </SettingsRow>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
