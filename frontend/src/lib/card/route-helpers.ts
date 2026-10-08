import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { checkCsrf } from "@/lib/auth/csrf";
import { allowedOrigins, plainError } from "@/lib/auth/session-server";

/** Customer-card endpoints are only for this app's own pages: refuse anything that is not a same-origin call. */
export function refuseForeignRequest(request: NextRequest): NextResponse | null {
  const csrf = checkCsrf({
    method: request.method,
    headers: request.headers,
    allowedOrigins: allowedOrigins(request),
  });
  return csrf.ok ? null : plainError(403, "FORBIDDEN", "Request refused.");
}

const MAX_BODY_BYTES = 4 * 1024;

/** Reads a small JSON body and checks it against a schema; null means "reject with 400". */
export async function readBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<z.infer<S> | null> {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const invalidRequest = () =>
  plainError(400, "VALIDATION_FAILED", "Request validation failed.");
