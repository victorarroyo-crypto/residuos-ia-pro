"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  TrendingDown,
  Search,
  Filter,
  Euro,
  Lightbulb,
  ArrowRight,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import type { SavingsOpportunity, Client } from "@/types/database";

const estadoColors: Record<string, "secondary" | "default" | "success" | "outline"> = {
  detectada: "secondary",
  propuesta: "default",
  aceptada: "success",
  implementada: "success",
  descartada: "outline",
};

type FilterTipo = "todos" | string;
type FilterEstado = "todos" | "detectada" | "propuesta" | "aceptada" | "implementada" | "descartada";

export default function SavingsPage() {
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState<FilterTipo>("todos");
  const [filterEstado, setFilterEstado] = useState<FilterEstado>("todos");
  const [savings, setSavings] = useState<SavingsOpportunity[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("savings_opportunities").select("*"),
      supabase.from("projects").select("id, nombre"),
    ]).then(([savingsRes, clientsRes]) => {
      setSavings(savingsRes.data ?? []);
      setClients(clientsRes.data as Client[] ?? []);
      setLoading(false);
    });
  }, []);

  const tipos = Array.from(new Set(savings.map((s) => s.tipo)));

  const filtered = savings.filter((s) => {
    const client = clients.find((c) => c.id === s.project_id);
    const matchSearch =
      search === "" ||
      s.descripcion.toLowerCase().includes(search.toLowerCase()) ||
      client?.nombre.toLowerCase().includes(search.toLowerCase());
    const matchTipo = filterTipo === "todos" || s.tipo === filterTipo;
    const matchEstado = filterEstado === "todos" || s.estado === filterEstado;
    return matchSearch && matchTipo && matchEstado;
  });

  const totalSavings = savings.reduce(
    (sum, s) => sum + (s.ahorro_estimado_eur_año ?? 0),
    0
  );
  const iaCount = savings.filter((s) => s.ia_generada).length;
  const totalInversion = savings.reduce(
    (sum, s) => sum + (s.inversion_necesaria ?? 0),
    0
  );

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
        <h1 className="text-3xl font-bold tracking-tight">Ahorros</h1>
        <p className="text-muted-foreground">
          Oportunidades de ahorro y optimizacion detectadas en tu cartera.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ahorro total potencial</CardTitle>
            <Euro className="h-4 w-4 text-vandarum-green" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-vandarum-green">
              {totalSavings.toLocaleString("es-ES")} EUR/a
            </div>
            <p className="text-xs text-muted-foreground">
              Suma de todas las oportunidades
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Oportunidades</CardTitle>
            <Lightbulb className="h-4 w-4 text-vandarum-orange" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{savings.length}</div>
            <p className="text-xs text-muted-foreground">
              {filtered.length} con filtros actuales
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Generadas por IA</CardTitle>
            <Sparkles className="h-4 w-4 text-vandarum-blue" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{iaCount}</div>
            <p className="text-xs text-muted-foreground">
              de {savings.length} totales
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inversion necesaria</CardTitle>
            <TrendingDown className="h-4 w-4 text-vandarum-teal" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalInversion.toLocaleString("es-ES")} EUR
            </div>
            <p className="text-xs text-muted-foreground">
              Para implementar todo
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
                placeholder="Buscar por descripcion o cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={filterTipo}
                onChange={(e) => setFilterTipo(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Todo tipo</option>
                {tipos.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <select
                value={filterEstado}
                onChange={(e) => setFilterEstado(e.target.value as FilterEstado)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Todo estado</option>
                <option value="detectada">Detectada</option>
                <option value="propuesta">Propuesta</option>
                <option value="aceptada">Aceptada</option>
                <option value="implementada">Implementada</option>
                <option value="descartada">Descartada</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Savings list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingDown className="h-5 w-5 text-vandarum-green" />
            {filtered.length} oportunidad{filtered.length !== 1 ? "es" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {savings.length === 0
                ? "No hay oportunidades de ahorro detectadas aun."
                : "No se encontraron oportunidades con esos filtros."}
            </p>
          ) : (
            <div className="space-y-4">
              {filtered.map((opp) => {
                const client = clients.find((c) => c.id === opp.project_id);
                return (
                  <div
                    key={opp.id}
                    className="flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-secondary"
                  >
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="capitalize">
                          {opp.tipo.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant={estadoColors[opp.estado]} className="capitalize">
                          {opp.estado}
                        </Badge>
                        <Badge variant={opp.ia_generada ? "default" : "secondary"}>
                          {opp.ia_generada ? "IA" : "Manual"}
                        </Badge>
                      </div>
                      <p className="text-sm">{opp.descripcion}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {client && (
                          <Link
                            href={`/dashboard/client/${client.id}`}
                            className="hover:underline"
                          >
                            {client.nombre}
                          </Link>
                        )}
                        {opp.norma_aplicable && (
                          <span>Base legal: {opp.norma_aplicable}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <p className="text-lg font-bold text-vandarum-green">
                        {opp.ahorro_estimado_eur_año?.toLocaleString("es-ES")} EUR/a
                      </p>
                      {opp.inversion_necesaria !== null && opp.inversion_necesaria > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Inversion: {opp.inversion_necesaria.toLocaleString("es-ES")} EUR
                        </p>
                      )}
                      {opp.payback_meses !== null && opp.payback_meses > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Payback: {opp.payback_meses} meses
                        </p>
                      )}
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
