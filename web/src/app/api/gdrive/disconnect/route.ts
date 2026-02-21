import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvVar(name: string): string {
  if (process.env[name]) return process.env[name]!;
  try {
    const envPath = resolve(process.cwd(), "..", ".env");
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));
    if (match) return match[1].trim();
  } catch {
    // ignore
  }
  return "";
}

export async function DELETE(request: NextRequest) {
  const consultantId = request.nextUrl.searchParams.get("consultant_id");
  if (!consultantId) {
    return NextResponse.json(
      { error: "consultant_id is required" },
      { status: 400 }
    );
  }

  try {
    const supabaseUrl = loadEnvVar("NEXT_PUBLIC_SUPABASE_URL") || loadEnvVar("SUPABASE_URL");
    const serviceKey = loadEnvVar("SUPABASE_SERVICE_ROLE_KEY");
    const sb = createClient(supabaseUrl, serviceKey);

    await sb
      .from("consultant_gdrive")
      .delete()
      .eq("consultant_id", consultantId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error desconectando: ${detail}` },
      { status: 500 }
    );
  }
}
