import { UsageError } from '../cli/errors.js';
import { prompt } from '../cli/confirm.js';
import { stringOption } from '../cli/args.js';
import { dim, emitJson, info, isJsonMode, output, success } from '../cli/output.js';
import { isProductionTarget } from '../config/guards.js';
import {
  deleteProfile,
  listProfiles,
  readConfig,
  saveProfile,
  writeConfig,
} from '../config/profiles.js';
import { createContext, authenticatedContext } from './context.js';

const LOGIN_OPTIONS = {
  email: { type: 'string' as const },
  password: { type: 'string' as const },
};

export async function loginCommand(argv: readonly string[]): Promise<void> {
  const context = createContext(argv, LOGIN_OPTIONS);

  const email =
    stringOption(context.values, 'email') ?? process.env.SEATMAP_EMAIL ?? (await prompt('Email'));

  const password =
    stringOption(context.values, 'password') ??
    process.env.SEATMAP_PASSWORD ??
    (await prompt('Password', { mask: true }));

  if (email.length === 0 || password.length === 0) {
    throw new UsageError('Email and password are required.');
  }

  const response = await context.client.login(email, password);

  saveProfile(context.target.profileName, {
    baseUrl: context.target.baseUrl,
    token: response.token,
    refreshToken: response.refreshToken,
    orgId: context.target.orgId,
    user: {
      id: response.user?.id,
      email: response.user?.email,
      name: response.user?.name,
    },
  });

  if (isJsonMode()) {
    emitJson({
      profile: context.target.profileName,
      baseUrl: context.target.baseUrl,
      user: response.user,
    });
    return;
  }

  success(
    `Logged in to ${context.target.baseUrl} as ${response.user?.email ?? email} (profile "${context.target.profileName}")`,
  );
  if (isProductionTarget(context.target.baseUrl)) {
    info(dim('This profile points at a production host. Mutations will require --force.'));
  }
}

export async function logoutCommand(argv: readonly string[]): Promise<void> {
  const context = createContext(argv);
  await context.client.logout();
  const removed = deleteProfile(context.target.profileName);
  if (removed) {
    success(`Removed profile "${context.target.profileName}"`);
  } else {
    info(`No stored profile named "${context.target.profileName}"`);
  }
}

export async function whoamiCommand(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv);
  const response = await context.client.currentUser();

  if (!response.success) {
    throw new UsageError('Session is not valid.', 'Run "seatmap login" again.');
  }

  if (isJsonMode()) {
    emitJson({
      profile: context.target.profileName,
      baseUrl: context.target.baseUrl,
      production: isProductionTarget(context.target.baseUrl),
      user: response.user,
    });
    return;
  }

  info(`Profile     ${context.target.profileName}`);
  info(`Endpoint    ${context.target.baseUrl}`);
  info(`Production  ${isProductionTarget(context.target.baseUrl) ? 'yes' : 'no'}`);
  info(`User        ${response.user?.email ?? 'unknown'}`);
  if (context.target.orgId !== undefined) info(`Org         ${context.target.orgId}`);
}

export async function profilesCommand(argv: readonly string[]): Promise<void> {
  const context = createContext(argv);
  const sub = context.positionals[0];

  if (sub === 'use') {
    const name = context.positionals[1];
    if (!name) throw new UsageError('Usage: seatmap profiles use <name>');
    const config = readConfig();
    if (!config.profiles[name]) {
      throw new UsageError(`No profile named "${name}"`, 'Run "seatmap profiles" to list them.');
    }
    config.current = name;
    writeConfig(config);
    success(`Switched to profile "${name}"`);
    return;
  }

  if (sub !== undefined && sub !== 'list') {
    throw new UsageError(
      `Unknown subcommand "${sub}"`,
      'Usage: seatmap profiles [list|use <name>]',
    );
  }

  const profiles = listProfiles().map((entry) => ({
    name: entry.name,
    current: entry.current,
    baseUrl: entry.profile.baseUrl,
    user: entry.profile.user?.email ?? '',
    production: isProductionTarget(entry.profile.baseUrl),
  }));

  output(profiles, [
    { header: '', value: (row) => (row.current ? '*' : ' ') },
    { header: 'NAME', value: (row) => row.name },
    { header: 'ENDPOINT', value: (row) => row.baseUrl },
    { header: 'USER', value: (row) => row.user },
    { header: 'PROD', value: (row) => (row.production ? 'yes' : 'no') },
  ]);
}
