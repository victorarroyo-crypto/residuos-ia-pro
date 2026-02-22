import Link from "next/link";
import {
  Users,
  FileText,
  AlertTriangle,
  TrendingDown,
  ArrowRight,
  Leaf,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

const severityColors: Record<string, "danger" | "warning" | "secondary" | "destructive"> = {
  critica: "destructive",
  alta: "danger",
  media: "warning",
  baja: "secondary",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { data: projects },
    { data: documents },
    { data: alerts },
    { data: savings },
  ] = await Promise.all([
    supabase.from("projects").select("*").order("nombre"),
    supabase.from("client_documents").select("*").order("fecha_ingesta", { ascending: false }),
    supabase.from("compliance_alerts").select("*").order("severidad"),
    supabase.from("savings_opportunities").select("*"),
  ]);

  const allClients = projects ?? [];
  const allDocuments = documents ?? [];
  const allAlerts = alerts ?? [];
  const allSavings = savings ?? [];

  const pendingAlerts = allAlerts.filter((a) => a.estado === "pendiente");
  const criticalAlerts = pendingAlerts.filter((a) => a.severidad === "critica");
  const totalSavings = allSavings.reduce(
    (sum, s) => sum + (s.ahorro_estimado_eur_año ?? 0),
    0
  );
  const recentDocs = allDocuments.slice(0, 5);
  const processingDocs = allDocuments.filter((d) => d.estado === "procesando");

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Resumen ejecutivo de tu cartera de clientes.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-gradient-brand px-4 py-2 text-white">
          <Leaf className="h-4 w-4" />
          <span className="text-sm font-medium">vandarum</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-t-2 border-t-vandarum-teal">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clientes</CardTitle>
            <Users className="h-4 w-4 text-vandarum-teal" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allClients.length}</div>
            <p className="text-xs text-muted-foreground">
              Total en cartera
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-vandarum-blue">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Documentos</CardTitle>
            <FileText className="h-4 w-4 text-vandarum-blue" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allDocuments.length}</div>
            <p className="text-xs text-muted-foreground">
              {allDocuments.filter((d) => d.estado === "indexado").length} procesados
              {processingDocs.length > 0 && `, ${processingDocs.length} en curso`}
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-vandarum-orange">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertas pendientes</CardTitle>
            <AlertTriangle className="h-4 w-4 text-vandarum-orange" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingAlerts.length}</div>
            <p className="text-xs text-muted-foreground">
              {criticalAlerts.length > 0
                ? `${criticalAlerts.length} criticas`
                : "ninguna critica"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-vandarum-green">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ahorro potencial</CardTitle>
            <TrendingDown className="h-4 w-4 text-vandarum-green" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalSavings.toLocaleString("es-ES")} EUR/a
            </div>
            <p className="text-xs text-muted-foreground">
              {allSavings.length} oportunidades detectadas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout: Alerts + Recent docs */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Urgent alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-vandarum-orange" />
              Alertas urgentes
            </CardTitle>
            {pendingAlerts.length > 5 && (
              <span className="text-xs text-muted-foreground">
                Mostrando 5 de {pendingAlerts.length}
              </span>
            )}
          </CardHeader>
          <CardContent>
            {pendingAlerts.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-vandarum-green mb-2" />
                <p className="text-sm text-muted-foreground">
                  No hay alertas pendientes. Todo en orden.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingAlerts.slice(0, 5).map((alert) => {
                  const client = allClients.find((c) => c.id === alert.project_id);
                  return (
                    <Link
                      key={alert.id}
                      href={`/dashboard/client/${alert.project_id}`}
                      className="flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-secondary"
                    >
                      <Badge variant={severityColors[alert.severidad]}>
                        {alert.severidad}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{alert.descripcion}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{client?.nombre}</span>
                          {alert.fecha_limite && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {alert.fecha_limite}
                            </span>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent documents */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-vandarum-blue" />
              Documentos recientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentDocs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin documentos procesados todavia.
              </p>
            ) : (
              <div className="space-y-3">
                {recentDocs.map((doc) => {
                  const client = allClients.find((c) => c.id === doc.project_id);
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 rounded-md border p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.titulo}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {client && <span>{client.nombre}</span>}
                          {doc.tipo && (
                            <Badge variant="outline" className="text-xs">
                              {doc.tipo}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant={
                          doc.estado === "indexado"
                            ? "success"
                            : doc.estado === "error"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {doc.estado}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/clients/new">
              <Button>
                <Users className="mr-2 h-4 w-4" />
                Nuevo cliente
              </Button>
            </Link>
            <Link href="/dashboard/clients">
              <Button variant="outline">
                <ArrowRight className="mr-2 h-4 w-4" />
                Ver clientes
              </Button>
            </Link>
            <Link href="/dashboard/knowledge-base">
              <Button variant="outline">
                <FileText className="mr-2 h-4 w-4" />
                Base de conocimiento
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
