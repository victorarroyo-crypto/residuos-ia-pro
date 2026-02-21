import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PIPELINE_URL = process.env.PIPELINE_API_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state"); // consultant_id
  const error = request.nextUrl.searchParams.get("error");

  const settingsUrl = new URL("/dashboard/settings", request.url);

  // Handle Google OAuth errors
  if (error) {
    settingsUrl.searchParams.set("gdrive", "error");
    settingsUrl.searchParams.set("gdrive_error", error);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code) {
    settingsUrl.searchParams.set("gdrive", "error");
    settingsUrl.searchParams.set("gdrive_error", "no_code");
    return NextResponse.redirect(settingsUrl);
  }

  // Get current user from Supabase auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const consultantId = state || user?.id;
  if (!consultantId) {
    settingsUrl.searchParams.set("gdrive", "error");
    settingsUrl.searchParams.set("gdrive_error", "no_user");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    // Build the redirect_uri that was used in the auth request (must match)
    const forwardedHost = request.headers.get("x-forwarded-host");
    const origin = forwardedHost
      ? `${request.headers.get("x-forwarded-proto") || "https"}://${forwardedHost}`
      : request.nextUrl.origin;
    const redirectUri = `${origin}/api/gdrive/callback`;

    // Exchange code for tokens via Python backend
    const response = await fetch(`${PIPELINE_URL}/api/gdrive/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        consultant_id: consultantId,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Exchange failed" }));
      settingsUrl.searchParams.set("gdrive", "error");
      settingsUrl.searchParams.set("gdrive_error", err.detail || "exchange_failed");
      return NextResponse.redirect(settingsUrl);
    }

    settingsUrl.searchParams.set("gdrive", "connected");
    return NextResponse.redirect(settingsUrl);
  } catch {
    settingsUrl.searchParams.set("gdrive", "error");
    settingsUrl.searchParams.set("gdrive_error", "pipeline_unavailable");
    return NextResponse.redirect(settingsUrl);
  }
}
