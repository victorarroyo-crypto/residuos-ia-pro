import type {
  Client,
  WasteInventoryItem,
  ClientDocument,
  ComplianceAlert,
  SavingsOpportunity,
} from "@/types/database";

export const mockClients: Client[] = [
  {
    id: "c1",
    nombre: "Metalúrgica Levante S.L.",
    cnae: "2562",
    sector: "Fabricación de productos metálicos",
    comunidad: "Comunitat Valenciana",
    municipio: "Paterna",
    consultant_id: null,
    tipo_relacion: "retainer",
    activo: true,
    metadata: { numero_aai: "AAI/2019/0234" },
  },
  {
    id: "c2",
    nombre: "Plásticos del Norte S.A.",
    cnae: "2229",
    sector: "Fabricación de productos plásticos",
    comunidad: "País Vasco",
    municipio: "Bilbao",
    consultant_id: null,
    tipo_relacion: "auditoria",
    activo: true,
    metadata: null,
  },
  {
    id: "c3",
    nombre: "Química Industrial Bcn",
    cnae: "2059",
    sector: "Fabricación de productos químicos",
    comunidad: "Cataluña",
    municipio: "Tarragona",
    consultant_id: null,
    tipo_relacion: "retainer",
    activo: true,
    metadata: { numero_aai: "AAI/2021/0891" },
  },
  {
    id: "c4",
    nombre: "Alimentaria Castilla S.L.",
    cnae: "1085",
    sector: "Elaboración de platos preparados",
    comunidad: "Castilla y León",
    municipio: "Valladolid",
    consultant_id: null,
    tipo_relacion: "diagnostico",
    activo: true,
    metadata: null,
  },
  {
    id: "c5",
    nombre: "AutoParts Aragón S.A.",
    cnae: "2932",
    sector: "Fabricación componentes automoción",
    comunidad: "Aragón",
    municipio: "Zaragoza",
    consultant_id: null,
    tipo_relacion: "retainer",
    activo: false,
    metadata: { numero_aai: "AAI/2020/0567" },
  },
];

export const mockWasteInventory: WasteInventoryItem[] = [
  {
    id: "w1",
    client_id: "c1",
    codigo_ler: "12 01 01",
    descripcion: "Limaduras y virutas de metales férreos",
    peligroso: false,
    cantidad_anual_ton: 45.2,
    gestor_actual: "Reciclajes Mediterráneo S.L.",
    precio_actual_eur_ton: 15,
    operacion: "R4",
    frecuencia_recogida: "Quincenal",
    año: 2024,
    fuente_doc_id: null,
  },
  {
    id: "w2",
    client_id: "c1",
    codigo_ler: "12 01 09*",
    descripcion: "Emulsiones y disoluciones de mecanizado con halógenos",
    peligroso: true,
    cantidad_anual_ton: 8.7,
    gestor_actual: "Gestión Ambiental Ibérica",
    precio_actual_eur_ton: 320,
    operacion: "D9",
    frecuencia_recogida: "Mensual",
    año: 2024,
    fuente_doc_id: null,
  },
  {
    id: "w3",
    client_id: "c1",
    codigo_ler: "15 01 01",
    descripcion: "Envases de papel y cartón",
    peligroso: false,
    cantidad_anual_ton: 12.0,
    gestor_actual: "Reciclajes Mediterráneo S.L.",
    precio_actual_eur_ton: 0,
    operacion: "R3",
    frecuencia_recogida: "Semanal",
    año: 2024,
    fuente_doc_id: null,
  },
  {
    id: "w4",
    client_id: "c1",
    codigo_ler: "13 02 05*",
    descripcion: "Aceites minerales no clorados de motor",
    peligroso: true,
    cantidad_anual_ton: 2.1,
    gestor_actual: "Aceites Usados Levante",
    precio_actual_eur_ton: 180,
    operacion: "R9",
    frecuencia_recogida: "Trimestral",
    año: 2024,
    fuente_doc_id: null,
  },
];

