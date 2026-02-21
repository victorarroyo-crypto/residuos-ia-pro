export type Database = {
  public: {
    Tables: {
      clients: {
        Row: Client;
        Insert: Omit<Client, "id">;
        Update: Partial<Client>;
        Relationships: [];
      };
      projects: {
        Row: Project;
        Insert: Omit<Project, "id">;
        Update: Partial<Project>;
        Relationships: [];
      };
      waste_inventory: {
        Row: WasteInventoryItem;
        Insert: Omit<WasteInventoryItem, "id">;
        Update: Partial<WasteInventoryItem>;
        Relationships: [];
      };
      client_documents: {
        Row: ClientDocument;
        Insert: ClientDocument;
        Update: Partial<ClientDocument>;
        Relationships: [];
      };
      document_chunks: {
        Row: DocumentChunk;
        Insert: DocumentChunk;
        Update: Partial<DocumentChunk>;
        Relationships: [];
      };
      compliance_alerts: {
        Row: ComplianceAlert;
        Insert: Omit<ComplianceAlert, "id">;
        Update: Partial<ComplianceAlert>;
        Relationships: [];
      };
      pipeline_progress: {
        Row: PipelineProgress;
        Insert: PipelineProgress;
        Update: Partial<PipelineProgress>;
        Relationships: [];
      };
      savings_opportunities: {
        Row: SavingsOpportunity;
        Insert: Omit<SavingsOpportunity, "id">;
        Update: Partial<SavingsOpportunity>;
        Relationships: [];
      };
      waste_managers: {
        Row: WasteManager;
        Insert: Omit<WasteManager, "id">;
        Update: Partial<WasteManager>;
        Relationships: [];
      };
      contracts: {
        Row: Contract;
        Insert: Omit<Contract, "id">;
        Update: Partial<Contract>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export interface Client {
  id: string;
  nombre: string;
  cnae: string | null;
  sector: string | null;
  comunidad: string | null;
  municipio: string | null;
  consultant_id: string | null;
  tipo_relacion: "retainer" | "auditoria" | "diagnostico" | null;
  metadata: Record<string, unknown> | null;
}

export interface Project {
  id: string;
  client_id: string;
  consultant_id: string | null;
  nombre: string;
  tipo: "diagnostico_inicial" | "retainer_anual" | "auditoria" | "optimizacion_puntual";
  estado: "activo" | "completado" | "pausado";
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

export interface WasteInventoryItem {
  id: string;
  client_id: string;
  codigo_ler: string;
  descripcion: string | null;
  peligroso: boolean;
  cantidad_anual_ton: number | null;
  gestor_actual: string | null;
  precio_actual_eur_ton: number | null;
  operacion: string | null;
  frecuencia_recogida: string | null;
  año: number | null;
  fuente_doc_id: string | null;
}

export type DocType =
  | "autorizacion_ambiental_integrada"
  | "declaracion_anual_residuos"
  | "contrato_gestor"
  | "factura"
  | "registro_produccion"
  | "permiso_ambiental"
  | "manual_interno"
  | "normativa"
  | "costes_anuales"
  | "inventario_ler"
  | "comparativa_gestores"
  | "facturas_agregadas"
  | "presupuesto";

export interface ClientDocument {
  id: string;
  client_id: string | null;
  titulo: string | null;
  tipo: DocType | null;
  naturaleza_pdf: "digital" | "scanned" | "hybrid" | "encrypted" | "excel" | null;
  total_paginas: number | null;
  total_chunks: number | null;
  tablas_encontradas: number | null;
  ocr_aplicado: boolean | null;
  ocr_confianza_media: number | null;
  fue_encriptado: boolean | null;
  drive_file_id: string | null;
  advertencias: string[] | null;
  metadata: Record<string, unknown> | null;
  estado: "procesando" | "indexado" | "error" | "pendiente" | null;
  fecha_documento: string | null;
  fecha_vencimiento: string | null;
  fecha_ingesta: string | null;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  contenido: string;
  embedding: number[] | null;
  chunk_type: "texto" | "tabla" | "seccion" | "clausula" | "excel_sheet" | null;
  page_start: number | null;
  page_end: number | null;
  tokens: number | null;
  rag_scope: "general" | "project" | null;
  project_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ComplianceAlert {
  id: string;
  client_id: string;
  tipo: string;
  descripcion: string;
  severidad: "baja" | "media" | "alta" | "critica";
  doc_id: string | null;
  estado: "pendiente" | "vista" | "resuelta" | "descartada";
  fecha_limite: string | null;
}

export interface PipelineProgress {
  doc_id: string;
  step: string;
  percentage: number;
  mensaje: string | null;
  error: string | null;
}

export interface SavingsOpportunity {
  id: string;
  client_id: string;
  waste_id: string | null;
  tipo: string;
  descripcion: string;
  ahorro_estimado_eur_año: number | null;
  inversion_necesaria: number | null;
  payback_meses: number | null;
  norma_aplicable: string | null;
  estado: "detectada" | "propuesta" | "aceptada" | "implementada" | "descartada";
  ia_generada: boolean;
}

export interface WasteManager {
  id: string;
  nombre: string;
  nif: string | null;
  numero_autorizacion: string | null;
  ccaa_autorizacion: string[] | null;
  codigos_ler_autorizados: string[] | null;
  operaciones_autorizadas: string[] | null;
  precio_referencia_eur_ton: number | null;
  valoracion: number | null;
  activo: boolean;
}

export interface Contract {
  id: string;
  client_id: string;
  manager_id: string | null;
  fecha_inicio: string | null;
  fecha_vencimiento: string | null;
  codigos_ler: string[] | null;
  precio_eur_ton: number | null;
  condiciones: Record<string, unknown> | null;
  drive_file_id: string | null;
  alertar_dias_antes: number;
}
