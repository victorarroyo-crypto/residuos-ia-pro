"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export default function NewClientPage() {
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

    const { error } = await supabase.from("clients").insert({
      nombre: form.get("nombre") as string,
      cnae: (form.get("cnae") as string) || null,
      sector: (form.get("sector") as string) || null,
      comunidad_autonoma: (form.get("comunidad_autonoma") as string) || null,
      municipio: (form.get("municipio") as string) || null,
      tipo_relacion: (form.get("tipo_relacion") as string) || null,
      consultant_id: user?.id ?? null,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard/clients");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/dashboard/clients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Clientes
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Nuevo cliente</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Datos del cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Nombre *</label>
              <input
                name="nombre"
                required
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
                placeholder="Nombre de la empresa"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">CNAE</label>
                <input
                  name="cnae"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
                  placeholder="Ej: 2562"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Sector</label>
                <input
                  name="sector"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
                  placeholder="Ej: Fabricacion de productos metalicos"
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Comunidad Autonoma</label>
                <input
                  name="comunidad_autonoma"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
                  placeholder="Ej: Comunitat Valenciana"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Municipio</label>
                <input
                  name="municipio"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-vandarum-teal/20"
                  placeholder="Ej: Paterna"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Tipo de relacion</label>
              <select
                name="tipo_relacion"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none"
              >
                <option value="retainer">Retainer</option>
                <option value="auditoria">Auditoria</option>
                <option value="diagnostico">Diagnostico</option>
              </select>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Crear cliente
              </Button>
              <Link href="/dashboard/clients">
                <Button type="button" variant="outline">
                  Cancelar
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
