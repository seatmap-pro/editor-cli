export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_AUTH = 3;
export const EXIT_REFUSED = 4;
export const EXIT_INDETERMINATE = 5;

export class CliError extends Error {
  readonly exitCode: number;
  readonly hint: string | undefined;

  constructor(message: string, exitCode: number = EXIT_FAILURE, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export class UsageError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, EXIT_USAGE, hint);
    this.name = 'UsageError';
  }
}

export class AuthError extends CliError {
  constructor(message: string, hint = 'Run "seatmap login" first.') {
    super(message, EXIT_AUTH, hint);
    this.name = 'AuthError';
  }
}

export class RefusedError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, EXIT_REFUSED, hint);
    this.name = 'RefusedError';
  }
}

export class IndeterminateError extends CliError {
  constructor(message: string, hint = 'Check the server state before retrying.') {
    super(message, EXIT_INDETERMINATE, hint);
    this.name = 'IndeterminateError';
  }
}

export class ApiError extends CliError {
  readonly status: number;
  readonly body: string;

  constructor(method: string, path: string, status: number, body: string) {
    super(`${method} ${path} failed with HTTP ${status}`, EXIT_FAILURE);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const GATEWAY_STATUSES = new Set([502, 503, 504]);

export function leavesWriteUnconfirmed(error: unknown): boolean {
  if (error instanceof IndeterminateError) return true;
  if (error instanceof UsageError || error instanceof AuthError) return false;
  if (error instanceof RefusedError) return false;
  if (error instanceof ApiError) return GATEWAY_STATUSES.has(error.status);
  return true;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body.trim();
    return body.length > 0 ? `${error.message}: ${body}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
