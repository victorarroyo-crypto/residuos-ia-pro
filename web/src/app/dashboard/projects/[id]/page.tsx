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
  Loader2,
  Pencil,
  X,
  Check,
  CheckCircle2,
  LayoutList,
  FileSignature,
  Sparkles,
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
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type {
  Project,
  WasteInventoryItem,
  ProjectDocument,
  ComplianceAlert,
  SavingsOpportunity,
  Contract,
  WasteManager,
} from "@/types/database";

// ─── Constants ────────────────────────────────────────────────────────

const projectDocTypeLabels: Record<string, string> = {
  autorizacion_ambiental_integrada: "AAI",
  declaracion_anual_residuos: "DARI",
  contrato_gestor: "Contrato",
  factura: "Factura",
  registro_produccion: "Registro",
  permiso_ambiental: "Permiso",
  manual_interno: "Manual",
  costes_anuales: "Costes",
  inventario_ler: "Inventario LER",
  comparativa_gestores: "Comparativa",
  facturas_agregadas: "Fact. agregadas",
  presupuesto: "Presupuesto",
  desconocido: "Sin clasificar",
};

const severityColors: Record<string, "danger" | "warning" | "secondary" | "destructive"> = {
  critica: "destructive",
  alta: "danger",
  media: "warning",
  baja: "secondary",
};

type TabId = "resumen" | "documentos" | "inventario" | "contratos" | "alertas" | "ahorros" | "analisis";

const tabs: { id: TabId; label: string; icon: typeof LayoutList }[] = [
  { id: "resumen", label: "Resumen", icon: LayoutList },
  { id: "documentos", label: "Documentos", icon: FileText },
  { id: "inventario", label: "Inventario", icon: Package },
  { id: "contratos", label: "Contratos", icon: FileSignature },
  { id: "alertas", label: "Alertas", icon: AlertTriangle },
  { id: "ahorros", label: "Ahorros", icon: TrendingDown },
  { id: "analisis", label: "Analisis IA", icon: Sparkles },
];

// ─── Analysis types ──────────────────────────────────────────────────

interface AnalysisFinding {
  tipo: string;
  descripcion: string;
  severidad: string;
  ahorro_eur_ano?: number;
  inversion_eur?: number;
  norma?: string;
  agente?: string;
  datos?: Record<string, unknown>;
}

interface AnalysisResult {
  report: string;
  findings: AnalysisFinding[];
  opportunities: AnalysisFinding[];
  errors: string[];
}

const inputClass =
  "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20";

