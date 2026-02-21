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

export async function GET(request: NextRequest) {
  const consultantId = request.nextUrl.searchParams.get("consultant_id");
  if (!consultantId) {
    return NextResponse.json(
      { error: "consultant_id is required" },
      { status: 400 }
    );
  }

  const supabaseUrl = loadEnvVar("NEXT_PUBLIC_SUPABASE_URL") || loadEnvVar("SUPABASE_URL");
  const serviceKey = loadEnvVar("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Supabase no configurado en el servidor." },
      { status: 503 }
    );
  }

  try {
    const sb = createClient(supabaseUrl, serviceKey);
    const { data, error } = await sb
      .from("consultant_gdrive")
      .select("root_folder_id, folder_mapping, created_at, updated_at")
      .eq("consultant_id", consultantId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ connected: false });
    }

    if (!data) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      root_folder_id: data.root_folder_id,
      connected_at: data.created_at,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error consultando estado: ${detail}` },
      { status: 500 }
    );
  }
}
