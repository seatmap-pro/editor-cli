import { ApiError, AuthError, CliError, EXIT_FAILURE, IndeterminateError } from '../cli/errors.js';
import { detail } from '../cli/output.js';
import { getProfile, updateProfile } from '../config/profiles.js';
import type { LoginResponse } from './types.js';

function describeFetchFailure(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message.length > 0) return cause.message;
    return error.message;
  }
  return String(error);
}

export type QueryValue = string | number | boolean | undefined;

async function requestWithoutHeaderTimeout(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<Response> {
  const { request: httpRequest } = await import('node:http');
  const { request: httpsRequest } = await import('node:https');
  const target = new URL(url);
  const send = target.protocol === 'http:' ? httpRequest : httpsRequest;

  return new Promise<Response>((resolve, reject) => {
    const outgoing = send(target, { method, headers }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const status = incoming.statusCode ?? 500;
        const text = Buffer.concat(chunks).toString('utf8');
        const bodiless = status === 204 || status === 205 || status === 304;
        resolve(new Response(bodiless ? null : text, { status }));
      });
      incoming.on('error', reject);
    });

    outgoing.setTimeout(LONG_RUNNING_IDLE_TIMEOUT_MS, () => {
      const seconds = Math.round(LONG_RUNNING_IDLE_TIMEOUT_MS / 1000);
      outgoing.destroy(
        new IndeterminateError(
          `${method} ${target.pathname} sent no data for ${seconds}s and was abandoned. ` +
            'The server may still have applied it.',
        ),
      );
    });
    outgoing.on('error', reject);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  withOrg?: boolean;
  anonymous?: boolean;
  accept?: string;
  longRunning?: boolean;
}

const LONG_RUNNING_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  refreshToken?: string;
  orgId?: number;
  profileName?: string;
  persistTokens?: boolean;
}

export class ApiClient {
  readonly baseUrl: string;
  readonly orgId: number | undefined;

