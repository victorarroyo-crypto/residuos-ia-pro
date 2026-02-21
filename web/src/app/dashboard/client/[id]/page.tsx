"use client";

import { use } from "react";
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
  mockWasteInventory,
  mockDocuments,
  mockAlerts,
  mockSavings,
  getClientComplianceStatus,
} from "@/lib/mock-data";

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
    ok: "bg-green-500",
    warning: "bg-yellow-500",
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

export default function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const client = mockClients.find((c) => c.id === id);

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg text-muted-foreground">Cliente no encontrado</p>
        <Link href="/dashboard" className="mt-4 text-primary hover:underline">
          Volver al dashboard
        </Link>
      </div>
    );
  }

  const inventory = mockWasteInventory.filter((w) => w.client_id === id);
  const documents = mockDocuments.filter((d) => d.client_id === id);
  const alerts = mockAlerts.filter((a) => a.client_id === id);
  const savings = mockSavings.filter((s) => s.client_id === id);
  const complianceStatus = getClientComplianceStatus(id);

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
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{client.nombre}</h1>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Building2 className="h-4 w-4" /> CNAE {client.cnae}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" /> {client.municipio},{" "}
              {client.comunidad}
            </span>
            <Badge variant="outline" className="capitalize">
              {client.tipo_relacion}
            </Badge>
            <ComplianceDot status={complianceStatus} />
          </div>
        </div>
        <Link href={`/dashboard/client/${id}/upload`}>
          <Button>
            <Upload className="mr-2 h-4 w-4" />
            Subir documentos
          </Button>
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Residuos registrados</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inventory.length}</div>
            <p className="text-xs text-muted-foreground">
              {inventory.filter((w) => w.peligroso).length} peligrosos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Coste anual gestión</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertas</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {alerts.filter((a) => a.estado === "pendiente").length}
            </div>
            <p className="text-xs text-muted-foreground">pendientes</p>
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
              {savings.length} oportunidades
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Waste Inventory */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="h-5 w-5" />
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
                  <TableHead>Código LER</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Peligroso</TableHead>
                  <TableHead className="text-right">t/año</TableHead>
                  <TableHead className="text-right">EUR/t</TableHead>
                  <TableHead>Operación</TableHead>
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
                        <Badge variant="danger">Sí</Badge>
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
            <FileText className="h-5 w-5" />
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
                  <TableHead>Título</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Formato</TableHead>
                  <TableHead className="text-right">Páginas</TableHead>
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
                        {doc.tipo ? docTypeLabels[doc.tipo] ?? doc.tipo : "—"}
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

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5" />
              Alertas de cumplimiento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 rounded-md border p-3"
                >
                  <Badge variant={severityColors[alert.severidad]}>
                    {alert.severidad}
                  </Badge>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{alert.descripcion}</p>
                    {alert.fecha_limite && (
                      <p className="text-xs text-muted-foreground">
                        Fecha límite: {alert.fecha_limite}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline">{alert.estado}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Savings Opportunities */}
      {savings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5" />
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
                    <p className="text-lg font-bold text-primary">
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
