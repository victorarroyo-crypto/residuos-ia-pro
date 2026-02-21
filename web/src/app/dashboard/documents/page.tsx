"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FileText,
  Search,
  Filter,
  Eye,
  Calendar,
  ArrowRight,
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
import { mockDocuments, mockClients } from "@/lib/mock-data";

const docTypeLabels: Record<string, string> = {
  autorizacion_ambiental_integrada: "AAI",
  declaracion_anual_residuos: "DARI",
  contrato_gestor: "Contrato",
  factura: "Factura",
  registro_produccion: "Registro",
  permiso_ambiental: "Permiso",
  manual_interno: "Manual",
  normativa: "Normativa",
  costes_anuales: "Costes",
  inventario_ler: "Inventario",
  comparativa_gestores: "Comparativa",
  facturas_agregadas: "Fact. agregadas",
  presupuesto: "Presupuesto",
};

type FilterEstado = "todos" | "indexado" | "procesando" | "error" | "pendiente";
type FilterNaturaleza = "todos" | "digital" | "scanned" | "hybrid" | "excel";

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [filterEstado, setFilterEstado] = useState<FilterEstado>("todos");
  const [filterNaturaleza, setFilterNaturaleza] = useState<FilterNaturaleza>("todos");

  const filtered = mockDocuments.filter((d) => {
    const matchSearch =
      search === "" ||
      d.titulo?.toLowerCase().includes(search.toLowerCase()) ||
      mockClients
        .find((c) => c.id === d.client_id)
        ?.nombre.toLowerCase()
        .includes(search.toLowerCase());
    const matchEstado =
      filterEstado === "todos" || d.estado === filterEstado;
    const matchNaturaleza =
      filterNaturaleza === "todos" || d.naturaleza_pdf === filterNaturaleza;
    return matchSearch && matchEstado && matchNaturaleza;
  });

  const indexedCount = mockDocuments.filter((d) => d.estado === "indexado").length;
  const totalChunks = mockDocuments.reduce((sum, d) => sum + (d.total_chunks ?? 0), 0);
  const totalPages = mockDocuments.reduce((sum, d) => sum + (d.total_paginas ?? 0), 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Documentos</h1>
        <p className="text-muted-foreground">
          Todos los documentos indexados en la plataforma.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total documentos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockDocuments.length}</div>
            <p className="text-xs text-muted-foreground">
              {indexedCount} indexados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Páginas procesadas</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalPages}</div>
            <p className="text-xs text-muted-foreground">
              {mockDocuments.filter((d) => d.ocr_aplicado).length} con OCR
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Chunks generados</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalChunks}</div>
            <p className="text-xs text-muted-foreground">
              Disponibles para RAG
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tablas extraídas</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mockDocuments.reduce((sum, d) => sum + (d.tablas_encontradas ?? 0), 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              En todos los documentos
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
                placeholder="Buscar por título o cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={filterEstado}
                onChange={(e) => setFilterEstado(e.target.value as FilterEstado)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Todo estado</option>
                <option value="indexado">Indexado</option>
                <option value="procesando">Procesando</option>
                <option value="error">Error</option>
                <option value="pendiente">Pendiente</option>
              </select>
              <select
                value={filterNaturaleza}
                onChange={(e) => setFilterNaturaleza(e.target.value as FilterNaturaleza)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Todo formato</option>
                <option value="digital">Digital</option>
                <option value="scanned">Escaneado</option>
                <option value="hybrid">Híbrido</option>
                <option value="excel">Excel</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            {filtered.length} documento{filtered.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No se encontraron documentos con esos filtros.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Formato</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Págs</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead>Fecha doc</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((doc) => {
                  const client = mockClients.find((c) => c.id === doc.client_id);
                  return (
                    <TableRow key={doc.id}>
                      <TableCell className="max-w-[250px] truncate font-medium">
                        {doc.titulo}
                      </TableCell>
                      <TableCell>
                        {client ? (
                          <Link
                            href={`/dashboard/client/${client.id}`}
                            className="text-sm hover:underline"
                          >
                            {client.nombre}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {doc.tipo ? docTypeLabels[doc.tipo] ?? doc.tipo : "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {doc.naturaleza_pdf}
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell className="text-right">
                        {doc.total_paginas ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {doc.total_chunks ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {doc.fecha_documento ?? "—"}
                      </TableCell>
                      <TableCell>
                        {client && (
                          <Link href={`/dashboard/client/${client.id}`}>
                            <Button variant="ghost" size="sm">
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </Link>
                        )}
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
