import { CliError, describeError } from '../cli/errors.js';
import { packageVersion } from '../cli/version.js';
import {
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  RpcError,
  resultResponse,
  serveStdio,
} from './protocol.js';
import type { JsonRpcResponse, RequestHandler } from './protocol.js';
import { availableTools, findTool } from './tools.js';
import type { McpContext } from './tools.js';

export const SERVER_NAME = 'seatmap-editor-cli';
export const SERVER_TITLE = 'Seatmap editor CLI';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05'] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const INSTRUCTIONS = `Tools for a Seatmap.pro editor instance.

Reads go through the same REST API the editor UI uses, so they see exactly what the
signed-in user sees. seatmap_validate_spec compiles a build spec offline and is the
cheapest way to check a layout before writing it.

Writes are disabled unless the server was started with --allow-write, and a build
against a production host is refused outright.`;

function negotiateVersion(requested: unknown): string {
  if (typeof requested !== 'string') return LATEST_PROTOCOL_VERSION;
  const supported: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;
  return supported.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

function describeToolFailure(error: unknown): string {
  const described = describeError(error);
  const hint = error instanceof CliError ? error.hint : undefined;
  return hint === undefined ? described : `${described}\n${hint}`;
}

interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function textResult(text: string, isError = false): ToolCallResult {
  return { content: [{ type: 'text', text }], isError };
}

async function callTool(
  params: Record<string, unknown>,
  context: McpContext,
): Promise<ToolCallResult> {
  const name = params['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new RpcError(INVALID_PARAMS, 'tools/call requires a tool "name"');
  }

  const rawArguments = params['arguments'];
  const args =
    typeof rawArguments === 'object' && rawArguments !== null && !Array.isArray(rawArguments)
      ? (rawArguments as Record<string, unknown>)
      : {};

  const tool = findTool(name, context.allowWrite);

  try {
    if (tool.authOptional !== true) context.client.requireAuth();
    const value = await tool.run(args, context);
    return textResult(JSON.stringify(value, null, 2));
  } catch (error) {
    if (error instanceof RpcError) throw error;
    return textResult(describeToolFailure(error), true);
  }
}

export function createHandler(context: McpContext): RequestHandler {
  return async (request): Promise<JsonRpcResponse | undefined> => {
    const { id, method, params } = request;

    if (method.startsWith('notifications/')) return undefined;

    if (id === undefined) return undefined;

    switch (method) {
      case 'initialize':
        return resultResponse(id, {
          protocolVersion: negotiateVersion(params['protocolVersion']),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: packageVersion() },
          instructions: INSTRUCTIONS,
        });

      case 'ping':
        return resultResponse(id, {});

      case 'tools/list':
        return resultResponse(id, {
          tools: availableTools(context.allowWrite).map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: !tool.mutating, destructiveHint: tool.mutating },
          })),
        });

      case 'tools/call':
        return resultResponse(id, await callTool(params, context));

      default:
        throw new RpcError(METHOD_NOT_FOUND, `Unsupported method "${method}"`);
    }
  };
}

export async function serve(
  context: McpContext,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  await serveStdio(createHandler(context), input, output);
}
