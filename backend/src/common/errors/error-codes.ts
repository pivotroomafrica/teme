export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** Built-in codes plus module-specific codes (e.g. COOLDOWN_ACTIVE) added later. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode] | (string & {});
