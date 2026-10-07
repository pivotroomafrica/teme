import type { ErrorCode } from './error-codes';

/** Business-rule failure with a stable, client-safe code. */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus = 422,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
