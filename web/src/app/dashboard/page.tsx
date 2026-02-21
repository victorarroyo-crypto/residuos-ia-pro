"use client";

import Link from "next/link";
import {
  Users,
  FileText,
  AlertTriangle,
  TrendingDown,
  ArrowRight,
  Building2,
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
import {
  mockClients,
  mockAlerts,
  mockSavings,
  mockDocuments,
  getClientComplianceStatus,
  getClientAlertCount,
} from "@/lib/mock-data";

const severityColors: Record<string, "danger" | "warning" | "secondary" | "destructive"> = {
  critica: "destructive",
  alta: "danger",
  media: "warning",
  baja: "secondary",
};

function ComplianceDot({ status }: { status: "ok" | "warning" | "danger" }) {
  const colors = {
    ok: "bg-green-500",
    warning: "bg-yellow-500",
    danger: "bg-red-500",
  };
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${colors[status]}`}
      title={status === "ok" ? "Cumplimiento OK" : status === "warning" ? "Revisar" : "Alerta"}
    />
  );
}

export default function DashboardPage() {
  const activeClients = mockClients.filter((c) => c.activo);
  const pendingAlerts = mockAlerts.filter((a) => a.estado === "pendiente");
  const totalSavings = mockSavings.reduce(
    (sum, s) => sum + (s.ahorro_estimado_eur_año ?? 0),
    0
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Resumen de tu cartera de clientes y estado de cumplimiento.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clientes activos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeClients.length}</div>
            <p className="text-xs text-muted-foreground">
              {mockClients.length} total en cartera
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Documentos indexados</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockDocuments.length}</div>
            <p className="text-xs text-muted-foreground">
              {mockDocuments.filter((d) => d.estado === "indexado").length} procesados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertas pendientes</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingAlerts.length}</div>
            <p className="text-xs text-muted-foreground">
              {pendingAlerts.filter((a) => a.severidad === "critica").length} críticas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ahorro potencial</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalSavings.toLocaleString("es-ES")} EUR/a
            </div>
            <p className="text-xs text-muted-foreground">
              {mockSavings.length} oportunidades detectadas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Clients table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5" />
            Clientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">Estado</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>CCAA</TableHead>
                <TableHead>Relación</TableHead>
                <TableHead className="text-center">Alertas</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockClients.map((client) => {
                const status = getClientComplianceStatus(client.id);
                const alertCount = getClientAlertCount(client.id);
                return (
                  <TableRow key={client.id}>
                    <TableCell>
                      <ComplianceDot status={status} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/client/${client.id}`}
                        className="hover:underline"
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
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/dashboard/client/${client.id}`}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        Ver <ArrowRight className="h-3 w-3" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5" />
            Alertas recientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pendingAlerts.slice(0, 5).map((alert) => {
              const client = mockClients.find((c) => c.id === alert.client_id);
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
                      {alert.fecha_limite && ` — Límite: ${alert.fecha_limite}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
