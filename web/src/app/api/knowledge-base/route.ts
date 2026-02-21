import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    const docType = searchParams.get("doc_type");
    const search = searchParams.get("search");
    if (docType) params.set("doc_type", docType);
    if (search) params.set("search", search);

    const response = await fetch(
      `${PIPELINE_URL}/api/knowledge-base?${params.toString()}`
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Error" }));
      return NextResponse.json(
        { error: error.detail },
        { status: response.status }
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("fetch")
        ? "Pipeline API no disponible."
        : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
