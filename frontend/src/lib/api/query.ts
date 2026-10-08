export type QueryValue = string | number | boolean | Date | null | undefined;
export type Query = Record<string, QueryValue | readonly QueryValue[]>;

/**
 * Builds a query string safely: values are always percent-encoded (never concatenated), `undefined` and
 * `null` are skipped, arrays repeat the key, dates become ISO 8601, and keys are sorted so the same query
 * always produces the same URL (stable caching and tests). Returns "" or a string starting with "?".
 */
export function serializeQuery(query: Query | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const raw = query[key];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values as QueryValue[]) {
      if (value === undefined || value === null) continue;
      params.append(key, value instanceof Date ? value.toISOString() : String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Substitutes {name} placeholders with percent-encoded values; a missing value is a programming error. */
export function fillPath(
  template: string,
  params: Record<string, string | number> | undefined,
): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === "")
      throw new Error(`Missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(String(value));
  });
}
