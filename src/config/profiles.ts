import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliError } from '../cli/errors.js';

export interface ProfileUser {
  id?: number;
  email?: string;
  name?: string;
}

export interface Profile {
  baseUrl: string;
  token?: string;
  refreshToken?: string;
  orgId?: number;
  user?: ProfileUser;
}

export interface ConfigFile {
  current?: string;
  productionHosts?: string[];
  profiles: Record<string, Profile>;
}

export const DEFAULT_BASE_URL = 'http://localhost:8080';
export const DEFAULT_PROFILE = 'default';

export function configPath(): string {
  const override = process.env.SEATMAP_CLI_CONFIG;
  if (override && override.length > 0) return override;
  const base =
    process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.length > 0
      ? process.env.XDG_CONFIG_HOME
      : join(homedir(), '.config');
  return join(base, 'seatmap', 'cli.json');
}

export function readConfig(): ConfigFile {
  const path = configPath();
  if (!existsSync(path)) return { profiles: {} };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return { profiles: {} };
    const config = parsed as Partial<ConfigFile>;
    return {
      current: config.current,
      productionHosts: config.productionHosts,
      profiles: config.profiles ?? {},
    };
  } catch (error) {
    throw new CliError(
      `Config file at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      1,
      'Fix or delete the file, then run "seatmap login" again.',
    );
  }
}

export function writeConfig(config: ConfigFile): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function resolveProfileName(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  const fromEnv = process.env.SEATMAP_PROFILE;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return readConfig().current ?? DEFAULT_PROFILE;
}

export function getProfile(name: string): Profile | undefined {
  return readConfig().profiles[name];
}

export function saveProfile(name: string, profile: Profile, makeCurrent = true): void {
  const config = readConfig();
  config.profiles[name] = profile;
  if (makeCurrent) config.current = name;
  writeConfig(config);
}

export function updateProfile(name: string, patch: Partial<Profile>): void {
  const config = readConfig();
  const existing = config.profiles[name];
  if (!existing) return;
  config.profiles[name] = { ...existing, ...patch };
  writeConfig(config);
}

export function deleteProfile(name: string): boolean {
  const config = readConfig();
  if (!config.profiles[name]) return false;
  delete config.profiles[name];
  if (config.current === name) delete config.current;
  writeConfig(config);
  return true;
}

export function listProfiles(): Array<{ name: string; profile: Profile; current: boolean }> {
  const config = readConfig();
  return Object.entries(config.profiles).map(([name, profile]) => ({
    name,
    profile,
    current: config.current === name,
  }));
}

export function normalizeBaseUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

export interface ResolvedTarget {
  profileName: string;
  baseUrl: string;
  token: string | undefined;
  refreshToken: string | undefined;
  orgId: number | undefined;
}

export function resolveTarget(options: {
  profile?: string;
  url?: string;
  org?: number;
}): ResolvedTarget {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);

  const baseUrl = normalizeBaseUrl(
    options.url ?? process.env.SEATMAP_API_URL ?? profile?.baseUrl ?? DEFAULT_BASE_URL,
  );

  const envToken = process.env.SEATMAP_TOKEN;

  return {
    profileName,
    baseUrl,
    token: envToken && envToken.length > 0 ? envToken : profile?.token,
    refreshToken: profile?.refreshToken,
    orgId: options.org ?? profile?.orgId,
  };
}