// ─── Page Component ───────────────────────────────────────────────────

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<TabId>("resumen");
  const [project, setProject] = useState<Project | null>(null);
  const [inventory, setInventory] = useState<WasteInventoryItem[]>([]);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [savings, setSavings] = useState<SavingsOpportunity[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [managers, setManagers] = useState<WasteManager[]>([]);
  const [loading, setLoading] = useState(true);

  // Analysis state
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Project>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Document filter
  const [docTypeFilter, setDocTypeFilter] = useState("todos");

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const [projectRes, inventoryRes, docsRes, alertsRes, savingsRes, contractsRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id).single(),
      supabase.from("waste_inventory").select("*").eq("project_id", id),
      supabase.from("project_documents").select("*").eq("project_id", id).order("fecha_ingesta", { ascending: false }),
      supabase.from("compliance_alerts").select("*").eq("project_id", id),
      supabase.from("savings_opportunities").select("*").eq("project_id", id),
      supabase.from("contracts").select("*").eq("project_id", id),
    ]);
    setProject(projectRes.data);
    setInventory(inventoryRes.data ?? []);
    setDocuments(docsRes.data ?? []);
    setAlerts(alertsRes.data ?? []);
    setSavings(savingsRes.data ?? []);
    setContracts(contractsRes.data ?? []);

    // Load managers for contracts
    const managerIds = (contractsRes.data ?? [])
      .map((c: Contract) => c.manager_id)
      .filter(Boolean) as string[];
    if (managerIds.length > 0) {
      const { data: mgrs } = await supabase
        .from("waste_managers")
        .select("*")
        .in("id", managerIds);
      setManagers(mgrs ?? []);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Edit handlers ──────────────────────────────────────────────────

  function startEditing() {
    if (!project) return;
    setEditForm({
      nombre: project.nombre,
      cif: project.cif,
      cnae: project.cnae,
      sector: project.sector,
      direccion: project.direccion,
      comunidad_autonoma: project.comunidad_autonoma,
      municipio: project.municipio,
      contacto_nombre: project.contacto_nombre,
      contacto_email: project.contacto_email,
      contacto_telefono: project.contacto_telefono,
      notas: project.notas,
      tipo_relacion: project.tipo_relacion,
    });
    setEditing(true);
    setSaveError(null);
  }

  async function handleSave() {
    if (!project) return;
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
      .eq("id", project.id);

    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setProject({ ...project, ...editForm } as Project);
    setEditing(false);
  }

  // ─── Alert handlers ─────────────────────────────────────────────────

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

  // ─── Analysis handler ──────────────────────────────────────────────

  async function runAnalysis() {
    setAnalysisRunning(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setActiveTab("analisis");

    try {
      const response = await fetch("/api/analyze-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: id }),
      });

      const data = await response.json();

      if (!response.ok) {
        setAnalysisError(data.error || "Error en el analisis");
        return;
      }

      setAnalysisResult(data);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : "Error de conexion con el pipeline"
      );
    } finally {
      setAnalysisRunning(false);
    }
  }

  // ─── Loading / Not found ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-vandarum-teal" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg text-muted-foreground">Proyecto no encontrado</p>
        <Link href="/dashboard/projects" className="mt-4 text-vandarum-teal hover:underline">
          Volver a proyectos
        </Link>
      </div>
    );
  }

  // ─── Derived data ───────────────────────────────────────────────────

  const pendingAlerts = alerts.filter((a) => a.estado === "pendiente");
  const complianceStatus: "ok" | "warning" | "danger" = pendingAlerts.some(
    (a) => a.severidad === "critica"
  )
    ? "danger"
    : pendingAlerts.length > 0
    ? "warning"
    : "ok";

  const statusColors = {
    ok: "bg-vandarum-green",
    warning: "bg-vandarum-orange",
    danger: "bg-red-500",
  };
  const statusLabels = { ok: "Cumplimiento OK", warning: "Revisar", danger: "Alerta" };

  const totalWasteCost = inventory.reduce(
    (sum, w) => sum + (w.cantidad_anual_ton ?? 0) * (w.precio_actual_eur_ton ?? 0),
    0
  );
  const totalSavings = savings.reduce(
    (sum, s) => sum + (s.ahorro_estimado_eur_año ?? 0),
    0
  );

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link
            href="/dashboard/projects"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Proyectos
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{project.nombre}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {project.cif && <span className="font-mono">{project.cif}</span>}
            {project.cnae && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" /> CNAE {project.cnae}
              </span>
            )}
            {(project.municipio || project.comunidad_autonoma) && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {[project.municipio, project.comunidad_autonoma].filter(Boolean).join(", ")}
              </span>
            )}
            {project.tipo_relacion && (
              <Badge variant="outline" className="capitalize">
                {project.tipo_relacion}
              </Badge>
            )}
            <span className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusColors[complianceStatus]}`} />
              {statusLabels[complianceStatus]}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Editar
          </Button>
          <Link href={`/dashboard/projects/${id}/upload`}>
            <Button variant="outline" size="sm">
              <Upload className="mr-2 h-3.5 w-3.5" />
              Subir documentos
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={runAnalysis}
            disabled={analysisRunning}
            className="bg-gradient-brand text-white hover:opacity-90"
          >
            {analysisRunning ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-3.5 w-3.5" />
            )}
            {analysisRunning ? "Analizando..." : "Analisis IA"}
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => {
          const count =
            tab.id === "documentos" ? documents.length :
            tab.id === "inventario" ? inventory.length :
            tab.id === "contratos" ? contracts.length :
            tab.id === "alertas" ? pendingAlerts.length :
            tab.id === "ahorros" ? savings.length : 0;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "border-vandarum-teal text-vandarum-teal"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {count > 0 && tab.id !== "resumen" && (
                <Badge
                  variant={tab.id === "alertas" ? "danger" : "secondary"}
                  className="ml-1 text-xs px-1.5 py-0"
                >
                  {count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* ═══ Tab: Resumen ═══ */}
      {activeTab === "resumen" && (
        <div className="space-y-6">
          {/* Edit form */}
          {editing && (
            <Card className="border-vandarum-teal/30">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Pencil className="h-5 w-5 text-vandarum-teal" />
                    Editar proyecto
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
                    <label className="text-sm font-medium">CCAA</label>
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
                    onChange={(e) => setEditForm({ ...editForm, tipo_relacion: e.target.value as Project["tipo_relacion"] })}
                    className={inputClass}
                  >
                    <option value="retainer">Retainer</option>
                    <option value="auditoria">Auditoria</option>
                    <option value="diagnostico">Diagnostico</option>
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
                    Guardar
                  </Button>
                  <Button variant="outline" onClick={() => setEditing(false)}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Contact + notes (when not editing) */}
          {!editing && (project.contacto_nombre || project.contacto_email || project.notas) && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-6 text-sm">
                  {project.contacto_nombre && (
                    <div>
                      <p className="text-muted-foreground">Contacto</p>
                      <p className="font-medium">{project.contacto_nombre}</p>
                    </div>
                  )}
                  {project.contacto_email && (
                    <div>
                      <p className="text-muted-foreground">Email</p>
                      <p className="font-medium">{project.contacto_email}</p>
                    </div>
                  )}
                  {project.contacto_telefono && (
                    <div>
                      <p className="text-muted-foreground">Telefono</p>
                      <p className="font-medium">{project.contacto_telefono}</p>
                    </div>
                  )}
                  {project.direccion && (
                    <div>
                      <p className="text-muted-foreground">Direccion</p>
                      <p className="font-medium">{project.direccion}</p>
                    </div>
                  )}
                  {project.notas && (
                    <div className="basis-full">
                      <p className="text-muted-foreground">Notas</p>
                      <p className="font-medium">{project.notas}</p>
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
                <CardTitle className="text-sm font-medium">Residuos</CardTitle>
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
                <CardTitle className="text-sm font-medium">Coste anual</CardTitle>
                <Calendar className="h-4 w-4 text-vandarum-blue" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totalWasteCost.toLocaleString("es-ES", { maximumFractionDigits: 0 })} EUR
                </div>
                <p className="text-xs text-muted-foreground">gestion de residuos</p>
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

          {/* Quick summary cards */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Recent docs */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">Documentos recientes</CardTitle>
                <button
                  onClick={() => setActiveTab("documentos")}
                  className="text-xs text-vandarum-teal hover:underline"
                >
                  Ver todos
                </button>
              </CardHeader>
              <CardContent>
                {documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin documentos</p>
                ) : (
                  <div className="space-y-2">
                    {documents.slice(0, 4).map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between text-sm">
                        <span className="truncate max-w-[200px]">{doc.titulo}</span>
                        <Badge variant="outline" className="text-xs ml-2">
                          {doc.tipo ? projectDocTypeLabels[doc.tipo] ?? doc.tipo : "—"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pending alerts */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">Alertas pendientes</CardTitle>
                {pendingAlerts.length > 0 && (
                  <button
                    onClick={() => setActiveTab("alertas")}
                    className="text-xs text-vandarum-teal hover:underline"
                  >
                    Ver todas
                  </button>
                )}
              </CardHeader>
              <CardContent>
                {pendingAlerts.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-vandarum-green" />
                    Todo en orden
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingAlerts.slice(0, 4).map((alert) => (
                      <div key={alert.id} className="flex items-center gap-2 text-sm">
                        <Badge variant={severityColors[alert.severidad]} className="text-xs">
                          {alert.severidad}
                        </Badge>
                        <span className="truncate">{alert.descripcion}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ═══ Tab: Documentos ═══ */}
      {activeTab === "documentos" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <select
                value={docTypeFilter}
                onChange={(e) => setDocTypeFilter(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="todos">Todos los tipos</option>
                {Object.entries(projectDocTypeLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <span className="text-sm text-muted-foreground">
                {documents.filter((d) => docTypeFilter === "todos" || d.tipo === docTypeFilter).length} documentos
              </span>
            </div>
            <Link href={`/dashboard/projects/${id}/upload`}>
              <Button size="sm">
                <Upload className="mr-2 h-3.5 w-3.5" />
                Subir
              </Button>
            </Link>
          </div>

          {documents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">Sin documentos indexados.</p>
                <Link href={`/dashboard/projects/${id}/upload`}>
                  <Button variant="outline" size="sm" className="mt-3">
                    <Upload className="mr-2 h-3.5 w-3.5" />
                    Subir primer documento
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titulo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Formato</TableHead>
                    <TableHead className="text-right">Pags</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents
                    .filter((d) => docTypeFilter === "todos" || d.tipo === docTypeFilter)
                    .map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="max-w-[250px] truncate font-medium">
                        {doc.titulo}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {doc.tipo ? projectDocTypeLabels[doc.tipo] ?? doc.tipo : "—"}
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
                        {doc.naturaleza_pdf || "—"}
                      </TableCell>
                      <TableCell className="text-right">{doc.total_paginas ?? "—"}</TableCell>
                      <TableCell className="text-right">{doc.total_chunks ?? "—"}</TableCell>
                      <TableCell className="text-sm">{doc.fecha_documento ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* ═══ Tab: Inventario ═══ */}
      {activeTab === "inventario" && (
        <div className="space-y-4">
          {inventory.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Package className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">
                  Sin datos de inventario. Sube un Excel de costes o inventario LER.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{inventory.length} residuos registrados</span>
                <span>{inventory.filter((w) => w.peligroso).length} peligrosos</span>
                <span>
                  Coste total: {totalWasteCost.toLocaleString("es-ES", { maximumFractionDigits: 0 })} EUR/a
                </span>
              </div>
              <Card>
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
                        <TableCell className="font-mono text-sm">{item.codigo_ler}</TableCell>
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
              </Card>
            </>
          )}
        </div>
      )}

      {/* ═══ Tab: Contratos ═══ */}
      {activeTab === "contratos" && (
        <div className="space-y-4">
          {contracts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileSignature className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">
                  Sin contratos registrados. Se crean al procesar documentos de tipo contrato.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{contracts.length} contratos</span>
                <span>
                  {contracts.filter((c) => {
                    if (!c.fecha_vencimiento) return false;
                    const venc = new Date(c.fecha_vencimiento);
                    const now = new Date();
                    const diff = (venc.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
                    return diff <= 90 && diff >= 0;
                  }).length} proximos a vencer
                </span>
              </div>
              <div className="space-y-3">
                {contracts.map((contract) => {
                  const manager = managers.find((m) => m.id === contract.manager_id);
                  const isExpired = contract.fecha_vencimiento && new Date(contract.fecha_vencimiento) < new Date();
                  const isExpiring = contract.fecha_vencimiento && (() => {
                    const diff = (new Date(contract.fecha_vencimiento!).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                    return diff <= 90 && diff >= 0;
                  })();

                  return (
                    <Card key={contract.id} className={isExpired ? "border-red-300" : isExpiring ? "border-vandarum-orange/50" : ""}>
                      <CardContent className="py-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{manager?.nombre || "Gestor no identificado"}</p>
                              {isExpired && <Badge variant="destructive">Vencido</Badge>}
                              {isExpiring && !isExpired && <Badge variant="warning">Prox. vencer</Badge>}
                            </div>
                            {manager?.nif && (
                              <p className="text-xs text-muted-foreground font-mono">NIF: {manager.nif}</p>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {(contract.codigos_ler ?? []).map((ler) => (
                                <Badge key={ler} variant="outline" className="text-xs font-mono">
                                  {ler}
                                </Badge>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {contract.fecha_inicio && <span>Inicio: {contract.fecha_inicio}</span>}
                              {contract.fecha_vencimiento && <span>Vencimiento: {contract.fecha_vencimiento}</span>}
                            </div>
                          </div>
                          <div className="text-right">
                            {contract.precio_eur_ton != null && (
                              <p className="text-lg font-bold">{contract.precio_eur_ton} EUR/t</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ Tab: Alertas ═══ */}
      {activeTab === "alertas" && (
        <div className="space-y-4">
          {alerts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">
                  Sin alertas. Se generan automaticamente al procesar documentos.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <Card
                  key={alert.id}
                  className={
                    alert.estado === "resuelta" || alert.estado === "descartada"
                      ? "opacity-60"
                      : ""
                  }
                >
                  <CardContent className="flex items-start gap-3 py-4">
                    <Badge variant={severityColors[alert.severidad]}>
                      {alert.severidad}
                    </Badge>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{alert.descripcion}</p>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                        {alert.fecha_limite && <span>Limite: {alert.fecha_limite}</span>}
                        <Badge variant="outline" className="text-xs">
                          {alert.tipo.replace(/_/g, " ")}
                        </Badge>
                        {alert.estado !== "pendiente" && (
                          <Badge variant="outline" className="capitalize text-xs">
                            {alert.estado}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {alert.estado === "pendiente" && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => resolveAlert(alert.id)}>
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Resolver
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => dismissAlert(alert.id)}>
                          <X className="mr-1 h-3 w-3" />
                          Descartar
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Tab: Ahorros ═══ */}
      {activeTab === "ahorros" && (
        <div className="space-y-4">
          {savings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <TrendingDown className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">
                  Sin oportunidades de ahorro detectadas.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>
                  Ahorro total: <strong className="text-vandarum-green">{totalSavings.toLocaleString("es-ES")} EUR/a</strong>
                </span>
                <span>{savings.length} oportunidades</span>
              </div>
              <div className="space-y-3">
                {savings.map((opp) => (
                  <Card key={opp.id}>
                    <CardContent className="flex items-start gap-4 py-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="capitalize">
                            {opp.tipo.replace(/_/g, " ")}
                          </Badge>
                          <Badge variant={opp.ia_generada ? "default" : "secondary"}>
                            {opp.ia_generada ? "IA" : "Manual"}
                          </Badge>
                        </div>
                        <p className="text-sm">{opp.descripcion}</p>
                        {opp.norma_aplicable && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Base legal: {opp.norma_aplicable}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-vandarum-green">
                          {opp.ahorro_estimado_eur_año?.toLocaleString("es-ES")} EUR/a
                        </p>
                        {opp.inversion_necesaria != null && opp.inversion_necesaria > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Inversion: {opp.inversion_necesaria.toLocaleString("es-ES")} EUR
                          </p>
                        )}
                        {opp.payback_meses != null && opp.payback_meses > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Payback: {opp.payback_meses} meses
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ Tab: Analisis IA ═══ */}
      {activeTab === "analisis" && (
        <div className="space-y-6">
          {/* Running state */}
          {analysisRunning && (
            <Card className="border-vandarum-teal/30">
              <CardContent className="py-12 text-center">
                <Loader2 className="mx-auto h-10 w-10 animate-spin text-vandarum-teal mb-4" />
                <p className="text-lg font-medium">Analizando proyecto...</p>
                <p className="text-sm text-muted-foreground mt-2">
                  7 agentes especializados estan revisando los documentos, contratos,
                  facturas, inventario y normativa aplicable. Esto puede tardar 1-2 minutos.
                </p>
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                  {["AAI", "Contratos", "Facturas", "Registro", "Normativo", "Optimizador", "Redactor"].map((name) => (
                    <Badge key={name} variant="secondary" className="animate-pulse">
                      {name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error state */}
          {analysisError && !analysisRunning && (
            <Card className="border-red-300">
              <CardContent className="py-8 text-center">
                <AlertTriangle className="mx-auto h-8 w-8 text-red-500 mb-3" />
                <p className="text-sm text-destructive">{analysisError}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={runAnalysis}>
                  Reintentar
                </Button>
              </CardContent>
            </Card>
          )}

          {/* No analysis yet */}
          {!analysisResult && !analysisRunning && !analysisError && (
            <Card>
              <CardContent className="py-12 text-center">
                <Sparkles className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-lg font-medium">Analisis integral con IA</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                  7 agentes especializados analizaran los documentos del proyecto:
                  AAI, contratos, facturas, registros, normativa aplicable,
                  oportunidades de ahorro e informe ejecutivo.
                </p>
                <Button className="mt-4 bg-gradient-brand text-white hover:opacity-90" onClick={runAnalysis}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Lanzar analisis
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {analysisResult && !analysisRunning && (
            <div className="space-y-6">
              {/* Errors / warnings */}
              {analysisResult.errors.length > 0 && (
                <Card className="border-vandarum-orange/30">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-vandarum-orange" />
                      Limitaciones del analisis
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {analysisResult.errors.map((err, i) => (
                        <li key={i} className="text-xs text-muted-foreground">- {err}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Executive report */}
              {analysisResult.report && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Sparkles className="h-5 w-5 text-vandarum-teal" />
                      Informe ejecutivo
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{
                        __html: analysisResult.report
                          .replace(/^### (.*$)/gm, '<h3 class="text-base font-semibold mt-4 mb-2">$1</h3>')
                          .replace(/^## (.*$)/gm, '<h2 class="text-lg font-bold mt-6 mb-2">$1</h2>')
                          .replace(/^# (.*$)/gm, '<h1 class="text-xl font-bold mt-6 mb-3">$1</h1>')
                          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\*(.*?)\*/g, '<em>$1</em>')
                          .replace(/^- (.*$)/gm, '<li class="ml-4">$1</li>')
                          .replace(/^(\d+)\. (.*$)/gm, '<li class="ml-4"><strong>$1.</strong> $2</li>')
                          .replace(/\n\n/g, '<br/><br/>')
                          .replace(/\n/g, '<br/>')
                      }}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Opportunities summary */}
              {analysisResult.opportunities.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <TrendingDown className="h-5 w-5 text-vandarum-green" />
                      Oportunidades detectadas ({analysisResult.opportunities.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {analysisResult.opportunities.map((opp, i) => (
                        <div key={i} className="flex items-start gap-3 rounded-md border p-3">
                          <Badge variant="outline" className="capitalize shrink-0">
                            {opp.tipo.replace(/_/g, " ")}
                          </Badge>
                          <div className="flex-1">
                            <p className="text-sm">{opp.descripcion}</p>
                            {opp.norma && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Base legal: {opp.norma}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            {(opp.ahorro_eur_ano ?? 0) > 0 && (
                              <p className="font-bold text-vandarum-green">
                                {(opp.ahorro_eur_ano ?? 0).toLocaleString("es-ES")} EUR/a
                              </p>
                            )}
                            {(opp.inversion_eur ?? 0) > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Inv: {(opp.inversion_eur ?? 0).toLocaleString("es-ES")} EUR
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* All findings by severity */}
              {analysisResult.findings.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <AlertTriangle className="h-5 w-5 text-vandarum-orange" />
                      Hallazgos ({analysisResult.findings.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {analysisResult.findings
                        .sort((a, b) => {
                          const order: Record<string, number> = { critica: 0, alta: 1, media: 2, baja: 3, info: 4 };
                          return (order[a.severidad] ?? 5) - (order[b.severidad] ?? 5);
                        })
                        .map((finding, i) => (
                          <div key={i} className="flex items-start gap-2 rounded-md border p-3">
                            <Badge
                              variant={severityColors[finding.severidad] || "secondary"}
                              className="shrink-0"
                            >
                              {finding.severidad}
                            </Badge>
                            <div className="flex-1">
                              <p className="text-sm">{finding.descripcion}</p>
                              <div className="flex gap-2 mt-1">
                                <Badge variant="outline" className="text-xs">
                                  {finding.agente}
                                </Badge>
                                {finding.norma && (
                                  <span className="text-xs text-muted-foreground">
                                    {finding.norma}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Re-run button */}
              <div className="flex justify-center">
                <Button variant="outline" onClick={runAnalysis}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Ejecutar nuevo analisis
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
