import Link from "next/link";
import {
  Leaf,
  FileText,
  AlertTriangle,
  TrendingDown,
  Upload,
  Search,
  Shield,
  BarChart3,
  ArrowRight,
  CheckCircle2,
  Zap,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function FeatureCard({
  icon: Icon,
  title,
  description,
  color,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <div className="group rounded-xl border bg-card p-6 transition-all hover:shadow-lg hover:border-vandarum-teal/30">
      <div
        className={`mb-4 inline-flex rounded-lg p-3 ${color}`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-brand text-sm font-bold text-white">
          {number}
        </div>
        {number < 4 && <div className="mt-2 h-full w-px bg-border" />}
      </div>
      <div className="pb-8">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <div className="text-center">
      <p className="text-3xl font-bold text-gradient-brand">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-brand">
              <Leaf className="h-5 w-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-wide">vandarum</span>
              <span className="text-[9px] font-medium text-muted-foreground tracking-wider uppercase">
                ResidusIA Pro
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Iniciar sesion
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm">
                Empezar gratis
                <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-vandarum-teal/5 to-transparent" />
        <div className="relative mx-auto max-w-6xl px-6 py-24 text-center lg:py-32">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm text-muted-foreground mb-8">
            <Zap className="h-3.5 w-3.5 text-vandarum-orange" />
            Potenciado por IA
          </div>
          <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight lg:text-6xl">
            La plataforma de{" "}
            <span className="text-gradient-brand">gestion de residuos</span>{" "}
            para consultores ambientales
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Procesa AAIs, contratos y facturas con IA. Detecta sobrecostes,
            alertas de cumplimiento y oportunidades de ahorro para tus clientes
            industriales.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="h-12 px-8 text-base">
                Crear cuenta gratis
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg" className="h-12 px-8 text-base">
                Ya tengo cuenta
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="mx-auto mt-20 grid max-w-2xl grid-cols-3 gap-8 border-t pt-10">
            <StatCard value="8" label="Tipos de documento" />
            <StatCard value="< 2 min" label="Procesamiento por PDF" />
            <StatCard value="99.2%" label="Precision de extraccion" />
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight">
            Todo lo que necesitas para gestionar residuos industriales
          </h2>
          <p className="mt-3 text-muted-foreground">
            De PDFs caoticos a datos estructurados y accionables.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={Upload}
            title="Ingesta inteligente"
            color="bg-vandarum-teal/10 text-vandarum-teal"
            description="Sube PDFs, Excel o CSV. Detectamos automaticamente si es AAI, contrato, factura o DARI. OCR incluido para documentos escaneados."
          />
          <FeatureCard
            icon={Brain}
            title="Extraccion con IA"
            color="bg-vandarum-blue/10 text-vandarum-blue"
            description="Claude extrae codigos LER, precios, fechas de vencimiento, operaciones autorizadas y condiciones contractuales de cualquier documento."
          />
          <FeatureCard
            icon={Search}
            title="Busqueda RAG"
            color="bg-vandarum-green/10 text-vandarum-green"
            description="Pregunta en lenguaje natural sobre tus documentos. Sistema RAG de dos niveles: normativa general + documentos del cliente."
          />
          <FeatureCard
            icon={AlertTriangle}
            title="Alertas de cumplimiento"
            color="bg-vandarum-orange/10 text-vandarum-orange"
            description="Detecta contratos a punto de vencer, excesos de almacenamiento, DARIs pendientes y desviaciones de la AAI automaticamente."
          />
          <FeatureCard
            icon={TrendingDown}
            title="Optimizacion de costes"
            color="bg-vandarum-green/10 text-vandarum-green"
            description="Compara precios de gestores contra benchmarks del mercado. Identifica oportunidades de cambio de operacion o de gestor."
          />
          <FeatureCard
            icon={Shield}
            title="Aislamiento por cliente"
            color="bg-vandarum-teal/10 text-vandarum-teal"
            description="Row Level Security en Supabase. Cada consultor solo ve los datos de sus propios clientes. Cumple RGPD por diseno."
          />
        </div>
      </section>

      {/* How it works */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-16 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">
                Como funciona
              </h2>
              <p className="mt-3 text-muted-foreground">
                En 4 pasos pasas del caos documental a datos estructurados.
              </p>
              <div className="mt-10 space-y-0">
                <StepCard
                  number={1}
                  title="Sube los documentos del cliente"
                  description="Arrastra PDFs de AAI, contratos con gestores, facturas, DARIs, o Excel de costes. Acepta digitales, escaneados y encriptados."
                />
                <StepCard
                  number={2}
                  title="El pipeline los procesa"
                  description="Detecta tipo, extrae texto (OCR si hace falta), clasifica, fragmenta en chunks semanticos y genera embeddings."
                />
                <StepCard
                  number={3}
                  title="IA extrae los datos clave"
                  description="Codigos LER, precios EUR/t, operaciones D/R, fechas de vencimiento, condiciones contractuales y mas."
                />
                <StepCard
                  number={4}
                  title="Recibe alertas y recomendaciones"
                  description="Alertas automaticas de cumplimiento, deteccion de sobrecostes y oportunidades de ahorro con base legal."
                />
              </div>
            </div>
            <div className="flex items-center justify-center">
              <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-lg">
                <div className="flex items-center gap-3 border-b pb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-brand">
                    <Leaf className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold">Pipeline de procesamiento</p>
                    <p className="text-xs text-muted-foreground">AAI_Metalurgica_Levante.pdf</p>
                  </div>
                </div>
                {[
                  { label: "Detectando tipo de documento", done: true },
                  { label: "Extrayendo contenido (87 pags)", done: true },
                  { label: "Clasificando: AAI", done: true },
                  { label: "Fragmentando en 42 chunks", done: true },
                  { label: "Generando embeddings", done: true },
                  { label: "Extrayendo metadatos", done: true },
                  { label: "6 tablas, 12 codigos LER encontrados", done: true },
                ].map((step) => (
                  <div key={step.label} className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-vandarum-green flex-shrink-0" />
                    <span>{step.label}</span>
                  </div>
                ))}
                <div className="mt-2 rounded-lg bg-vandarum-green/10 p-3 text-sm text-vandarum-green font-medium">
                  Documento indexado correctamente
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Document types */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight">
            Documentos que procesamos
          </h2>
          <p className="mt-3 text-muted-foreground">
            Toda la documentacion de gestion de residuos industriales.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: FileText, label: "AAI", desc: "Autorizacion Ambiental Integrada" },
            { icon: FileText, label: "DARI", desc: "Declaracion Anual de Residuos" },
            { icon: FileText, label: "Contratos", desc: "Contratos con gestores" },
            { icon: FileText, label: "Facturas", desc: "Facturas de gestion" },
            { icon: FileText, label: "Registros", desc: "Libro de produccion" },
            { icon: FileText, label: "Permisos", desc: "Permisos ambientales" },
            { icon: BarChart3, label: "Excel costes", desc: "Hojas de coste anual" },
            { icon: BarChart3, label: "Inventario LER", desc: "Excel de inventario" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-secondary"
            >
              <item.icon className="h-5 w-5 text-vandarum-teal flex-shrink-0" />
              <div>
                <p className="font-medium text-sm">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Empieza a optimizar la gestion de residuos de tus clientes
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Registrate gratis. Sube tu primer documento. Ve los resultados en menos de 2 minutos.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="h-12 px-8 text-base">
                Crear cuenta gratis
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8">
          <div className="flex items-center gap-2">
            <Leaf className="h-4 w-4 text-vandarum-teal" />
            <span className="text-sm font-semibold">vandarum</span>
            <span className="text-xs text-muted-foreground">ResidusIA Pro</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Plataforma de consultoria de gestion de residuos industriales
          </p>
        </div>
      </footer>
    </div>
  );
}
