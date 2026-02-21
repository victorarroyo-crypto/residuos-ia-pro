import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { resolve } from "path";

const SCOPES = "https://www.googleapis.com/auth/drive";

function loadGoogleClientId(): string {
  // Try process.env first (from .env.local)
  if (process.env.GOOGLE_CLIENT_ID) {
    return process.env.GOOGLE_CLIENT_ID;
  }
  // Fallback: read from root .env file directly
  try {
    const envPath = resolve(process.cwd(), "..", ".env");
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^GOOGLE_CLIENT_ID=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // ignore
  }
  return "";
}

let _cachedClientId: string | null = null;
function getGoogleClientId(): string {
  if (_cachedClientId === null) {
    _cachedClientId = loadGoogleClientId();
  }
  return _cachedClientId;
}

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

  const clientId = getGoogleClientId();
  if (!clientId) {
    return NextResponse.json(
      { error: "Google Drive no configurado. Falta GOOGLE_CLIENT_ID en .env.local o ../.env" },
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
