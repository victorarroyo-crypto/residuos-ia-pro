import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Load an env var with fallback to reading .env files on disk.
 * Needed because Next.js only loads .env.local at startup and
 * the server may restart without the latest vars.
 */
export function loadEnv(name: string): string {
  // 1. process.env (set by Next.js from .env.local at startup)
  if (process.env[name]) {
    return process.env[name]!;
  }

  // 2. Try multiple known .env file locations
  const candidates = [
    resolve(process.cwd(), ".env.local"),          // web/.env.local
    resolve(process.cwd(), ".env"),                 // web/.env
    resolve(process.cwd(), "..", ".env"),            // root .env
    "/home/user/residuos-ia-pro/.env",              // absolute fallback
    "/home/user/residuos-ia-pro/web/.env.local",    // absolute fallback
  ];

  for (const envPath of candidates) {
    try {
      if (!existsSync(envPath)) continue;
      const content = readFileSync(envPath, "utf-8");
      const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(.+)$`, "m");
      const match = content.match(re);
      if (match) return match[1].trim();
    } catch {
      continue;
    }
  }

  console.error(
    `[loadEnv] "${name}" NOT FOUND. process.env set: ${name in process.env}. cwd: ${process.cwd()}`
  );
  return "";
}
