import { configureOutput } from '../cli/output.js';
import { boolOption } from '../cli/args.js';
import { serve } from '../mcp/server.js';
import { createContext } from './context.js';

const MCP_OPTIONS = {
  'allow-write': { type: 'boolean' as const },
};

export async function mcpCommand(argv: readonly string[]): Promise<void> {
  const context = createContext(argv, MCP_OPTIONS);
  configureOutput({ json: true });

  await serve(
    {
      client: context.client,
      target: context.target,
      allowWrite: boolOption(context.values, 'allow-write'),
      cwd: process.cwd(),
    },
    process.stdin,
    process.stdout,
  );
}
