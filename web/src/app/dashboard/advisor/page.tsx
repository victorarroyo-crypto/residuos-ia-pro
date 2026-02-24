"use client";

import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AdvisorChat } from "@/components/advisor-chat";

export default function AdvisorPage() {
  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-vandarum-teal" />
            Asesor IA
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Experto en gestion de residuos industriales. Adjunta documentos, URLs o imagenes para un analisis mas preciso.
          </p>
        </div>
      </div>

      {/* Chat - full page mode */}
      <Card className="flex-1 flex flex-col min-h-0 p-4">
        <AdvisorChat className="flex-1 min-h-0" />
      </Card>
    </div>
  );
}
