import Link from "next/link";
import {
  FolderKanban,
  AlertTriangle,
  TrendingDown,
  ArrowRight,
  Leaf,
  Clock,
  CheckCircle2,
  BookOpen,
  Plus,
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
    { data: kbDocs },
    { data: alerts },
    { data: savings },
    { data: projectDocs },
  ] = await Promise.all([
    supabase.from("projects").select("*").order("nombre"),
    supabase.from("knowledge_documents").select("id, titulo, tipo, estado, fecha_ingesta").order("fecha_ingesta", { ascending: false }).limit(5),
    supabase.from("compliance_alerts").select("*").eq("estado", "pendiente").order("severidad"),
    supabase.from("savings_opportunities").select("*"),
    supabase.from("project_documents").select("id, project_id"),
  ]);

  const allProjects = projects ?? [];
  const allKbDocs = kbDocs ?? [];
  const allAlerts = alerts ?? [];
  const allSavings = savings ?? [];
  const allProjectDocs = projectDocs ?? [];

  const criticalAlerts = allAlerts.filter((a) => a.severidad === "critica");
  const totalSavings = allSavings.reduce(
    (sum, s) => sum + (s.ahorro_estimado_eur_año ?? 0),
    0
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Resumen ejecutivo de tu cartera de proyectos.
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
            <CardTitle className="text-sm font-medium">Proyectos</CardTitle>
            <FolderKanban className="h-4 w-4 text-vandarum-teal" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allProjects.length}</div>
            <p className="text-xs text-muted-foreground">
              {allProjectDocs.length} documentos de proyecto
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-vandarum-blue">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Base de Conocimiento</CardTitle>
            <BookOpen className="h-4 w-4 text-vandarum-blue" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allKbDocs.length}</div>
            <p className="text-xs text-muted-foreground">
              documentos normativos indexados
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-vandarum-orange">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertas pendientes</CardTitle>
            <AlertTriangle className="h-4 w-4 text-vandarum-orange" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allAlerts.length}</div>
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
              {allSavings.length} oportunidades
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Two-column: Alerts + KB docs */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Urgent alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-vandarum-orange" />
              Alertas urgentes
            </CardTitle>
            {allAlerts.length > 0 && (
              <Link href="/dashboard/projects" className="text-xs text-vandarum-teal hover:underline">
                Ver proyectos
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {allAlerts.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-vandarum-green mb-2" />
                <p className="text-sm text-muted-foreground">
                  No hay alertas pendientes. Todo en orden.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {allAlerts.slice(0, 5).map((alert) => {
                  const project = allProjects.find((p) => p.id === alert.project_id);
                  return (
                    <Link
                      key={alert.id}
                      href={`/dashboard/projects/${alert.project_id}`}
                      className="flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-secondary"
                    >
                      <Badge variant={severityColors[alert.severidad]}>
                        {alert.severidad}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{alert.descripcion}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{project?.nombre}</span>
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

        {/* Recent KB documents */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpen className="h-5 w-5 text-vandarum-blue" />
              Base de Conocimiento
            </CardTitle>
            <Link href="/dashboard/knowledge-base" className="text-xs text-vandarum-teal hover:underline">
              Gestionar
            </Link>
          </CardHeader>
          <CardContent>
            {allKbDocs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin documentos normativos indexados.
              </p>
            ) : (
              <div className="space-y-3">
                {allKbDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.titulo}</p>
                      {doc.tipo && (
                        <Badge variant="outline" className="text-xs mt-1">
                          {doc.tipo.replace(/_/g, " ")}
                        </Badge>
                      )}
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
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/projects/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo proyecto
              </Button>
            </Link>
            <Link href="/dashboard/projects">
              <Button variant="outline">
                <FolderKanban className="mr-2 h-4 w-4" />
                Ver proyectos
              </Button>
            </Link>
            <Link href="/dashboard/knowledge-base">
              <Button variant="outline">
                <BookOpen className="mr-2 h-4 w-4" />
                Base de conocimiento
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
