"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  FileText,
  AlertTriangle,
  TrendingDown,
  Package,
  Calendar,
  MapPin,
  Building2,
  ShieldCheck,
  Loader2,
  Pencil,
  X,
  Check,
  CheckCircle2,
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
import type {
  Project,
  WasteInventoryItem,
  ClientDocument,
  ComplianceAlert,
  SavingsOpportunity,
} from "@/types/database";

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

const severityColors: Record<string, "danger" | "warning" | "secondary" | "destructive"> = {
  critica: "destructive",
  alta: "danger",
  media: "warning",
  baja: "secondary",
};

function ComplianceDot({ status }: { status: "ok" | "warning" | "danger" }) {
  const colors = {
    ok: "bg-vandarum-green",
    warning: "bg-vandarum-orange",
    danger: "bg-red-500",
  };
  const labels = { ok: "Cumplimiento OK", warning: "Revisar", danger: "Alerta" };
  return (
    <span className="flex items-center gap-2">
      <span className={`inline-block h-3 w-3 rounded-full ${colors[status]}`} />
      <span className="text-sm">{labels[status]}</span>
    </span>
  );
}

const inputClass =
  "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20";

export default function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [client, setClient] = useState<Project | null>(null);
  const [inventory, setInventory] = useState<WasteInventoryItem[]>([]);
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [savings, setSavings] = useState<SavingsOpportunity[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const [clientRes, inventoryRes, docsRes, alertsRes, savingsRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id).single(),
      supabase.from("waste_inventory").select("*").eq("project_id", id),
      supabase.from("client_documents").select("*").eq("project_id", id).order("fecha_ingesta", { ascending: false }),
      supabase.from("compliance_alerts").select("*").eq("project_id", id),
      supabase.from("savings_opportunities").select("*").eq("project_id", id),
    ]);
    setClient(clientRes.data);
    setInventory(inventoryRes.data ?? []);
    setDocuments(docsRes.data ?? []);
    setAlerts(alertsRes.data ?? []);
    setSavings(savingsRes.data ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function startEditing() {
    if (!client) return;
    setEditForm({
      nombre: client.nombre,
      cif: client.cif,
      cnae: client.cnae,
      sector: client.sector,
      direccion: client.direccion,
      comunidad_autonoma: client.comunidad_autonoma,
      municipio: client.municipio,
      contacto_nombre: client.contacto_nombre,
      contacto_email: client.contacto_email,
      contacto_telefono: client.contacto_telefono,
      notas: client.notas,
      tipo_relacion: client.tipo_relacion,
    });
    setEditing(true);
    setSaveError(null);
  }

  async function handleSave() {
    if (!client) return;
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .update({
        nombre: editForm.nombre,
        cif: editForm.cif || null,
        cnae: editForm.cnae || null,
        sector: editForm.sector || null,
        direccion: editForm.direccion || null,
        comunidad_autonoma: editForm.comunidad_autonoma || null,
        municipio: editForm.municipio || null,
        contacto_nombre: editForm.contacto_nombre || null,
        contacto_email: editForm.contacto_email || null,
        contacto_telefono: editForm.contacto_telefono || null,
        notas: editForm.notas || null,
        tipo_relacion: editForm.tipo_relacion || null,
      })
      .eq("id", client.id);

    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setClient({ ...client, ...editForm } as Client);
    setEditing(false);
  }

  async function resolveAlert(alertId: string) {
    const supabase = createClient();
    await supabase
      .from("compliance_alerts")
      .update({ estado: "resuelta" })
      .eq("id", alertId);
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, estado: "resuelta" as const } : a))
    );
  }

  async function dismissAlert(alertId: string) {
    const supabase = createClient();
    await supabase
      .from("compliance_alerts")
      .update({ estado: "descartada" })
      .eq("id", alertId);
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, estado: "descartada" as const } : a))
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-vandarum-teal" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg text-muted-foreground">Cliente no encontrado</p>
        <Link href="/dashboard/clients" className="mt-4 text-vandarum-teal hover:underline">
          Volver a clientes
        </Link>
      </div>
    );
  }

  const pendingAlerts = alerts.filter((a) => a.estado === "pendiente");
  const complianceStatus: "ok" | "warning" | "danger" = pendingAlerts.some(
    (a) => a.severidad === "critica"
  )
    ? "danger"
    : pendingAlerts.length > 0
    ? "warning"
    : "ok";

  const totalWasteCost = inventory.reduce(
    (sum, w) =>
      sum + (w.cantidad_anual_ton ?? 0) * (w.precio_actual_eur_ton ?? 0),
    0
  );
  const totalSavings = savings.reduce(
    (sum, s) => sum + (s.ahorro_estimado_eur_año ?? 0),
    0
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link
            href="/dashboard/clients"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Clientes
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{client.nombre}</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {client.cif && (
              <span className="font-mono">{client.cif}</span>
            )}
            {client.cnae && (
              <span className="flex items-center gap-1">
                <Building2 className="h-4 w-4" /> CNAE {client.cnae}
              </span>
            )}
            {(client.municipio || client.comunidad_autonoma) && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {[client.municipio, client.comunidad_autonoma].filter(Boolean).join(", ")}
              </span>
            )}
            {client.tipo_relacion && (
              <Badge variant="outline" className="capitalize">
                {client.tipo_relacion}
              </Badge>
            )}
            <ComplianceDot status={complianceStatus} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={startEditing}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Link href={`/dashboard/client/${id}/upload`}>
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              Subir documentos
            </Button>
          </Link>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <Card className="border-vandarum-teal/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Pencil className="h-5 w-5 text-vandarum-teal" />
                Editar cliente
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Nombre *</label>
                <input
                  value={editForm.nombre ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, nombre: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium">CIF/NIF</label>
                <input
                  value={editForm.cif ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, cif: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">CNAE</label>
                <input
                  value={editForm.cnae ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, cnae: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Sector</label>
                <input
                  value={editForm.sector ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, sector: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Direccion</label>
              <input
                value={editForm.direccion ?? ""}
                onChange={(e) => setEditForm({ ...editForm, direccion: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Comunidad Autonoma</label>
                <input
                  value={editForm.comunidad_autonoma ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, comunidad_autonoma: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Municipio</label>
                <input
                  value={editForm.municipio ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, municipio: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Tipo de relacion</label>
              <select
                value={editForm.tipo_relacion ?? "retainer"}
                onChange={(e) => setEditForm({ ...editForm, tipo_relacion: e.target.value as Client["tipo_relacion"] })}
                className={inputClass}
              >
                <option value="retainer">Retainer (seguimiento continuo)</option>
                <option value="auditoria">Auditoria (puntual)</option>
                <option value="diagnostico">Diagnostico inicial</option>
              </select>
            </div>

            <hr />
            <p className="text-sm font-medium text-muted-foreground">Persona de contacto</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="text-sm font-medium">Nombre</label>
                <input
                  value={editForm.contacto_nombre ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, contacto_nombre: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={editForm.contacto_email ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, contacto_email: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Telefono</label>
                <input
                  type="tel"
                  value={editForm.contacto_telefono ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, contacto_telefono: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Notas</label>
              <textarea
                rows={3}
                value={editForm.notas ?? ""}
                onChange={(e) => setEditForm({ ...editForm, notas: e.target.value })}
                className={inputClass}
              />
            </div>

            {saveError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {saveError}
              </p>
            )}

            <div className="flex gap-3">
              <Button onClick={handleSave} disabled={saving || !editForm.nombre}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Guardar cambios
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contact info card (only when not editing) */}
      {!editing && (client.contacto_nombre || client.contacto_email || client.contacto_telefono || client.notas) && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-6 text-sm">
              {client.contacto_nombre && (
                <div>
                  <p className="text-muted-foreground">Contacto</p>
                  <p className="font-medium">{client.contacto_nombre}</p>
                </div>
              )}
              {client.contacto_email && (
                <div>
                  <p className="text-muted-foreground">Email</p>
                  <p className="font-medium">{client.contacto_email}</p>
                </div>
              )}
              {client.contacto_telefono && (
                <div>
                  <p className="text-muted-foreground">Telefono</p>
                  <p className="font-medium">{client.contacto_telefono}</p>
                </div>
              )}
              {client.direccion && (
                <div>
                  <p className="text-muted-foreground">Direccion</p>
                  <p className="font-medium">{client.direccion}</p>
                </div>
              )}
              {client.notas && (
                <div className="basis-full">
                  <p className="text-muted-foreground">Notas</p>
                  <p className="font-medium">{client.notas}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-t-2 border-t-vandarum-teal">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Residuos registrados</CardTitle>
            <Package className="h-4 w-4 text-vandarum-teal" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inventory.length}</div>
            <p className="text-xs text-muted-foreground">
              {inventory.filter((w) => w.peligroso).length} peligrosos
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-vandarum-blue">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Coste anual gestion</CardTitle>
            <Calendar className="h-4 w-4 text-vandarum-blue" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalWasteCost.toLocaleString("es-ES", {
                maximumFractionDigits: 0,
              })}{" "}
              EUR
            </div>
            <p className="text-xs text-muted-foreground">
              Basado en inventario actual
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-vandarum-orange">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertas</CardTitle>
            <AlertTriangle className="h-4 w-4 text-vandarum-orange" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingAlerts.length}</div>
            <p className="text-xs text-muted-foreground">pendientes</p>
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
              {savings.length} oportunidades
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Waste Inventory */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="h-5 w-5 text-vandarum-teal" />
            Inventario de residuos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inventory.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              Sin datos de inventario. Sube un Excel de costes o inventario LER.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Codigo LER</TableHead>
                  <TableHead>Descripcion</TableHead>
                  <TableHead>Peligroso</TableHead>
                  <TableHead className="text-right">t/ano</TableHead>
                  <TableHead className="text-right">EUR/t</TableHead>
                  <TableHead>Operacion</TableHead>
                  <TableHead>Gestor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">
                      {item.codigo_ler}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {item.descripcion}
                    </TableCell>
                    <TableCell>
                      {item.peligroso ? (
                        <Badge variant="danger">Si</Badge>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.cantidad_anual_ton?.toLocaleString("es-ES")}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.precio_actual_eur_ton?.toLocaleString("es-ES")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.operacion}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate text-sm text-muted-foreground">
                      {item.gestor_actual}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-vandarum-blue" />
            Documentos ({documents.length})
          </CardTitle>
          <Link href={`/dashboard/client/${id}/upload`}>
            <Button variant="outline" size="sm">
              <Upload className="mr-2 h-3 w-3" />
              Subir
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              Sin documentos indexados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Titulo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Formato</TableHead>
                  <TableHead className="text-right">Paginas</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead>Fecha doc</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="max-w-[250px] truncate font-medium">
                      {doc.titulo}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {doc.tipo ? docTypeLabels[doc.tipo] ?? doc.tipo : "\u2014"}
                      </Badge>
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
                    <TableCell className="text-sm text-muted-foreground">
                      {doc.naturaleza_pdf}
                    </TableCell>
                    <TableCell className="text-right">
                      {doc.total_paginas ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {doc.total_chunks ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {doc.fecha_documento ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Alerts with actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-vandarum-orange" />
            Alertas de cumplimiento
            {pendingAlerts.length > 0 && (
              <Badge variant="danger" className="ml-2">{pendingAlerts.length} pendientes</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              Sin alertas. Se generan automaticamente al procesar documentos.
            </p>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 rounded-md border p-3 ${
                    alert.estado === "resuelta" || alert.estado === "descartada"
                      ? "opacity-60"
                      : ""
                  }`}
                >
                  <Badge variant={severityColors[alert.severidad]}>
                    {alert.severidad}
                  </Badge>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{alert.descripcion}</p>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                      {alert.fecha_limite && (
                        <span>Fecha limite: {alert.fecha_limite}</span>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {alert.tipo.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {alert.estado === "pendiente" ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resolveAlert(alert.id)}
                        >
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Resolver
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => dismissAlert(alert.id)}
                        >
                          <X className="mr-1 h-3 w-3" />
                          Descartar
                        </Button>
                      </>
                    ) : (
                      <Badge variant="outline" className="capitalize">
                        {alert.estado}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Savings Opportunities */}
      {savings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-vandarum-green" />
              Oportunidades de ahorro
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {savings.map((opp) => (
                <div
                  key={opp.id}
                  className="flex items-start gap-4 rounded-md border p-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {opp.tipo.replace(/_/g, " ")}
                      </Badge>
                      <Badge variant={opp.ia_generada ? "default" : "secondary"}>
                        {opp.ia_generada ? "IA" : "Manual"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm">{opp.descripcion}</p>
                    {opp.norma_aplicable && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Base legal: {opp.norma_aplicable}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-vandarum-green">
                      {opp.ahorro_estimado_eur_año?.toLocaleString("es-ES")} EUR/a
                    </p>
                    {opp.payback_meses !== null && opp.payback_meses > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Payback: {opp.payback_meses} meses
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
