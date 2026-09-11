import { writeFileSync } from 'node:fs';
import { numberOption, positionalNumber, requiredString, stringOption } from '../cli/args.js';
import { confirm } from '../cli/confirm.js';
import { UsageError } from '../cli/errors.js';
import { detail, emitJson, info, isJsonMode, output, success } from '../cli/output.js';
import { assertMutationAllowed } from '../config/guards.js';
import { authenticatedContext } from './context.js';
import type {
  CreateOrganizationResult,
  OrganizationDTO,
  OrganizationUserDTO,
  Page,
  SchemaDTO,
  TenantDTO,
  VenueDTO,
} from '../api/types.js';

const LIST_OPTIONS = {
  search: { type: 'string' as const },
  tenant: { type: 'string' as const },
  limit: { type: 'string' as const },
};

const CREATE_OPTIONS = {
  name: { type: 'string' as const },
  email: { type: 'string' as const },
  'first-name': { type: 'string' as const },
  'last-name': { type: 'string' as const },
  password: { type: 'string' as const },
};

const MEMBER_OPTIONS = {
  role: { type: 'string' as const },
  limit: { type: 'string' as const },
};

const PUBLISHER_OPTIONS = {
  enable: { type: 'boolean' as const },
  disable: { type: 'boolean' as const },
};

const INVENTORY_OPTIONS = {
  out: { type: 'string' as const },
  viewbox: { type: 'boolean' as const },
};

const IMAGE_JOB_OPTIONS = {
  venue: { type: 'string' as const },
  schema: { type: 'string' as const },
};

interface ImageJobDTO {
  id?: string;
  schemaId?: number;
  status?: string;
  attempts?: number;
  updatedAtEpochSeconds?: number;
  errorMessage?: string;
}

interface InventorySchema {
  id: number;
  name: string;
  draft: boolean;
  seats?: number;
  gaCapacity?: number;
  preview?: string;
  viewBox?: unknown;
}

interface InventoryVenue {
  id: number;
  name: string;
  address?: string;
  schemas: InventorySchema[];
}

function epochToIso(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  return new Date(seconds * 1000).toISOString().slice(0, 19);
}

function generatedPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function listOrgs(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LIST_OPTIONS);

  const page = await context.client.getJson<Page<OrganizationDTO>>('/api/admin/organizations/', {
    withOrg: false,
    query: {
      search: stringOption(context.values, 'search'),
      tenantId: numberOption(context.values, 'tenant'),
      size: numberOption(context.values, 'limit') ?? 200,
    },
  });

  output(page.content ?? [], [
    { header: 'ID', value: (org) => String(org.id) },
    { header: 'NAME', value: (org) => org.name },
    { header: 'TENANT', value: (org) => `${org.tenantId ?? ''} ${org.tenantName ?? ''}`.trim() },
    { header: 'VENUES', value: (org) => String(org.numberOfVenues ?? '') },
    { header: 'SCHEMAS', value: (org) => String(org.numberOfSchemas ?? '') },
    { header: 'USERS', value: (org) => String(org.numberOfUsers ?? '') },
    { header: 'LIBRARY', value: (org) => (org.libraryPublisher ? 'publisher' : '') },
  ]);
}

async function showOrg(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv);
  const id = positionalNumber(context.positionals, 1, 'orgId');
  const org = await context.client.getJson<OrganizationDTO>(`/api/admin/organizations/${id}`, {
    withOrg: false,
  });

  if (isJsonMode()) {
    emitJson(org);
    return;
  }

  info(`ID           ${org.id}`);
  info(`Name         ${org.name}`);
  info(`Tenant       ${org.tenantId ?? ''} ${org.tenantName ?? ''}`.trimEnd());
  info(`Venues       ${org.numberOfVenues ?? 0}`);
  info(`Schemas      ${org.numberOfSchemas ?? 0}`);
  info(`Users        ${org.numberOfUsers ?? 0}`);
  info(`Library      ${org.libraryPublisher ? 'publisher' : 'not a publisher'}`);
}

async function createOrg(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, CREATE_OPTIONS);
  const name = requiredString(context.values, 'name');
  const email = requiredString(context.values, 'email');

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `create organization "${name}"`,
    force: context.force,
  });

  const chosenPassword = stringOption(context.values, 'password');
  const password = chosenPassword ?? generatedPassword();

  const result = await context.client.postJson<CreateOrganizationResult>(
    '/api/admin/organizations/',
    {
      name,
      type: 'DEFAULT',
      autologinEnabled: false,
      user: {
        email,
        firstName: stringOption(context.values, 'first-name') ?? 'Admin',
        lastName: stringOption(context.values, 'last-name') ?? 'User',
        password,
      },
    },
    { withOrg: false },
  );

  if (isJsonMode()) {
    emitJson(chosenPassword === undefined ? { ...result, password } : result);
    return;
  }
  success(`Created organization ${result.id} "${result.name}" with admin ${email}`);
  if (chosenPassword === undefined) {
    info(`Generated password for ${email}: ${password}`);
    info('It is shown once and is not stored anywhere; record it now.');
  }
}

