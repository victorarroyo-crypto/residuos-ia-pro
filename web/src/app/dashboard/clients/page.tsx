"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Users,
  ArrowRight,
  MapPin,
  Search,
  Filter,
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
import {
  mockClients,
  getClientComplianceStatus,
  getClientAlertCount,
  getClientDocCount,
} from "@/lib/mock-data";

function ComplianceDot({ status }: { status: "ok" | "warning" | "danger" }) {
  const colors = {
    ok: "bg-green-500",
    warning: "bg-yellow-500",
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
type FilterEstado = "todos" | "activo" | "inactivo";

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [filterRelacion, setFilterRelacion] = useState<FilterRelacion>("todos");
  const [filterEstado, setFilterEstado] = useState<FilterEstado>("todos");

  const filtered = mockClients.filter((c) => {
    const matchSearch =
      search === "" ||
      c.nombre.toLowerCase().includes(search.toLowerCase()) ||
      c.sector?.toLowerCase().includes(search.toLowerCase()) ||
      c.comunidad?.toLowerCase().includes(search.toLowerCase());
    const matchRelacion =
      filterRelacion === "todos" || c.tipo_relacion === filterRelacion;
    const matchEstado =
      filterEstado === "todos" ||
      (filterEstado === "activo" && c.activo) ||
      (filterEstado === "inactivo" && !c.activo);
    return matchSearch && matchRelacion && matchEstado;
  });

  const activeCount = mockClients.filter((c) => c.activo).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
        <p className="text-muted-foreground">
          Gestiona tu cartera de clientes. {activeCount} activos de{" "}
          {mockClients.length} totales.
        </p>
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
                className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={filterRelacion}
                onChange={(e) => setFilterRelacion(e.target.value as FilterRelacion)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Toda relación</option>
                <option value="retainer">Retainer</option>
                <option value="auditoria">Auditoría</option>
                <option value="diagnostico">Diagnóstico</option>
              </select>
              <select
                value={filterEstado}
                onChange={(e) => setFilterEstado(e.target.value as FilterEstado)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Todos</option>
                <option value="activo">Activos</option>
                <option value="inactivo">Inactivos</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Client list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            {filtered.length} cliente{filtered.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No se encontraron clientes con esos filtros.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cumplimiento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CNAE</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Relación</TableHead>
                  <TableHead className="text-center">Alertas</TableHead>
                  <TableHead className="text-center">Docs</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((client) => {
                  const status = getClientComplianceStatus(client.id);
                  const alertCount = getClientAlertCount(client.id);
                  const docCount = getClientDocCount(client.id);
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
                      <TableCell className="font-mono text-sm">
                        {client.cnae}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        {client.sector}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {client.municipio}, {client.comunidad}
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
