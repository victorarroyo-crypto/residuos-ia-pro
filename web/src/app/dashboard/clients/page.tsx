"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Users,
  ArrowRight,
  MapPin,
  Search,
  Filter,
  Plus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { createClient } from "@/lib/supabase/client";
import type { Project, ComplianceAlert, ProjectDocument } from "@/types/database";

function ComplianceDot({ status }: { status: "ok" | "warning" | "danger" }) {
  const colors = {
    ok: "bg-vandarum-green",
    warning: "bg-vandarum-orange",
    danger: "bg-red-500",
  };
  const labels = { ok: "OK", warning: "Revisar", danger: "Alerta" };
  return (
    <span className="flex items-center gap-2">
      <span className={`inline-block h-3 w-3 rounded-full ${colors[status]}`} />
      <span className="text-sm">{labels[status]}</span>
    </span>
  );
}

type FilterRelacion = "todos" | "retainer" | "auditoria" | "diagnostico";

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [filterRelacion, setFilterRelacion] = useState<FilterRelacion>("todos");
  const [clients, setClients] = useState<Project[]>([]);
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("projects").select("*").order("nombre"),
      supabase.from("compliance_alerts").select("*").eq("estado", "pendiente"),
      supabase.from("project_documents").select("id, project_id"),
    ]).then(([clientsRes, alertsRes, docsRes]) => {
      setClients(clientsRes.data ?? []);
      setAlerts(alertsRes.data ?? []);
      setDocuments(docsRes.data as ProjectDocument[] ?? []);
      setLoading(false);
    });
  }, []);

  function getComplianceStatus(clientId: string): "ok" | "warning" | "danger" {
    const clientAlerts = alerts.filter((a) => a.project_id === clientId);
    if (clientAlerts.some((a) => a.severidad === "critica")) return "danger";
    if (clientAlerts.length > 0) return "warning";
    return "ok";
  }

  const filtered = clients.filter((c) => {
    const matchSearch =
      search === "" ||
      c.nombre.toLowerCase().includes(search.toLowerCase()) ||
      c.sector?.toLowerCase().includes(search.toLowerCase()) ||
      c.comunidad_autonoma?.toLowerCase().includes(search.toLowerCase());
    const matchRelacion =
      filterRelacion === "todos" || c.tipo_relacion === filterRelacion;
    return matchSearch && matchRelacion;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-vandarum-teal" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">
            Gestiona tu cartera de clientes. {clients.length} en total.
          </p>
        </div>
        <Link href="/dashboard/clients/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo cliente
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por nombre, sector o CCAA..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={filterRelacion}
                onChange={(e) => setFilterRelacion(e.target.value as FilterRelacion)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Toda relacion</option>
                <option value="retainer">Retainer</option>
                <option value="auditoria">Auditoria</option>
                <option value="diagnostico">Diagnostico</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Client list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-vandarum-teal" />
            {filtered.length} cliente{filtered.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {clients.length === 0
                ? "No hay clientes registrados. Crea tu primer cliente."
                : "No se encontraron clientes con esos filtros."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cumplimiento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CNAE</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Ubicacion</TableHead>
                  <TableHead>Relacion</TableHead>
                  <TableHead className="text-center">Alertas</TableHead>
                  <TableHead className="text-center">Docs</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((client) => {
                  const status = getComplianceStatus(client.id);
                  const alertCount = alerts.filter((a) => a.project_id === client.id).length;
                  const docCount = documents.filter((d) => d.project_id === client.id).length;
                  return (
                    <TableRow key={client.id}>
                      <TableCell>
                        <ComplianceDot status={status} />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          href={`/dashboard/client/${client.id}`}
                          className="text-vandarum-teal hover:underline"
                        >
                          {client.nombre}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {client.cnae}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        {client.sector}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {client.municipio}, {client.comunidad_autonoma}
                        </span>
                      </TableCell>
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
                      <TableCell className="text-center">
                        {docCount > 0 ? (
                          <Badge variant="secondary">{docCount}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link href={`/dashboard/client/${client.id}`}>
                          <Button variant="ghost" size="sm">
                            <ArrowRight className="h-4 w-4" />
                          </Button>
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
    </div>
  );
}
