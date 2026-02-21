"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockAlerts, mockClients } from "@/lib/mock-data";

const severityColors: Record<string, "danger" | "warning" | "secondary" | "destructive"> = {
  critica: "destructive",
  alta: "danger",
  media: "warning",
  baja: "secondary",
};

const severityOrder: Record<string, number> = {
  critica: 0,
  alta: 1,
  media: 2,
  baja: 3,
};

const estadoIcons: Record<string, React.ReactNode> = {
  pendiente: <Clock className="h-4 w-4 text-vandarum-orange" />,
  vista: <ShieldAlert className="h-4 w-4 text-vandarum-blue" />,
  resuelta: <CheckCircle2 className="h-4 w-4 text-vandarum-green" />,
};

type FilterSeveridad = "todos" | "critica" | "alta" | "media" | "baja";
type FilterEstado = "todos" | "pendiente" | "vista" | "resuelta" | "descartada";

export default function AlertsPage() {
  const [search, setSearch] = useState("");
  const [filterSeveridad, setFilterSeveridad] = useState<FilterSeveridad>("todos");
  const [filterEstado, setFilterEstado] = useState<FilterEstado>("todos");

  const filtered = mockAlerts
    .filter((a) => {
      const client = mockClients.find((c) => c.id === a.client_id);
      const matchSearch =
        search === "" ||
        a.descripcion.toLowerCase().includes(search.toLowerCase()) ||
        client?.nombre.toLowerCase().includes(search.toLowerCase()) ||
        a.tipo.toLowerCase().includes(search.toLowerCase());
      const matchSeveridad =
        filterSeveridad === "todos" || a.severidad === filterSeveridad;
      const matchEstado =
        filterEstado === "todos" || a.estado === filterEstado;
      return matchSearch && matchSeveridad && matchEstado;
    })
    .sort((a, b) => severityOrder[a.severidad] - severityOrder[b.severidad]);

  const pendingCount = mockAlerts.filter((a) => a.estado === "pendiente").length;
  const criticalCount = mockAlerts.filter(
    (a) => a.severidad === "critica" && a.estado === "pendiente"
  ).length;
  const resolvedCount = mockAlerts.filter((a) => a.estado === "resuelta").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Alertas</h1>
        <p className="text-muted-foreground">
          Alertas de cumplimiento normativo y oportunidades detectadas.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
            <Clock className="h-4 w-4 text-vandarum-orange" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
            <p className="text-xs text-muted-foreground">
              requieren atención
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Críticas</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{criticalCount}</div>
            <p className="text-xs text-muted-foreground">
              acción inmediata
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resueltas</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-vandarum-green" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-vandarum-green">{resolvedCount}</div>
            <p className="text-xs text-muted-foreground">
              de {mockAlerts.length} totales
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por descripción, cliente o tipo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={filterSeveridad}
                onChange={(e) => setFilterSeveridad(e.target.value as FilterSeveridad)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Toda severidad</option>
                <option value="critica">Crítica</option>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
              <select
                value={filterEstado}
                onChange={(e) => setFilterEstado(e.target.value as FilterEstado)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Todo estado</option>
                <option value="pendiente">Pendiente</option>
                <option value="vista">Vista</option>
                <option value="resuelta">Resuelta</option>
                <option value="descartada">Descartada</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-vandarum-orange" />
            {filtered.length} alerta{filtered.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No se encontraron alertas con esos filtros.
            </p>
          ) : (
            <div className="space-y-3">
              {filtered.map((alert) => {
                const client = mockClients.find((c) => c.id === alert.client_id);
                return (
                  <div
                    key={alert.id}
                    className="flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-secondary"
                  >
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                      <Badge variant={severityColors[alert.severidad]}>
                        {alert.severidad}
                      </Badge>
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">{alert.descripcion}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {client && (
                          <Link
                            href={`/dashboard/client/${client.id}`}
                            className="hover:underline"
                          >
                            {client.nombre}
                          </Link>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {alert.tipo.replace(/_/g, " ")}
                        </Badge>
                        {alert.fecha_limite && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Límite: {alert.fecha_limite}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 text-sm">
                        {estadoIcons[alert.estado]}
                        <span className="capitalize">{alert.estado}</span>
                      </span>
                      {client && (
                        <Link href={`/dashboard/client/${client.id}`}>
                          <Button variant="ghost" size="sm">
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
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
