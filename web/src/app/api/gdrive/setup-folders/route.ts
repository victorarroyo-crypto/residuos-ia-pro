import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_URL, pipelineHeaders } from "@/lib/pipeline";

export const dynamic = 'force-dynamic';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const response = await fetch(`${PIPELINE_URL}/api/gdrive/setup-folders`, {
        method: "POST",
        headers: pipelineHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let message = `Pipeline respondio con status ${response.status}`;
        try {
          const parsed = JSON.parse(text);
          message = parsed.detail || parsed.error || parsed.message || message;
        } catch {
          if (text) message = text;
        }
        return NextResponse.json({ error: message }, { status: response.status });
      }

      return NextResponse.json(await response.json());
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof DOMException && error.name === "AbortError") {
        return NextResponse.json(
          { error: "Pipeline API tardo demasiado en responder." },
          { status: 504 }
        );
      }
      throw error;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[gdrive/setup-folders] Error:", detail);
    return NextResponse.json(
      { error: `Error al conectar con Pipeline API: ${detail}` },
      { status: 502 }
    );
  }
}
