import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from './domain-error';
import { ErrorCode } from './error-codes';
import type { ErrorResponse } from './error-response';

const STATUS_CODES: Record<number, string> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.RATE_LIMITED,
};

interface ClientHttpError {
  status: number;
  type?: string;
}

/** http-errors style errors from Express middleware: a 4xx status and a stable `type`. */
function isClientHttpError(e: unknown): e is ClientHttpError {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

const BODY_PARSER_CODES: Record<string, string> = {
  'entity.too.large': 'PAYLOAD_TOO_LARGE',
  'entity.parse.failed': ErrorCode.VALIDATION_FAILED,
  'encoding.unsupported': ErrorCode.VALIDATION_FAILED,
  'charset.unsupported': ErrorCode.VALIDATION_FAILED,
};

const BODY_PARSER_MESSAGES: Record<string, string> = {
  'entity.too.large': 'The request body is too large.',
  'entity.parse.failed': 'The request body is not valid JSON.',
  'encoding.unsupported': 'The request encoding is not supported.',
  'charset.unsupported': 'The request charset is not supported.',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string | number }>();
    const res = http.getResponse<Response>();
    const requestId = String(req.id ?? res.getHeader('x-request-id') ?? 'unknown');

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_ERROR;
    let message = 'An unexpected error occurred.';
    let details: unknown;

    if (exception instanceof DomainError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? `HTTP_${status}`;
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[] };
        if (Array.isArray(b.message)) {
          message = 'Request validation failed.';
          details = b.message;
        } else if (b.message) {
          message = b.message;
        }
      }
    } else if (isClientHttpError(exception)) {
      // Errors raised by the body parser (payload too large, malformed JSON, bad charset...).
      status = exception.status;
      code = BODY_PARSER_CODES[exception.type ?? ''] ?? STATUS_CODES[status] ?? `HTTP_${status}`;
      message = BODY_PARSER_MESSAGES[exception.type ?? ''] ?? 'The request could not be processed.';
    } else {
      // Unknown/internal errors (including database errors): log fully, never expose.
      this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    }

    const payload: ErrorResponse = {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
    res.status(status).json(payload);
  }
}
