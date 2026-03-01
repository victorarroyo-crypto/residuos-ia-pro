/**
 * Shared helpers for calling the Python pipeline API.
 *
 * Every Next.js API route that proxies to the Python backend should use
 * these instead of inlining PIPELINE_URL and headers.
 */

export const PIPELINE_URL =
  process.env.PIPELINE_API_URL || "http://localhost:8000";

const PIPELINE_API_KEY = process.env.PIPELINE_API_KEY || "";

/**
 * Build headers for a request to the pipeline API.
 *
 * Always includes `X-API-Key` when configured.
 * Pass extra headers (e.g. `{ "Content-Type": "application/json" }`) to merge.
 */
export function pipelineHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (PIPELINE_API_KEY) {
    headers["X-API-Key"] = PIPELINE_API_KEY;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}