async function listMembers(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, MEMBER_OPTIONS);
  const orgId = positionalNumber(context.positionals, 1, 'orgId');

  const page = await context.client.getJson<Page<OrganizationUserDTO>>('/api/organization/users/', {
    withOrg: false,
    query: { orgId, size: numberOption(context.values, 'limit') ?? 200 },
  });

  output(page.content ?? [], [
    { header: 'ID', value: (user) => String(user.id) },
    { header: 'EMAIL', value: (user) => user.email },
    { header: 'NAME', value: (user) => `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() },
    { header: 'ROLE', value: (user) => (user.roles ?? []).join(', ') },
    { header: 'ENABLED', value: (user) => (user.enabled === false ? 'no' : 'yes') },
  ]);
}

async function addUser(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, MEMBER_OPTIONS);
  const orgId = positionalNumber(context.positionals, 1, 'orgId');
  const userId = positionalNumber(context.positionals, 2, 'userId');
  const role = stringOption(context.values, 'role') ?? 'ROLE_ADMIN';

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `add user ${userId} to organization ${orgId} as ${role}`,
    force: context.force,
  });

  await context.client.postJson(`/api/organization/users/${userId}/assign`, undefined, {
    withOrg: false,
    query: { orgId, role },
  });
  success(`Added user ${userId} to organization ${orgId} as ${role}`);
}

async function moveTenant(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv);
  const orgId = positionalNumber(context.positionals, 1, 'orgId');
  const tenantId = positionalNumber(context.positionals, 2, 'tenantId');

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `move organization ${orgId} to tenant ${tenantId}`,
    force: context.force,
  });

  const org = await context.client.getJson<OrganizationDTO>(`/api/admin/organizations/${orgId}`, {
    withOrg: false,
  });
  await confirm({
    question: `Move organization ${orgId} "${org.name}" from tenant ${org.tenantId ?? '?'} to tenant ${tenantId}?`,
    assumeYes: context.yes,
  });

  await context.client.postJson(
    `/api/admin/tenants/${tenantId}/organizations/${orgId}/move`,
    undefined,
    { withOrg: false },
  );
  success(`Moved organization ${orgId} to tenant ${tenantId}`);
}

async function setPublisher(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, PUBLISHER_OPTIONS);
  const orgId = positionalNumber(context.positionals, 1, 'orgId');
  const enable = context.values['enable'] === true;
  const disable = context.values['disable'] === true;
  if (enable === disable) {
    throw new UsageError('Pass exactly one of --enable or --disable');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `${enable ? 'grant' : 'revoke'} the library publisher flag on organization ${orgId}`,
    force: context.force,
  });

  const org = await context.client.putJson<OrganizationDTO>(
    `/api/admin/organizations/${orgId}/library-publisher`,
    { libraryPublisher: enable },
    { withOrg: false },
  );
  success(
    `Organization ${orgId} "${org.name}" is ${org.libraryPublisher ? 'now' : 'no longer'} a library publisher`,
  );
}

async function publishVenues(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, PUBLISHER_OPTIONS);
  const orgId = positionalNumber(context.positionals, 1, 'orgId');
  const list = context.values['enable'] === true;
  const unlist = context.values['disable'] === true;
  if (list === unlist) {
    throw new UsageError('Pass exactly one of --enable or --disable');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `${list ? 'list' : 'unlist'} every venue of organization ${orgId} in the library`,
    force: context.force,
  });

  const result = await context.client.putJson<{ updatedCount?: number; listed?: boolean }>(
    `/api/admin/organizations/${orgId}/venues/library-status`,
    { listed: list },
    { withOrg: false },
  );

  if (isJsonMode()) {
    emitJson(result);
    return;
  }
  success(
    `${result.updatedCount ?? 0} venues of organization ${orgId} changed to ${list ? 'listed in' : 'hidden from'} the library`,
  );
}

async function regenerateImages(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv);
  const orgId = positionalNumber(context.positionals, 1, 'orgId');

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `enqueue image generation for every schema of organization ${orgId}`,
    force: context.force,
  });

  const jobs = await context.client.postJson<string[]>(
    `/api/image-jobs/restart/organization/${orgId}`,
    undefined,
    { withOrg: false },
  );

  if (isJsonMode()) {
    emitJson(jobs);
    return;
  }
  success(`Enqueued ${jobs.length} image job(s) for organization ${orgId}`);
}

async function imageJobs(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, IMAGE_JOB_OPTIONS);
  const orgId = positionalNumber(context.positionals, 1, 'orgId');

  const jobs = await context.client.getJson<ImageJobDTO[]>('/api/image-jobs', {
    withOrg: false,
    query: {
      organizationId: orgId,
      venueId: numberOption(context.values, 'venue'),
      schemaId: numberOption(context.values, 'schema'),
    },
  });

  if (isJsonMode()) {
    emitJson(jobs);
    return;
  }

  output(jobs, [
    { header: 'SCHEMA', value: (job) => String(job.schemaId ?? '') },
    { header: 'STATUS', value: (job) => job.status ?? '' },
    { header: 'ATTEMPTS', value: (job) => String(job.attempts ?? '') },
    { header: 'UPDATED', value: (job) => epochToIso(job.updatedAtEpochSeconds) },
    { header: 'ERROR', value: (job) => (job.errorMessage ?? '').slice(0, 80) },
  ]);
}

async function inventory(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, INVENTORY_OPTIONS);
  const orgId = positionalNumber(context.positionals, 1, 'orgId');
  const withViewBox = context.values['viewbox'] === true;

  const venuePage = await context.client.getJson<Page<VenueDTO>>('/api/venues/', {
    withOrg: false,
    query: { orgId, size: 1000 },
  });
  const venues = venuePage.content ?? [];

  const rows: InventoryVenue[] = [];
  for (const venue of venues) {
    const schemaPage = await context.client.getJson<Page<SchemaDTO>>(
      `/api/venues/${venue.id}/schemas/`,
      { withOrg: false, query: { orgId, size: 500 } },
    );
    const schemas: InventorySchema[] = [];
    for (const schema of schemaPage.content ?? []) {
      const entry: InventorySchema = {
        id: schema.id,
        name: schema.name,
        draft: schema.draft === true,
        seats: schema.seatsCapacity,
        gaCapacity: schema.gaCapacity,
        preview: (schema as { preview?: string }).preview,
      };
      if (withViewBox) {
        entry.viewBox = await context.client
          .getJson<unknown>(`/api/seatmap/${schema.id}/viewbox/`, {
            withOrg: false,
            query: { orgId },
          })
          .catch(() => undefined);
      }
      schemas.push(entry);
    }
    rows.push({
      id: venue.id,
      name: venue.name,
      address: venue.address,
      schemas,
    });
    detail(`venue ${venue.id} ${venue.name}: ${schemas.length} schemas`);
  }

  const report = { orgId, venues: rows };
  const out = stringOption(context.values, 'out');
  if (out !== undefined) {
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    success(
      `Wrote ${rows.length} venues / ${rows.reduce((sum, row) => sum + row.schemas.length, 0)} schemas to ${out}`,
    );
    return;
  }
  emitJson(report);
}

async function listTenants(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LIST_OPTIONS);
  const page = await context.client.getJson<Page<TenantDTO>>('/api/admin/tenants/', {
    withOrg: false,
    query: {
      search: stringOption(context.values, 'search'),
      size: numberOption(context.values, 'limit') ?? 200,
    },
  });

  output(page.content ?? [], [
    { header: 'ID', value: (tenant) => String(tenant.id) },
    { header: 'NAME', value: (tenant) => tenant.name },
    { header: 'ORGS', value: (tenant) => String(tenant.numberOfOrganizations ?? '') },
  ]);
}

export async function orgsCommand(argv: readonly string[]): Promise<void> {
  const sub = argv[0] ?? 'list';
  switch (sub) {
    case 'list':
      return listOrgs(argv.slice(1));
    case 'show':
      return showOrg(argv);
    case 'create':
      return createOrg(argv.slice(1));
    case 'members':
      return listMembers(argv);
    case 'add-user':
      return addUser(argv);
    case 'move-tenant':
      return moveTenant(argv);
    case 'publisher':
      return setPublisher(argv);
    case 'publish-venues':
      return publishVenues(argv);
    case 'inventory':
      return inventory(argv);
    case 'regenerate-images':
      return regenerateImages(argv);
    case 'image-jobs':
      return imageJobs(argv);
    case 'tenants':
      return listTenants(argv.slice(1));
    default:
      throw new UsageError(
        `Unknown subcommand "seatmap orgs ${sub}"`,
        'Available: list, show, create, members, add-user, move-tenant, publisher, ' +
          'publish-venues, inventory, regenerate-images, tenants',
      );
  }
}
