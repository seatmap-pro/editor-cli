import { describe, expect, it } from 'vitest';
import { Readable, Writable } from 'node:stream';
import {
  INVALID_REQUEST,
  PARSE_ERROR,
  RpcError,
  decodeRequest,
  errorResponse,
  resultResponse,
  serveStdio,
  toErrorBody,
} from './protocol.js';
import type { JsonRpcRequest, JsonRpcResponse } from './protocol.js';

function collector(): { stream: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0),
  };
}

function decoded(lines: string[]): JsonRpcResponse[] {
  return lines.map((line) => JSON.parse(line) as JsonRpcResponse);
}

describe('decodeRequest', () => {
  it('reads a well-formed request', () => {
    const request = decodeRequest('{"jsonrpc":"2.0","id":7,"method":"ping","params":{"a":1}}');
    expect(request).toEqual({ id: 7, method: 'ping', params: { a: 1 } });
  });

  it('defaults missing params to an empty object', () => {
    expect(decodeRequest('{"jsonrpc":"2.0","id":1,"method":"ping"}').params).toEqual({});
  });

  it('treats a request without an id as a notification', () => {
    expect(
      decodeRequest('{"jsonrpc":"2.0","method":"notifications/initialized"}').id,
    ).toBeUndefined();
  });

  it('treats a null id as a request, not a notification', () => {
    expect(decodeRequest('{"jsonrpc":"2.0","id":null,"method":"ping"}').id).toBeNull();
  });

  it('rejects an id that is neither string, number nor null', () => {
    try {
      decodeRequest('{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}');
      expect.unreachable();
    } catch (error) {
      expect((error as RpcError).code).toBe(INVALID_REQUEST);
    }
  });

  it('keeps a readable id on a later validation failure', () => {
    try {
      decodeRequest('{"jsonrpc":"2.0","id":7,"method":""}');
      expect.unreachable();
    } catch (error) {
      expect((error as RpcError).id).toBe(7);
    }
  });

  it('rejects a body that is not JSON', () => {
    expect(() => decodeRequest('not json')).toThrow(RpcError);
    try {
      decodeRequest('not json');
    } catch (error) {
      expect((error as RpcError).code).toBe(PARSE_ERROR);
    }
  });

  it('rejects a batch array', () => {
    try {
      decodeRequest('[{"jsonrpc":"2.0","id":1,"method":"ping"}]');
      expect.unreachable();
    } catch (error) {
      expect((error as RpcError).code).toBe(INVALID_REQUEST);
    }
  });

  it('rejects another jsonrpc version', () => {
    try {
      decodeRequest('{"jsonrpc":"1.0","id":1,"method":"ping"}');
      expect.unreachable();
    } catch (error) {
      expect((error as RpcError).code).toBe(INVALID_REQUEST);
    }
  });

  it('rejects a message with no method', () => {
    try {
      decodeRequest('{"jsonrpc":"2.0","id":1}');
      expect.unreachable();
    } catch (error) {
      expect((error as RpcError).code).toBe(INVALID_REQUEST);
    }
  });
});

describe('response envelopes', () => {
  it('builds a result envelope', () => {
    expect(resultResponse(3, { ok: true })).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { ok: true },
    });
  });

  it('builds an error envelope', () => {
    expect(errorResponse(null, { code: PARSE_ERROR, message: 'bad' })).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: PARSE_ERROR, message: 'bad' },
    });
  });

  it('maps an unexpected failure to an internal error', () => {
    expect(toErrorBody(new Error('boom'))).toEqual({ code: -32603, message: 'boom' });
  });
});

describe('serveStdio', () => {
  it('answers one line per request and ignores blank lines', async () => {
    const input = Readable.from([
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
      '\n',
      '{"jsonrpc":"2.0","id":2,"method":"ping"}\n',
    ]);
    const { stream, lines } = collector();

    await serveStdio(
      async (request: JsonRpcRequest) =>
        request.id === undefined ? undefined : resultResponse(request.id, { seen: request.method }),
      input,
      stream,
    );

    expect(decoded(lines())).toEqual([
      { jsonrpc: '2.0', id: 1, result: { seen: 'ping' } },
      { jsonrpc: '2.0', id: 2, result: { seen: 'ping' } },
    ]);
  });

  it('reports a malformed line without stopping the loop', async () => {
    const input = Readable.from(['{oops\n', '{"jsonrpc":"2.0","id":9,"method":"ping"}\n']);
    const { stream, lines } = collector();

    await serveStdio(
      async (request: JsonRpcRequest) =>
        request.id === undefined ? undefined : resultResponse(request.id, {}),
      input,
      stream,
    );

    const responses = decoded(lines());
    expect(responses[0]?.id).toBeNull();
    expect(responses[0]?.error?.code).toBe(PARSE_ERROR);
    expect(responses[1]?.id).toBe(9);
  });

  it('turns a thrown handler failure into an error response', async () => {
    const input = Readable.from(['{"jsonrpc":"2.0","id":4,"method":"ping"}\n']);
    const { stream, lines } = collector();

    await serveStdio(
      async () => {
        throw new RpcError(INVALID_REQUEST, 'nope');
      },
      input,
      stream,
    );

    expect(decoded(lines())[0]?.error).toEqual({ code: INVALID_REQUEST, message: 'nope' });
  });

  it('stays silent when a notification handler throws', async () => {
    const input = Readable.from(['{"jsonrpc":"2.0","method":"notifications/cancelled"}\n']);
    const { stream, lines } = collector();

    await serveStdio(
      async () => {
        throw new Error('ignored');
      },
      input,
      stream,
    );

    expect(lines()).toEqual([]);
  });
});

describe('serveStdio dispatch', () => {
  it('echoes a readable id on a decode failure instead of null', async () => {
    const input = Readable.from(['{"jsonrpc":"2.0","id":7,"method":""}\n']);
    const { stream, lines } = collector();

    await serveStdio(async () => undefined, input, stream);

    expect(decoded(lines())[0]?.id).toBe(7);
  });

  it('answers a null-id request rather than staying silent', async () => {
    const input = Readable.from(['{"jsonrpc":"2.0","id":null,"method":"ping"}\n']);
    const { stream, lines } = collector();

    await serveStdio(
      async (request: JsonRpcRequest) =>
        request.id === undefined ? undefined : resultResponse(request.id, { ok: true }),
      input,
      stream,
    );

    expect(decoded(lines())).toEqual([{ jsonrpc: '2.0', id: null, result: { ok: true } }]);
  });

  it('does not let a slow request block a later one', async () => {
    const input = Readable.from([
      '{"jsonrpc":"2.0","id":1,"method":"slow"}\n',
      '{"jsonrpc":"2.0","id":2,"method":"ping"}\n',
    ]);
    const { stream, lines } = collector();

    await serveStdio(
      async (request: JsonRpcRequest) => {
        if (request.method === 'slow') {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return request.id === undefined ? undefined : resultResponse(request.id, {});
      },
      input,
      stream,
    );

    expect(decoded(lines()).map((response) => response.id)).toEqual([2, 1]);
  });
});
