"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export default function NewProjectPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from("projects").insert({
      nombre: form.get("nombre") as string,
      cif: (form.get("cif") as string) || null,
      cnae: (form.get("cnae") as string) || null,
      sector: (form.get("sector") as string) || null,
      comunidad_autonoma: (form.get("comunidad_autonoma") as string) || null,
      municipio: (form.get("municipio") as string) || null,
      direccion: (form.get("direccion") as string) || null,
      contacto_nombre: (form.get("contacto_nombre") as string) || null,
      contacto_email: (form.get("contacto_email") as string) || null,
      contacto_telefono: (form.get("contacto_telefono") as string) || null,
      notas: (form.get("notas") as string) || null,
      tipo_relacion: (form.get("tipo_relacion") as string) || null,
      consultant_id: user?.id ?? null,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard/projects");
    router.refresh();
  }

  const inputClass =
    "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/dashboard/projects"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Proyectos
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Nuevo proyecto</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Datos de la empresa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Nombre *</label>
                <input name="nombre" required className={inputClass} placeholder="Razon social" />
              </div>
              <div>
                <label className="text-sm font-medium">CIF/NIF</label>
                <input name="cif" className={inputClass} placeholder="Ej: B12345678" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">CNAE</label>
                <input name="cnae" className={inputClass} placeholder="Ej: 2562" />
              </div>
              <div>
                <label className="text-sm font-medium">Sector</label>
                <input name="sector" className={inputClass} placeholder="Ej: Fabricacion metalica" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Direccion</label>
              <input name="direccion" className={inputClass} placeholder="Direccion completa" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Comunidad Autonoma</label>
                <input name="comunidad_autonoma" className={inputClass} placeholder="Ej: Comunitat Valenciana" />
              </div>
              <div>
                <label className="text-sm font-medium">Municipio</label>
                <input name="municipio" className={inputClass} placeholder="Ej: Paterna" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Tipo de relacion</label>
              <select name="tipo_relacion" className={inputClass}>
                <option value="retainer">Retainer (seguimiento continuo)</option>
                <option value="auditoria">Auditoria (puntual)</option>
                <option value="diagnostico">Diagnostico inicial</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Persona de contacto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Nombre</label>
              <input name="contacto_nombre" className={inputClass} placeholder="Nombre y apellidos" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Email</label>
                <input name="contacto_email" type="email" className={inputClass} placeholder="email@empresa.com" />
              </div>
              <div>
                <label className="text-sm font-medium">Telefono</label>
                <input name="contacto_telefono" type="tel" className={inputClass} placeholder="+34 600 000 000" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              name="notas"
              rows={3}
              className={inputClass}
              placeholder="Observaciones, contexto del proyecto, particularidades..."
            />
          </CardContent>
        </Card>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear proyecto
          </Button>
          <Link href="/dashboard/projects">
            <Button type="button" variant="outline">Cancelar</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
