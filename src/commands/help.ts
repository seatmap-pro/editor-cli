import { bold, dim, info } from '../cli/output.js';

const USAGE = `seatmap <command> [subcommand] [options]

Commands
  login                       Authenticate and store a profile
  logout                      Invalidate the session and drop the profile
  whoami                      Show the active profile and user
  profiles [list|use <name>]  Inspect or switch stored profiles

  orgs list                   List organizations (global admin)
  orgs show <id>              Show one organization
  orgs create --name <n> --email <e>
  orgs members <id>           List the members of an organization
  orgs add-user <id> <userId> Add an existing user, --role ROLE_ADMIN
  orgs move-tenant <id> <tenantId>
  orgs publisher <id> --enable|--disable
  orgs publish-venues <id> --enable|--disable
  orgs inventory <id> [--out <file>] [--viewbox]
  orgs regenerate-images <id> Enqueue preview generation for every schema
  orgs image-jobs <id> [--venue <id>] [--schema <id>]
  orgs tenants                List tenants

  library list                List venues published to the library
  library publish <id> --list|--unlist
  library copy <venueId...> --to <orgId> [--schema <id>]

  venues list                 List venues
  venues show <id>            Show one venue
  venues create --name <n>    Create a venue
  venues rename <id> --name <n> [--address <a>]
  venues move <id> --to-org <id>         Re-parent a venue and its schemas
  venues delete <id>          Delete a venue

  schemas list --venue <id>   List schemas in a venue
  schemas show <id> --venue   Show one schema
  schemas create --venue <id> --name <n>
  schemas rename <id> --venue <id> --name <n> [--publish|--draft]
  schemas delete <id> --venue <id>
  schemas export <id>         Dump the persisted seatmap as JSON
  schemas export-smp <id> --out <file>   Download the .smp export
  schemas import <file> --venue <id>     Import an .smp into a venue
  schemas move <id> --to-venue <id>      Re-parent a schema
  schemas transfer <id...> --to-venue <id> [--source-org <id>] [--target-org <id>]

  events list                 List events
  events show <id>            Show one event

  build <spec-file>           Compile a schema spec and push it to the editor

  mcp [--allow-write]         Serve the Model Context Protocol over stdio

Build options
  --venue <id>                Target an existing venue instead of the spec venue
  --schema <id>               Push into an existing schema instead of creating one
  --name <n>                  Override the schema name from the spec
  --dry-run                   Compile and report without calling the API
  --out <file>                Write the compiled seatmap payload to a file
  --replace                   Remove the existing contents of --schema first
  --force-delete              Permit removing seats that are already sold

MCP options
  --allow-write               Expose the build tool; read-only without it

Global options
  --profile <name>            Stored profile to use (default: current)
  --url <base-url>            Override the API base URL
  --org <id>                  Act on behalf of an organization id
  --json                      Machine-readable output
  -y, --yes                   Skip interactive confirmations
  --force                     Permit mutations against a production host
  -v, --verbose               Log each HTTP request to stderr
  -h, --help                  Show this help
  -V, --version               Print the installed version

Environment
  SEATMAP_API_URL             Default base URL
  SEATMAP_PROFILE             Default profile name
  SEATMAP_TOKEN               Bearer token, overrides the stored one
  SEATMAP_EMAIL               Non-interactive login email
  SEATMAP_PASSWORD            Non-interactive login password
  SEATMAP_CLI_CONFIG          Config file path
  SEATMAP_CLI_PRODUCTION_HOSTS  Extra hosts treated as production`;

export function helpCommand(): void {
  info(bold('Seatmap editor CLI'));
  info('');
  info(USAGE);
  info('');
  info(dim('Spec format, MCP setup and examples: https://github.com/seatmap-pro/editor-cli'));
}
