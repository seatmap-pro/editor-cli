import { ApiClient } from '../api/client.js';
import { boolOption, numberOption, parseCommandArgs, stringOption } from '../cli/args.js';
import type { OptionSpecs, OptionValues } from '../cli/args.js';
import { configureOutput } from '../cli/output.js';
import { resolveTarget } from '../config/profiles.js';
import type { ResolvedTarget } from '../config/profiles.js';

export interface CommandContext {
  client: ApiClient;
  values: OptionValues;
  positionals: string[];
  target: ResolvedTarget;
  yes: boolean;
  force: boolean;
}

export function createContext(argv: readonly string[], options: OptionSpecs = {}): CommandContext {
  const { positionals, values } = parseCommandArgs(argv, options);

  configureOutput({
    json: boolOption(values, 'json'),
    verbose: boolOption(values, 'verbose'),
  });

  const target = resolveTarget({
    profile: stringOption(values, 'profile'),
    url: stringOption(values, 'url'),
    org: numberOption(values, 'org'),
  });

  const client = new ApiClient({
    baseUrl: target.baseUrl,
    token: target.token,
    refreshToken: target.refreshToken,
    orgId: target.orgId,
    profileName: target.profileName,
  });

  return {
    client,
    values,
    positionals,
    target,
    yes: boolOption(values, 'yes'),
    force: boolOption(values, 'force'),
  };
}

export function authenticatedContext(
  argv: readonly string[],
  options: OptionSpecs = {},
): CommandContext {
  const context = createContext(argv, options);
  context.client.requireAuth();
  return context;
}
