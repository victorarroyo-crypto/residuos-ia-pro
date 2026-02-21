import { NextRequest, NextResponse } from "next/server";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "@/lib/env";

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
  const supabase = await createAuthClient();
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

    // Load Google credentials
    const clientId = loadEnv("GOOGLE_CLIENT_ID");
    const clientSecret = loadEnv("GOOGLE_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      settingsUrl.searchParams.set("gdrive", "error");
      settingsUrl.searchParams.set("gdrive_error", "missing_google_credentials");
      return NextResponse.redirect(settingsUrl);
    }

    // Exchange code for tokens directly with Google
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      const errorDetail = tokenData.error_description || tokenData.error || "token_exchange_failed";
      settingsUrl.searchParams.set("gdrive", "error");
      settingsUrl.searchParams.set("gdrive_error", errorDetail);
      return NextResponse.redirect(settingsUrl);
    }

    // Calculate token expiry
    const tokenExpiry = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    // Store tokens in Supabase using service role
    const supabaseUrl = loadEnv("NEXT_PUBLIC_SUPABASE_URL") || loadEnv("SUPABASE_URL");
    const serviceKey = loadEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      settingsUrl.searchParams.set("gdrive", "error");
      settingsUrl.searchParams.set("gdrive_error", "supabase_not_configured");
      return NextResponse.redirect(settingsUrl);
    }

    const sb = createClient(supabaseUrl, serviceKey);

    const { error: dbError } = await sb.from("consultant_gdrive").upsert(
      {
        consultant_id: consultantId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expiry: tokenExpiry,
        folder_mapping: {},
      },
      { onConflict: "consultant_id" }
    );

    if (dbError) {
      settingsUrl.searchParams.set("gdrive", "error");
      settingsUrl.searchParams.set("gdrive_error", "db_save_failed");
      return NextResponse.redirect(settingsUrl);
    }

    settingsUrl.searchParams.set("gdrive", "connected");
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown_error";
    settingsUrl.searchParams.set("gdrive", "error");
    settingsUrl.searchParams.set("gdrive_error", detail);
    return NextResponse.redirect(settingsUrl);
  }
}
