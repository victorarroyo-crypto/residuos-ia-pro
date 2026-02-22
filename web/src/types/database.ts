export type Database = {
  public: {
    Tables: {
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
      knowledge_documents: {
        Row: KnowledgeDocument;
        Insert: KnowledgeDocument;
        Update: Partial<KnowledgeDocument>;
        Relationships: [];
      };
      knowledge_chunks: {
        Row: KnowledgeChunk;
        Insert: KnowledgeChunk;
        Update: Partial<KnowledgeChunk>;
        Relationships: [];
      };
      project_documents: {
        Row: ProjectDocument;
        Insert: ProjectDocument;
        Update: Partial<ProjectDocument>;
        Relationships: [];
      };
      project_chunks: {
        Row: ProjectChunk;
        Insert: ProjectChunk;
        Update: Partial<ProjectChunk>;
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

/** @deprecated Use Project instead - clients table merged into projects */
export type Client = Project;

export interface Project {
  id: string;
  consultant_id: string | null;
  nombre: string;
  cif: string | null;
  cnae: string | null;
  sector: string | null;
  comunidad_autonoma: string | null;
  municipio: string | null;
  direccion: string | null;
  contacto_nombre: string | null;
  contacto_email: string | null;
  contacto_telefono: string | null;
  notas: string | null;
  tipo_relacion: "retainer" | "auditoria" | "diagnostico" | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface WasteInventoryItem {
  id: string;
  project_id: string;
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
  created_at: string | null;
}

/** Tipos de documento de knowledge base (alineados con estructura Google Drive) */
export type KnowledgeDocType =
  | "legislacion"             // 01_Legislacion_Regulacion
  | "documentacion_tecnica"   // 02_Documentacion_Tecnica (BREFs, MTD)
  | "gestores_residuos"       // 03_Gestores_Residuos
  | "clasificacion_residuos"  // 04_Clasificacion_Residuos (LER)
  | "gestion_operativa"       // 05_Gestion_Operativa
  | "referencia"              // 06_Referencia
  | "desconocido";

/** Tipos de documento de proyecto */
export type ProjectDocType =
  | "autorizacion_ambiental_integrada"
  | "declaracion_anual_residuos"
  | "contrato_gestor"
  | "factura"
  | "registro_produccion"
  | "permiso_ambiental"
  | "manual_interno"
  | "costes_anuales"
  | "inventario_ler"
  | "comparativa_gestores"
  | "facturas_agregadas"
  | "presupuesto"
  | "desconocido";

/** @deprecated Use KnowledgeDocument or ProjectDocument instead */
export type ClientDocument = KnowledgeDocument | ProjectDocument;

/** Knowledge base document (RAG General - normativa, BREFs from Google Drive) */
export interface KnowledgeDocument {
  id: string;
  titulo: string | null;
  tipo: KnowledgeDocType | null;
  naturaleza_pdf: "digital" | "scanned" | "hybrid" | "encrypted" | "excel" | null;
  total_paginas: number | null;
  total_chunks: number | null;
  tablas_encontradas: number | null;
  ocr_aplicado: boolean | null;
  ocr_confianza_media: number | null;
  fue_encriptado: boolean | null;
  storage_path: string | null;
  advertencias: string[] | null;
  metadata: Record<string, unknown> | null;
  estado: "procesando" | "indexado" | "error" | "pendiente" | null;
  fecha_documento: string | null;
  fecha_vencimiento: string | null;
  fecha_ingesta: string | null;
  drive_file_id: string | null;
}

/** Project-specific document (RAG Proyecto - facturas, AAI, contracts per project) */
export interface ProjectDocument {
  id: string;
  project_id: string;
  titulo: string | null;
  tipo: ProjectDocType | null;
  naturaleza_pdf: "digital" | "scanned" | "hybrid" | "encrypted" | "excel" | null;
  total_paginas: number | null;
  total_chunks: number | null;
  tablas_encontradas: number | null;
  ocr_aplicado: boolean | null;
  ocr_confianza_media: number | null;
  fue_encriptado: boolean | null;
  storage_path: string | null;
  advertencias: string[] | null;
  metadata: Record<string, unknown> | null;
  estado: "procesando" | "indexado" | "error" | "pendiente" | null;
  fecha_documento: string | null;
  fecha_vencimiento: string | null;
  fecha_ingesta: string | null;
}

/** @deprecated Use KnowledgeChunk or ProjectChunk instead */
export type DocumentChunk = KnowledgeChunk | ProjectChunk;

/** Knowledge base chunk (RAG General) */
export interface KnowledgeChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  contenido: string;
  embedding: number[] | null;
  chunk_type: "texto" | "tabla" | "seccion" | "clausula" | "excel_sheet" | null;
  page_start: number | null;
  page_end: number | null;
  tokens: number | null;
  metadata: Record<string, unknown> | null;
}

/** Project-specific chunk (RAG Proyecto) */
export interface ProjectChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  contenido: string;
  embedding: number[] | null;
  chunk_type: "texto" | "tabla" | "seccion" | "clausula" | "excel_sheet" | null;
  page_start: number | null;
  page_end: number | null;
  tokens: number | null;
  metadata: Record<string, unknown> | null;
}

export interface ComplianceAlert {
  id: string;
  project_id: string;
  tipo: string;
  descripcion: string;
  severidad: "baja" | "media" | "alta" | "critica";
  doc_id: string | null;
  estado: "pendiente" | "vista" | "resuelta" | "descartada";
  fecha_limite: string | null;
  created_at: string | null;
  resolved_at: string | null;
}

export interface PipelineProgress {
  doc_id: string;
  step: string;
  percentage: number;
  mensaje: string | null;
  error: string | null;
  updated_at: string | null;
}

export interface SavingsOpportunity {
  id: string;
  project_id: string;
  waste_id: string | null;
  tipo: string;
  descripcion: string;
  ahorro_estimado_eur_año: number | null;
  inversion_necesaria: number | null;
  payback_meses: number | null;
  norma_aplicable: string | null;
  estado: "detectada" | "propuesta" | "aceptada" | "implementada" | "descartada";
  ia_generada: boolean;
  created_at: string | null;
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
  created_at: string | null;
}

export interface Contract {
  id: string;
  project_id: string;
  manager_id: string | null;
  fecha_inicio: string | null;
  fecha_vencimiento: string | null;
  codigos_ler: string[] | null;
  precio_eur_ton: number | null;
  condiciones: Record<string, unknown> | null;
  storage_path: string | null;
  alertar_dias_antes: number;
  created_at: string | null;
}
