import "server-only";
import { assertNoPublicSecrets, parseServerEnv, type ServerEnv } from "./env";

let cached: ServerEnv | undefined;

/** Validated server-only configuration. Throws once, at first use, with a readable list of problems. */
export function getServerEnv(): ServerEnv {
  if (!cached) {
    assertNoPublicSecrets(process.env);
    cached = parseServerEnv(process.env);
  }
  return cached;
}
