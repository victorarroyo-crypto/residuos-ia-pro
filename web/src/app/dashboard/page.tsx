import Link from "next/link";
import {
  Users,
  FileText,
  AlertTriangle,
  TrendingDown,
  ArrowRight,
  Building2,
  Leaf,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";

const severityColors: Record<string, "danger" | "warning" | "secondary" | "destructive"> = {
  critica: "destructive",
  alta: "danger",
  media: "warning",
  baja: "secondary",
};

function ComplianceDot({ alertCount, hasCritical }: { alertCount: number; hasCritical: boolean }) {
  const status = hasCritical ? "danger" : alertCount > 0 ? "warning" : "ok";
  const colors = {
    ok: "bg-vandarum-green",
    warning: "bg-vandarum-orange",
    danger: "bg-red-500",
  };
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${colors[status]}`}
      title={status === "ok" ? "Cumplimiento OK" : status === "warning" ? "Revisar" : "Alerta"}
    />
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { data: clients },
    { data: documents },
    { data: alerts },
    { data: savings },
  ] = await Promise.all([
    supabase.from("clients").select("*").order("nombre"),
    supabase.from("client_documents").select("*"),
    supabase.from("compliance_alerts").select("*").order("severidad"),
    supabase.from("savings_opportunities").select("*"),
  ]);

  const allClients = clients ?? [];
  const allDocuments = documents ?? [];
  const allAlerts = alerts ?? [];
  const allSavings = savings ?? [];

  const activeClients = allClients.filter((c) => c.activo);
  const pendingAlerts = allAlerts.filter((a) => a.estado === "pendiente");
  const totalSavings = allSavings.reduce(
    (sum, s) => sum + (s.ahorro_estimado_eur_año ?? 0),
    0
  );

  function getAlertInfo(clientId: string) {
    const clientAlerts = allAlerts.filter(
      (a) => a.client_id === clientId && a.estado === "pendiente"
    );
    return {
      count: clientAlerts.length,
      hasCritical: clientAlerts.some((a) => a.severidad === "critica"),
    };
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Resumen de tu cartera de clientes y estado de cumplimiento.
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
            <CardTitle className="text-sm font-medium">Clientes activos</CardTitle>
            <Users className="h-4 w-4 text-vandarum-teal" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeClients.length}</div>
            <p className="text-xs text-muted-foreground">
              {allClients.length} total en cartera
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-vandarum-blue">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Documentos indexados</CardTitle>
            <FileText className="h-4 w-4 text-vandarum-blue" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allDocuments.length}</div>
            <p className="text-xs text-muted-foreground">
              {allDocuments.filter((d) => d.estado === "indexado").length} procesados
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
              {pendingAlerts.filter((a) => a.severidad === "critica").length} criticas
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

      {/* Clients table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-vandarum-teal" />
            Clientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allClients.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No hay clientes registrados. Crea tu primer cliente para empezar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">Estado</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>CCAA</TableHead>
                  <TableHead>Relacion</TableHead>
                  <TableHead className="text-center">Alertas</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {allClients.map((client) => {
                  const { count: alertCount, hasCritical } = getAlertInfo(client.id);
                  return (
                    <TableRow key={client.id}>
                      <TableCell>
                        <ComplianceDot alertCount={alertCount} hasCritical={hasCritical} />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          href={`/dashboard/client/${client.id}`}
                          className="text-vandarum-teal hover:underline"
                        >
                          {client.nombre}
                        </Link>
                        {!client.activo && (
                          <Badge variant="secondary" className="ml-2">
                            Inactivo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {client.sector}
                      </TableCell>
                      <TableCell>{client.comunidad}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {client.tipo_relacion}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {alertCount > 0 ? (
                          <Badge variant="danger">{alertCount}</Badge>
                        ) : (
                          <span className="text-muted-foreground">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/client/${client.id}`}
                          className="inline-flex items-center gap-1 text-sm text-vandarum-teal hover:underline"
                        >
                          Ver <ArrowRight className="h-3 w-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-vandarum-orange" />
            Alertas recientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingAlerts.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">
              No hay alertas pendientes.
            </p>
          ) : (
            <div className="space-y-3">
              {pendingAlerts.slice(0, 5).map((alert) => {
                const client = allClients.find((c) => c.id === alert.client_id);
                return (
                  <div
                    key={alert.id}
                    className="flex items-start gap-3 rounded-md border p-3"
                  >
                    <Badge variant={severityColors[alert.severidad]}>
                      {alert.severidad}
                    </Badge>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{alert.descripcion}</p>
                      <p className="text-xs text-muted-foreground">
                        {client?.nombre}
                        {alert.fecha_limite && ` \u2014 Limite: ${alert.fecha_limite}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
