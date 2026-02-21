import { NextRequest, NextResponse } from "next/server";
import { loadEnv } from "@/lib/env";

const SCOPES = "https://www.googleapis.com/auth/drive";

function getOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const consultantId = request.nextUrl.searchParams.get("consultant_id");
  if (!consultantId) {
    return NextResponse.json(
      { error: "consultant_id is required" },
      { status: 400 }
    );
  }

  // Read fresh each time (no caching) to survive server restarts
  const clientId = loadEnv("GOOGLE_CLIENT_ID");
  if (!clientId) {
    return NextResponse.json(
      { error: "Google Drive no configurado. Falta GOOGLE_CLIENT_ID." },
      { status: 501 }
    );
  }

  const origin = getOrigin(request);
  const redirectUri = `${origin}/api/gdrive/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state: consultantId,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;

  return NextResponse.json({ auth_url: authUrl });
}
