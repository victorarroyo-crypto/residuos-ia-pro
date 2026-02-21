import { NextRequest, NextResponse } from "next/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

function getOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  try {
    const consultantId = request.nextUrl.searchParams.get("consultant_id");
    if (!consultantId) {
      return NextResponse.json(
        { error: "consultant_id is required" },
        { status: 400 }
      );
    }

    const origin = getOrigin(request);
    const redirectUri = `${origin}/api/gdrive/callback`;

    const response = await fetch(
      `${PIPELINE_URL}/api/gdrive/auth-url?consultant_id=${consultantId}&redirect_uri=${encodeURIComponent(redirectUri)}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Error desconocido" }));
      return NextResponse.json(
        { error: error.detail || `Pipeline error ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Pipeline API no disponible (${PIPELINE_URL}): ${detail}` },
      { status: 502 }
    );
  }
}
