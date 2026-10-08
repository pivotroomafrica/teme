import type { components, paths } from "./generated/schema";

/** Generated DTO types by name, e.g. Schemas["LoginDto"]. Source of truth for request bodies. */
export type Schemas = components["schemas"];

/** The backend paths without the /api/v1 prefix (the transport's base URL carries it). */
export type ApiPath = keyof paths extends infer P
  ? P extends `/api/v1${infer R}`
    ? R
    : never
  : never;

type FullPath<P extends ApiPath> = `/api/v1${P}` & keyof paths;
type Method = "get" | "post" | "put" | "patch" | "delete";

export type OperationOf<P extends ApiPath, M extends Method> = paths[FullPath<P>][M];

type JsonContent<T> = T extends { content: { "application/json": infer J } } ? J : never;

/** The JSON request body the backend documents for an operation. */
export type RequestBody<P extends ApiPath, M extends Method> =
  OperationOf<P, M> extends { requestBody?: infer B } ? JsonContent<NonNullable<B>> : never;

/** The documented success body (200/201). `never` when the spec documents none: refine it in lib/api/contract. */
export type ResponseBody<P extends ApiPath, M extends Method> =
  OperationOf<P, M> extends { responses: infer R }
    ? R extends { 200: infer Ok }
      ? JsonContent<Ok>
      : R extends { 201: infer Created }
        ? JsonContent<Created>
        : never
    : never;