export const mockDocuments: ClientDocument[] = [
  {
    id: "doc_abc123",
    client_id: "c1",
    titulo: "AAI Metalúrgica Levante 2019",
    tipo: "autorizacion_ambiental_integrada",
    naturaleza_pdf: "digital",
    total_paginas: 87,
    total_chunks: 42,
    tablas_encontradas: 6,
    ocr_aplicado: false,
    ocr_confianza_media: null,
    fue_encriptado: false,
    drive_file_id: null,
    advertencias: null,
    metadata: null,
    estado: "indexado",
    fecha_documento: "2019-06-15",
    fecha_vencimiento: "2027-06-15",
    fecha_ingesta: "2024-11-01T10:00:00Z",
  },
  {
    id: "doc_def456",
    client_id: "c1",
    titulo: "Contrato Reciclajes Mediterráneo 2024",
    tipo: "contrato_gestor",
    naturaleza_pdf: "scanned",
    total_paginas: 12,
    total_chunks: 8,
    tablas_encontradas: 2,
    ocr_aplicado: true,
    ocr_confianza_media: 0.89,
    fue_encriptado: false,
    drive_file_id: null,
    advertencias: null,
    metadata: null,
    estado: "indexado",
    fecha_documento: "2024-01-15",
    fecha_vencimiento: "2025-01-15",
    fecha_ingesta: "2024-11-02T14:30:00Z",
  },
  {
    id: "doc_ghi789",
    client_id: "c1",
    titulo: "Facturas Q3 2024 - Gestión Ambiental Ibérica",
    tipo: "factura",
    naturaleza_pdf: "digital",
    total_paginas: 4,
    total_chunks: 4,
    tablas_encontradas: 3,
    ocr_aplicado: false,
    ocr_confianza_media: null,
    fue_encriptado: false,
    drive_file_id: null,
    advertencias: null,
    metadata: null,
    estado: "indexado",
    fecha_documento: "2024-09-30",
    fecha_vencimiento: null,
    fecha_ingesta: "2024-11-05T09:15:00Z",
  },
  {
    id: "xls_jkl012",
    client_id: "c1",
    titulo: "Costes gestión 2023-2024",
    tipo: "costes_anuales",
    naturaleza_pdf: "excel",
    total_paginas: null,
    total_chunks: 3,
    tablas_encontradas: null,
    ocr_aplicado: false,
    ocr_confianza_media: null,
    fue_encriptado: false,
    drive_file_id: null,
    advertencias: null,
    metadata: null,
    estado: "indexado",
    fecha_documento: "2024-10-01",
    fecha_vencimiento: null,
    fecha_ingesta: "2024-11-03T16:00:00Z",
  },
];

export const mockAlerts: ComplianceAlert[] = [
  {
    id: "a1",
    client_id: "c1",
    tipo: "vencimiento_contrato",
    descripcion: "El contrato con Reciclajes Mediterráneo vence en 45 días",
    severidad: "alta",
    doc_id: "doc_def456",
    estado: "pendiente",
    fecha_limite: "2025-01-15",
  },
  {
    id: "a2",
    client_id: "c1",
    tipo: "almacenamiento_peligroso",
    descripcion:
      "LER 12 01 09* lleva 5 meses almacenado — límite legal 6 meses",
    severidad: "critica",
    doc_id: null,
    estado: "pendiente",
    fecha_limite: "2025-01-30",
  },
  {
    id: "a3",
    client_id: "c3",
    tipo: "declaracion_anual",
    descripcion: "DARI 2024 pendiente de presentar antes del 31 de marzo",
    severidad: "media",
    doc_id: null,
    estado: "pendiente",
    fecha_limite: "2025-03-31",
  },
  {
    id: "a4",
    client_id: "c2",
    tipo: "sobrecoste_detectado",
    descripcion: "Precio facturado LER 15 02 02* un 40% superior al benchmark",
    severidad: "media",
    doc_id: null,
    estado: "vista",
    fecha_limite: null,
  },
];

export const mockSavings: SavingsOpportunity[] = [
  {
    id: "s1",
    client_id: "c1",
    waste_id: "w2",
    tipo: "cambio_gestor",
    descripcion:
      "Cambiar gestor de emulsiones de mecanizado. Gestor actual cobra 320 EUR/t, benchmark 210 EUR/t",
    ahorro_estimado_eur_año: 957,
    inversion_necesaria: 0,
    payback_meses: 0,
    norma_aplicable: "Ley 7/2022 art. 20 — libertad de elección de gestor autorizado",
    estado: "propuesta",
    ia_generada: true,
  },
  {
    id: "s2",
    client_id: "c1",
    waste_id: "w1",
    tipo: "cambio_operacion",
    descripcion:
      "Virutas metálicas actualmente R4 — valorar venta directa a fundición (ingreso neto en lugar de coste)",
    ahorro_estimado_eur_año: 2260,
    inversion_necesaria: 500,
    payback_meses: 3,
    norma_aplicable: "RD 553/2020 traslado de residuos, art. 5",
    estado: "detectada",
    ia_generada: true,
  },
];

// Helper: get compliance status for a client
export type ComplianceStatus = "ok" | "warning" | "danger";

export function getClientComplianceStatus(clientId: string): ComplianceStatus {
  const clientAlerts = mockAlerts.filter(
    (a) => a.client_id === clientId && a.estado === "pendiente"
  );
  if (clientAlerts.some((a) => a.severidad === "critica")) return "danger";
  if (clientAlerts.some((a) => a.severidad === "alta" || a.severidad === "media"))
    return "warning";
  return "ok";
}

export function getClientDocCount(clientId: string): number {
  return mockDocuments.filter((d) => d.client_id === clientId).length;
}

export function getClientAlertCount(clientId: string): number {
  return mockAlerts.filter(
    (a) => a.client_id === clientId && a.estado === "pendiente"
  ).length;
}
