"use client";

import { useState, useEffect } from "react";
import {
  FileText,
  Search,
  Filter,
  Eye,
  Calendar,
  Loader2,
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
import { createClient } from "@/lib/supabase/client";
import type { KnowledgeDocument } from "@/types/database";

const knowledgeTypeLabels: Record<string, string> = {
  legislacion: "Legislación",
  documentacion_tecnica: "Doc. Técnica",
  gestores_residuos: "Gestores",
  clasificacion_residuos: "Clasificación",
  gestion_operativa: "Gestión Operativa",
  referencia: "Referencia",
  desconocido: "Sin clasificar",
};

type FilterEstado = "todos" | "indexado" | "procesando" | "error" | "pendiente";
type FilterNaturaleza = "todos" | "digital" | "scanned" | "hybrid" | "excel";
type FilterTipo = "todos" | "legislacion" | "documentacion_tecnica" | "gestores_residuos" | "clasificacion_residuos" | "gestion_operativa" | "referencia" | "desconocido";

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [filterEstado, setFilterEstado] = useState<FilterEstado>("todos");
  const [filterNaturaleza, setFilterNaturaleza] = useState<FilterNaturaleza>("todos");
  const [filterTipo, setFilterTipo] = useState<FilterTipo>("todos");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("knowledge_documents")
      .select("*")
      .order("fecha_ingesta", { ascending: false })
      .then((docsRes) => {
        setDocuments(docsRes.data ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = documents.filter((d) => {
    const matchSearch =
      search === "" ||
      d.titulo?.toLowerCase().includes(search.toLowerCase());
    const matchEstado =
      filterEstado === "todos" || d.estado === filterEstado;
    const matchNaturaleza =
      filterNaturaleza === "todos" || d.naturaleza_pdf === filterNaturaleza;
    const matchTipo =
      filterTipo === "todos" || d.tipo === filterTipo;
    return matchSearch && matchEstado && matchNaturaleza && matchTipo;
  });

  const indexedCount = documents.filter((d) => d.estado === "indexado").length;
  const totalChunks = documents.reduce((sum, d) => sum + (d.total_chunks ?? 0), 0);
  const totalPages = documents.reduce((sum, d) => sum + (d.total_paginas ?? 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-vandarum-teal" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Base de Conocimiento</h1>
        <p className="text-muted-foreground">
          Documentos generales indexados desde Google Drive: legislacion, documentacion tecnica, gestores, clasificacion y referencia.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total documentos</CardTitle>
            <FileText className="h-4 w-4 text-vandarum-teal" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documents.length}</div>
            <p className="text-xs text-muted-foreground">
              {indexedCount} indexados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paginas procesadas</CardTitle>
            <Eye className="h-4 w-4 text-vandarum-blue" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalPages}</div>
            <p className="text-xs text-muted-foreground">
              {documents.filter((d) => d.ocr_aplicado).length} con OCR
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Chunks generados</CardTitle>
            <FileText className="h-4 w-4 text-vandarum-green" />
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
            <CardTitle className="text-sm font-medium">Tablas extraidas</CardTitle>
            <Calendar className="h-4 w-4 text-vandarum-orange" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {documents.reduce((sum, d) => sum + (d.tablas_encontradas ?? 0), 0)}
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
                placeholder="Buscar por titulo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
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
                value={filterTipo}
                onChange={(e) => setFilterTipo(e.target.value as FilterTipo)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Toda categoria</option>
                <option value="legislacion">Legislacion</option>
                <option value="documentacion_tecnica">Doc. Tecnica</option>
                <option value="gestores_residuos">Gestores</option>
                <option value="clasificacion_residuos">Clasificacion</option>
                <option value="gestion_operativa">Gestion Operativa</option>
                <option value="referencia">Referencia</option>
                <option value="desconocido">Sin clasificar</option>
              </select>
              <select
                value={filterNaturaleza}
                onChange={(e) => setFilterNaturaleza(e.target.value as FilterNaturaleza)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Todo formato</option>
                <option value="digital">Digital</option>
                <option value="scanned">Escaneado</option>
                <option value="hybrid">Hibrido</option>
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
            <FileText className="h-5 w-5 text-vandarum-blue" />
            {filtered.length} documento{filtered.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {documents.length === 0
                ? "No hay documentos en la base de conocimiento. Sincroniza Google Drive para indexar documentos."
                : "No se encontraron documentos con esos filtros."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Titulo</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Formato</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Pags</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead>Fecha doc</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="max-w-[250px] truncate font-medium">
                        {doc.titulo}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {doc.tipo ? knowledgeTypeLabels[doc.tipo] ?? doc.tipo : "—"}
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
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
