import type { Messages } from "./messages/en";

type Paths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every valid dotted key, e.g. "errors.genericTitle". Typos fail the type check. */
export type MessageKey = Paths<Messages>;
export type TranslateParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: TranslateParams) => string;

function lookup(messages: unknown, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Builds a translate function. A key missing from the active dictionary falls back to English; during
 * development `onMissing` is told so the gap is visible instead of silently showing English.
 */
export function createTranslator(options: {
  messages: Partial<Messages> | Record<string, unknown>;
  fallback: Messages;
  onMissing?: (key: string) => void;
}): Translate {
  return (key, params) => {
    const own = lookup(options.messages, key);
    if (own !== undefined) return interpolate(own, params);
    options.onMissing?.(key);
    const fallback = lookup(options.fallback, key);
    return interpolate(fallback ?? key, params);
  };
}

/** Subset of the dictionary sent to the browser, so a page only ships the namespaces it uses. */
export function pickNamespaces<N extends keyof Messages>(
  messages: Messages,
  namespaces: readonly N[],
): Pick<Messages, N> {
  const out = {} as Pick<Messages, N>;
  for (const ns of namespaces) out[ns] = messages[ns];
  return out;
}
