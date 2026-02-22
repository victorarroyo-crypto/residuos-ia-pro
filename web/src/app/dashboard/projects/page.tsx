"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  FolderKanban,
  ArrowRight,
  MapPin,
  Search,
  Filter,
  Plus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [filterRelacion, setFilterRelacion] = useState<FilterRelacion>("todos");
  const [projects, setProjects] = useState<Project[]>([]);
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("projects").select("*").order("nombre"),
      supabase.from("compliance_alerts").select("*").eq("estado", "pendiente"),
      supabase.from("project_documents").select("id, project_id"),
    ]).then(([projectsRes, alertsRes, docsRes]) => {
      setProjects(projectsRes.data ?? []);
      setAlerts(alertsRes.data ?? []);
      setDocuments(docsRes.data as ProjectDocument[] ?? []);
      setLoading(false);
    });
  }, []);

  function getComplianceStatus(projectId: string): "ok" | "warning" | "danger" {
    const projectAlerts = alerts.filter((a) => a.project_id === projectId);
    if (projectAlerts.some((a) => a.severidad === "critica")) return "danger";
    if (projectAlerts.length > 0) return "warning";
    return "ok";
  }

  const filtered = projects.filter((p) => {
    const matchSearch =
      search === "" ||
      p.nombre.toLowerCase().includes(search.toLowerCase()) ||
      p.sector?.toLowerCase().includes(search.toLowerCase()) ||
      p.comunidad_autonoma?.toLowerCase().includes(search.toLowerCase()) ||
      p.cif?.toLowerCase().includes(search.toLowerCase());
    const matchRelacion =
      filterRelacion === "todos" || p.tipo_relacion === filterRelacion;
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Proyectos</h1>
          <p className="text-muted-foreground">
            {projects.length} proyecto{projects.length !== 1 ? "s" : ""} en cartera
          </p>
        </div>
        <Link href="/dashboard/projects/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo proyecto
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nombre, CIF, sector o CCAA..."
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

      {/* Project list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderKanban className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">
              {projects.length === 0
                ? "No hay proyectos. Crea tu primer proyecto."
                : "No se encontraron proyectos con esos filtros."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Estado</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>CIF</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Ubicacion</TableHead>
                <TableHead>Relacion</TableHead>
                <TableHead className="text-center">Alertas</TableHead>
                <TableHead className="text-center">Docs</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((project) => {
                const status = getComplianceStatus(project.id);
                const alertCount = alerts.filter((a) => a.project_id === project.id).length;
                const docCount = documents.filter((d) => d.project_id === project.id).length;
                return (
                  <TableRow key={project.id}>
                    <TableCell>
                      <ComplianceDot status={status} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/projects/${project.id}`}
                        className="text-vandarum-teal hover:underline"
                      >
                        {project.nombre}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {project.cif || "—"}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                      {project.sector || "—"}
                    </TableCell>
                    <TableCell>
                      {(project.municipio || project.comunidad_autonoma) ? (
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {[project.municipio, project.comunidad_autonoma].filter(Boolean).join(", ")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {project.tipo_relacion ? (
                        <Badge variant="outline" className="capitalize">
                          {project.tipo_relacion}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
                      <Link href={`/dashboard/projects/${project.id}`}>
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
        </Card>
      )}
    </div>
  );
}
