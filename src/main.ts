import { ApiError, CliError, EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from './cli/errors.js';
import { fail, info } from './cli/output.js';
import { packageVersion } from './cli/version.js';
import { loginCommand, logoutCommand, profilesCommand, whoamiCommand } from './commands/auth.js';
import { buildCommand } from './commands/build.js';
import { eventsCommand } from './commands/events.js';
import { helpCommand } from './commands/help.js';
import { libraryCommand } from './commands/library.js';
import { mcpCommand } from './commands/mcp.js';
import { orgsCommand } from './commands/orgs.js';
import { schemasCommand } from './commands/schemas.js';
import { venuesCommand } from './commands/venues.js';

const HELP_FLAGS = new Set(['-h', '--help', 'help']);
const VERSION_FLAGS = new Set(['-V', '--version', 'version']);

async function dispatch(argv: readonly string[]): Promise<number> {
  const command = argv[0];

  if (command === undefined || HELP_FLAGS.has(command)) {
    helpCommand();
    return EXIT_OK;
  }

  if (VERSION_FLAGS.has(command)) {
    info(packageVersion());
    return EXIT_OK;
  }

  const rest = argv.slice(1);

  if (rest.some((arg) => arg === '-h' || arg === '--help')) {
    helpCommand();
    return EXIT_OK;
  }

  if (rest.some((arg) => arg === '-V' || arg === '--version')) {
    info(packageVersion());
    return EXIT_OK;
  }

  switch (command) {
    case 'login':
      await loginCommand(rest);
      return EXIT_OK;
    case 'logout':
      await logoutCommand(rest);
      return EXIT_OK;
    case 'whoami':
      await whoamiCommand(rest);
      return EXIT_OK;
    case 'profiles':
      await profilesCommand(rest);
      return EXIT_OK;
    case 'orgs':
      await orgsCommand(rest);
      return EXIT_OK;
    case 'library':
      await libraryCommand(rest);
      return EXIT_OK;
    case 'venues':
      await venuesCommand(rest);
      return EXIT_OK;
    case 'schemas':
      await schemasCommand(rest);
      return EXIT_OK;
    case 'events':
      await eventsCommand(rest);
      return EXIT_OK;
    case 'build':
      await buildCommand(rest);
      return EXIT_OK;
    case 'mcp':
      await mcpCommand(rest);
      return EXIT_OK;
    default:
      fail(`Unknown command "${command}"`, 'Run "seatmap help" to see available commands.');
      return EXIT_USAGE;
  }
}

function describe(error: unknown): { message: string; hint?: string; code: number } {
  if (error instanceof ApiError) {
    const body = error.body.trim();
    return {
      message: body.length > 0 ? `${error.message}\n${body}` : error.message,
      hint: error.hint,
      code: error.exitCode,
    };
  }
  if (error instanceof CliError) {
    return { message: error.message, hint: error.hint, code: error.exitCode };
  }
  if (error instanceof Error) {
    return { message: error.message, code: EXIT_FAILURE };
  }
  return { message: String(error), code: EXIT_FAILURE };
}

export async function run(argv: readonly string[]): Promise<number> {
  try {
    return await dispatch(argv);
  } catch (error) {
    const described = describe(error);
    fail(described.message, described.hint);
    return described.code;
  }
}

process.exitCode = await run(process.argv.slice(2));
