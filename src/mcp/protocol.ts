import { createInterface } from 'node:readline';

export const JSONRPC_VERSION = '2.0';

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  id: JsonRpcId | undefined;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: string;
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorBody;
}

export class RpcError extends Error {
  readonly code: number;
  readonly id: JsonRpcId | undefined;

  constructor(code: number, message: string, id?: JsonRpcId) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.id = id;
  }
}

interface RawMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export function decodeRequest(line: string): JsonRpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new RpcError(PARSE_ERROR, error instanceof Error ? error.message : String(error));
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RpcError(INVALID_REQUEST, 'A JSON-RPC message must be a single object');
  }

  const message = parsed as RawMessage;

  let id: JsonRpcId | undefined;
  if (Object.prototype.hasOwnProperty.call(message, 'id')) {
    const raw = message.id;
    if (typeof raw !== 'string' && typeof raw !== 'number' && raw !== null) {
      throw new RpcError(INVALID_REQUEST, 'A JSON-RPC id must be a string, a number or null');
    }
    id = raw;
  }

  if (message.jsonrpc !== JSONRPC_VERSION) {
    throw new RpcError(
      INVALID_REQUEST,
      `Unsupported jsonrpc version ${String(message.jsonrpc)}`,
      id,
    );
  }
  if (typeof message.method !== 'string' || message.method.length === 0) {
    throw new RpcError(INVALID_REQUEST, 'A JSON-RPC message must carry a method', id);
  }

  const params =
    typeof message.params === 'object' && message.params !== null && !Array.isArray(message.params)
      ? (message.params as Record<string, unknown>)
      : {};

  return { id, method: message.method, params };
}

export function resultResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function errorResponse(id: JsonRpcId, error: JsonRpcErrorBody): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

export function toErrorBody(error: unknown): JsonRpcErrorBody {
  if (error instanceof RpcError) return { code: error.code, message: error.message };
  return { code: INTERNAL_ERROR, message: error instanceof Error ? error.message : String(error) };
}

export type RequestHandler = (request: JsonRpcRequest) => Promise<JsonRpcResponse | undefined>;

export async function serveStdio(
  handle: RequestHandler,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  const send = (message: JsonRpcResponse): void => {
    output.write(`${JSON.stringify(message)}\n`);
  };

  const inFlight = new Set<Promise<void>>();

  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let request: JsonRpcRequest;
    try {
      request = decodeRequest(trimmed);
    } catch (error) {
      const id = error instanceof RpcError && error.id !== undefined ? error.id : null;
      send(errorResponse(id, toErrorBody(error)));
      continue;
    }

    const task = (async (): Promise<void> => {
      try {
        const response = await handle(request);
        if (response !== undefined) send(response);
      } catch (error) {
        if (request.id === undefined) return;
        send(errorResponse(request.id, toErrorBody(error)));
      }
    })();

    inFlight.add(task);
    void task.finally(() => inFlight.delete(task));
  }

  await Promise.all(inFlight);
}