  private token: string | undefined;
  private refreshToken: string | undefined;
  private refreshFailure: string | undefined;
  private readonly profileName: string | undefined;
  private readonly persistTokens: boolean;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.refreshToken = options.refreshToken;
    this.orgId = options.orgId;
    this.profileName = options.profileName;
    this.persistTokens = options.persistTokens ?? true;
  }

  requireAuth(): void {
    if (!this.token) {
      throw new AuthError(`Not authenticated against ${this.baseUrl}.`);
    }
  }

  private buildUrl(path: string, options: RequestOptions): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    const query = { ...(options.query ?? {}) };
    if (options.withOrg !== false && this.orgId !== undefined && query['orgId'] === undefined) {
      query['orgId'] = this.orgId;
    }
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private headers(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = { Accept: options.accept ?? 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!options.anonymous && this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  private async exchangeRefreshToken(refreshToken: string): Promise<LoginResponse | string> {
    const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) return `HTTP ${response.status} ${text.trim()}`.trim();

    let payload: LoginResponse;
    try {
      payload = JSON.parse(text) as LoginResponse;
    } catch {
      return `refresh returned a non-JSON body: ${text.slice(0, 200)}`;
    }
    if (!payload.token) return payload.error ?? 'refresh returned no access token';
    return payload;
  }

  private async attemptRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    detail('Access token rejected, attempting refresh');

    let outcome = await this.exchangeRefreshToken(this.refreshToken);

    if (typeof outcome === 'string' && this.profileName) {
      const stored = getProfile(this.profileName)?.refreshToken;
      if (stored && stored !== this.refreshToken) {
        detail('Refresh rejected, retrying with the refresh token stored on disk');
        outcome = await this.exchangeRefreshToken(stored);
      }
    }

    if (typeof outcome === 'string') {
      this.refreshFailure = outcome;
      return false;
    }

    this.refreshFailure = undefined;
    this.token = outcome.token;
    if (outcome.refreshToken) this.refreshToken = outcome.refreshToken;

    if (this.persistTokens && this.profileName) {
      updateProfile(this.profileName, {
        token: this.token,
        refreshToken: this.refreshToken,
      });
    }
    return true;
  }

  private async send(
    method: string,
    path: string,
    options: RequestOptions,
    allowRefresh: boolean,
  ): Promise<Response> {
    const url = this.buildUrl(path, options);
    detail(`${method} ${url}`);

    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);

    let response: Response;
    try {
      response = options.longRunning
        ? await requestWithoutHeaderTimeout(url, method, this.headers(options), payload)
        : await fetch(url, { method, headers: this.headers(options), body: payload });
    } catch (error) {
      if (error instanceof IndeterminateError) throw error;
      throw new CliError(
        `Cannot reach ${this.baseUrl}: ${describeFetchFailure(error)}`,
        EXIT_FAILURE,
        'Check --url, your network, and whether the editor service is running.',
      );
    }

    if (response.status === 401 && allowRefresh && !options.anonymous) {
      if (await this.attemptRefresh()) {
        return this.send(method, path, options, false);
      }
      throw new AuthError(
        this.refreshFailure === undefined
          ? `Authentication rejected by ${this.baseUrl}.`
          : `Authentication rejected by ${this.baseUrl}: ${this.refreshFailure}`,
      );
    }

    return response;
  }

  private async request(method: string, path: string, options: RequestOptions): Promise<Response> {
    const response = await this.send(method, path, options, true);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ApiError(method, path, response.status, body);
    }
    return response;
  }

  async getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request('GET', path, options);
    return (await response.json()) as T;
  }

  async getText(path: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.request('GET', path, options);
    return response.text();
  }

  async getBytes(path: string, options: RequestOptions = {}): Promise<Uint8Array> {
    const response = await this.request('GET', path, options);
    return new Uint8Array(await response.arrayBuffer());
  }

  async postForm<T>(path: string, form: FormData, options: RequestOptions = {}): Promise<T> {
    if (options.longRunning) {
      throw new CliError(
        'postForm cannot honour longRunning; multipart uploads go through fetch',
        EXIT_FAILURE,
      );
    }

    const url = this.buildUrl(path, options);
    detail(`POST ${url} (multipart)`);
    const send = async (): Promise<Response> => {
      const headers: Record<string, string> = { Accept: options.accept ?? '*/*' };
      if (!options.anonymous && this.token) headers['Authorization'] = `Bearer ${this.token}`;
      return fetch(url, { method: 'POST', headers, body: form });
    };

    let response = await send();
    if (response.status === 401 && !options.anonymous && (await this.attemptRefresh())) {
      response = await send();
    }
    if (!response.ok) {
      throw new ApiError('POST', path, response.status, await response.text().catch(() => ''));
    }
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }

  async postJson<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    const response = await this.request('POST', path, { ...options, body });
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }

  async putJson<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    const response = await this.request('PUT', path, { ...options, body });
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }

  async delete(path: string, options: RequestOptions = {}): Promise<void> {
    await this.request('DELETE', path, options);
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await this.request('POST', '/api/auth/login', {
      body: { username, password },
      anonymous: true,
      withOrg: false,
    });
    const payload = (await response.json()) as LoginResponse;
    if (!payload.success || !payload.token) {
      throw new AuthError(payload.error ?? 'Login failed.', 'Check the email and password.');
    }
    this.token = payload.token;
    this.refreshToken = payload.refreshToken;
    return payload;
  }

  async currentUser(): Promise<LoginResponse> {
    return this.getJson<LoginResponse>('/api/auth/user/', { withOrg: false });
  }

  async logout(): Promise<void> {
    if (!this.refreshToken) return;
    await this.request('POST', '/api/auth/logout', {
      body: { refreshToken: this.refreshToken },
      anonymous: true,
      withOrg: false,
    }).catch(() => undefined);
  }

  get accessToken(): string | undefined {
    return this.token;
  }

  get sessionRefreshToken(): string | undefined {
    return this.refreshToken;
  }
}
