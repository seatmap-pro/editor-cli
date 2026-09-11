# @seatmap.pro/editor-cli

`seatmap` — a command-line client for the [Seatmap.pro](https://seatmap.pro) editor service. It builds seating schemas from a declarative spec file and pushes them through the same API the editor UI uses, and it can serve those operations to an AI assistant over the Model Context Protocol.

The point of the tool is `seatmap build`: describe a venue layout as JSON, and the CLI generates sections, rows and seats (row/seat numbering, coordinates, GUID linkage, view box) and saves them to a schema. Everything the editor canvas would have produced by hand, produced from a file instead.

It is an API client and ships no server of its own. Point it at an editor instance you already have credentials for.

## Install

```bash
npm install -g @seatmap.pro/editor-cli
```

Node 22 or newer. The package has no runtime dependencies.

Run it once without installing:

```bash
npx @seatmap.pro/editor-cli help
```

To work on the CLI itself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Authenticate

```bash
seatmap login --url https://editor.example.com
```

Credentials are prompted for (the password is masked) unless `--email`/`--password` or `SEATMAP_EMAIL`/`SEATMAP_PASSWORD` are supplied. The session is stored in `~/.config/seatmap/cli.json` with mode `0600`. Expired access tokens are refreshed automatically and written back.

Multiple environments live side by side as named profiles:

```bash
seatmap login --profile dev --url https://editor.example.com
seatmap login --profile local --url http://localhost:8080
seatmap profiles
seatmap profiles use dev
```

## Build a schema

```bash
seatmap build examples/theatre.json --dry-run
seatmap build examples/theatre.json
seatmap build examples/theatre.json --venue 42 --name "Auditorium v2"
seatmap build examples/theatre.json --schema 108 --replace
```

`--dry-run` compiles and reports without touching the API — use it to check counts before writing anything. `--out payload.json` writes the exact request body for inspection or diffing.

```
Compiled "Main Auditorium" from examples/theatre.json
SECTION       TYPE  ROWS  SEATS
Stalls        grid  12    288
Dress Circle  arc   6     180
Standing Pit  ga    -     -
Total: 3 sections (1 GA), 18 rows, 468 seats
```

Without `--schema`, a new schema is created (and a new venue too, if the spec carries a `venue` block and no venue of that name exists). With `--schema`, the compiled sections are added to that schema; add `--replace` to remove its existing sections and seats first.

### Bundled examples

| File                     | Shows                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| `examples/theatre.json`  | Grid stalls, an arc circle, a GA pit, auto outlines, seat flags     |
| `examples/arena.json`    | Four blocks around a floor, roman row numbering, reversed numbering |
| `examples/smoke.json`    | A stage, three GA zones and two grid blocks — 254 seats             |
| `examples/underlay.json` | Two blocks traced over `examples/floorplan.svg`                     |

`smoke.json` is the end-to-end check: small enough to eyeball, but it exercises every shape kind the compiler emits (seated sector, GA sector plus its linked shape, and a standalone stage).

## Spec format

A spec is a JSON file (`.json`), a JS module exporting the object as `default` (`.mjs`/`.js`, useful for generating layouts programmatically), or `-` to read JSON from stdin.

```json
{
  "venue": { "name": "Example Theatre", "address": "1 Example Street" },
  "schema": { "name": "Main Auditorium", "draft": true },
  "sections": [ ... ]
}
```

`venue` is optional — omit it and pass `--venue <id>`. When present, the CLI reuses a venue with the same name if one exists, and creates it otherwise.

### Common section fields

| Field                    | Default        | Meaning                                      |
| ------------------------ | -------------- | -------------------------------------------- |
| `name`                   | required       | Section name, must be unique within the spec |
| `type`                   | `grid`         | `grid`, `arc` or `ga`                        |
| `position`               | `{x: 0, y: 0}` | Section origin in schema coordinates         |
| `rowLabels`              | all false      | `{left, right, center}` row-label rendering  |
| `title`                  | editor default | `{position: NONE\|TOP\|BOTTOM, fontScale}`   |
| `outline`                | editor default | `{mode: NONE\|AUTO\|SVG, path, padding}`     |
| `rowLabel` / `seatLabel` | `Row` / `Seat` | The noun stored on each row                  |
| `numbering`              | `1..n`         | Row and seat numbering, see below            |

### `grid` sections

| Field         | Default          | Meaning                               |
| ------------- | ---------------- | ------------------------------------- |
| `rows`        | required         | Number of rows                        |
| `seatsPerRow` | required         | Seats in each row                     |
| `spacing`     | `{x: 28, y: 28}` | Distance between seat centres         |
| `skip`        | `[]`             | Seats to leave out                    |
| `flags`       | `[]`             | Per-seat accessible / hidden / marked |

The default spacing of 28 and the 19-unit inset from the section origin mirror `GRID_STEP` and `INITIAL_SHIFT_FROM_SECTOR_BORDER` in the editor's renderer settings, so a generated grid lands on the same lattice the editor uses when you draw a section by hand.

### `arc` sections

| Field         | Default  | Meaning                                                  |
| ------------- | -------- | -------------------------------------------------------- |
| `rows`        | required | Number of concentric rows                                |
| `seatsPerRow` | required | Seats per row                                            |
| `radius`      | required | Distance from the section origin to the first row        |
| `arcDegrees`  | `90`     | Total sweep, centred below the origin                    |
| `rowSpacing`  | `28`     | Radial distance between rows                             |
| `facing`      | `in`     | `in` rotates seats toward the origin, `out` away from it |

The section origin is the focal point (think stage centre); rows curve below it and each successive row sits further away. Seats are spread at equal angles across the sweep, so outer rows are physically wider apart than inner ones.

### `ga` sections

| Field                | Default | Meaning                               |
| -------------------- | ------- | ------------------------------------- |
| `shape`              | `RECT`  | `RECT`, `CIRCLE`, `POLYGON` or `LINE` |
| `width` / `height`   | `250`   | Box size                              |
| `points`             | —       | Vertices for `POLYGON`                |
| `fill` / `textColor` | —       | Shape styling                         |

A GA section is stored as a sector with `ga: true` plus a linked shape carrying `purpose: GA`, which is the same pair the editor persists when you convert a shape into a GA section. GA capacity is an event-level concept, not a section field — set `schema.gaCapacity` for the schema default.

### Stage and other decorations

A stage is not a section — it holds no seats and is not a sector — so it goes in a top-level `shapes` array alongside `sections`:

```json
"shapes": [
  { "type": "stage", "position": { "x": 0, "y": -280 }, "width": 620, "height": 120 },
  { "type": "shape", "shape": "CIRCLE", "position": { "x": 700, "y": 0 }, "text": "Bar" },
  { "type": "label", "position": { "x": 0, "y": 500 }, "text": "Main entrance" }
]
```

| Type    | Emits                        | Defaults                      |
| ------- | ---------------------------- | ----------------------------- |
| `stage` | Shape with `purpose: OBJECT` | `RECT`, 620x120, text `STAGE` |
| `shape` | Shape with `purpose: OBJECT` | `RECT`, 250x250, no text      |
| `label` | Label shape                  | 200x200; `text` is required   |

`stage` is just `shape` with stage-shaped defaults. These carry no `groupOfSeatsGuid`, which is what separates them from the shape backing a GA section, and they are included in the computed view box.

### SVG underlay

An `underlay` block attaches a vector background — a floorplan, an architectural drawing, an exported venue map — that the editor and the renderer draw beneath the seats.

```json
"underlay": {
  "file": "floorplan.svg",
  "position": { "x": -120, "y": -420 },
  "width": 1040,
  "height": 840
}
```

| Field      | Default               | Meaning                                        |
| ---------- | --------------------- | ---------------------------------------------- |
| `file`     | —                     | Path to an SVG, resolved against the spec file |
| `svg`      | —                     | Inline SVG source instead of `file`            |
| `position` | The document's origin | Top-left corner in schema coordinates          |
| `width`    | The document's width  | Drawn width; the artwork scales to fit         |
| `height`   | The document's height | Drawn height                                   |
| `scale`    | See below             | The editor's zoom hint for the background      |

Exactly one of `file` or `svg` is required. The source document must declare a `viewBox` (or a `width` and `height`) on its root `<svg>` element — the CLI has no renderer, so an unmeasurable document is rejected rather than guessed at.

Placement maps the source `viewBox` onto the `position`/`width`/`height` rect, so leaving all four out draws the artwork at its own coordinates, one unit per seat-space unit. The default `scale` mirrors the editor's import: documents narrower than 1920 units are scaled up to that width, wider ones are left at `1`.

The underlay is included in the computed `clientViewBox`, so the saved view frames the drawing as well as the seats.

Two things the editor does on upload that the CLI does not: it strips elements with `class="sector"` and any `#sm-row-labels` group left over from a previous export. The CLI passes the file through unchanged and warns when it sees either, since removing nodes from arbitrary SVG without a DOM is not something to do silently. Export a clean drawing, or open it in the editor once.

### Numbering

```json
"numbering": {
  "rows":  { "format": "letters", "from": "A", "step": 1, "direction": "toBottom" },
  "seats": { "from": "101", "step": 2, "direction": "toRight" }
}
```

- `format` (rows only): `arabic` (default), `letters` (A, B, … Z, AA), `roman` (I, II, III).
- `from`: starting label. A prefix and zero padding are preserved — `A01` yields `A01, A02, A03`. For `letters`, a number from 1 to 26 is read as its letter.
- `step`: increment between labels.
- `direction`: `toBottom`/`toTop` for rows, `toRight`/`toLeft` for seats. The reversed direction reverses the generated sequence.

These generators are ports of the editor's own `patternRenamer`, `letterRenamer` and `romanNumeralRenamer`, so labels match what the editor produces for the same settings.

### Skipping seats and flagging them

Both select by generated label, so they read the same way as the finished map:

```json
"skip":  [{ "row": "A", "seats": ["13"] }, { "row": "M" }],
"flags": [{ "row": "A", "seats": ["1", "2"], "accessible": true }]
```

Omitting `seats` selects the whole row — in `skip` that drops the row entirely. Supported flags are `accessible`, `hidden` and `marked`.

## Other commands

```bash
seatmap venues list --search arena
seatmap venues create --name "Example Arena" --address "10 Arena Way"
seatmap venues rename 42 --name "Example Arena" --address "10 Arena Way"
seatmap schemas list --venue 42
seatmap schemas rename 108 --venue 42 --name "Main bowl" --publish
seatmap schemas export 108 --out seatmap.json
seatmap events list --schema 108
seatmap whoami
```

`--json` switches every command to machine-readable output for scripting.

## Administering organizations

These commands need an administrator session, and the required role differs per command.
`orgs list`, `orgs show` and `orgs create` need `ROLE_SUPER_ADMIN`; `orgs publisher`,
`orgs publish-venues`, `orgs move-tenant` and the `move` subcommands need `ROLE_GLOBAL_ADMIN`;
`orgs regenerate-images` and `orgs image-jobs` accept either, and list only the organizations
the caller can see; `orgs members` and `orgs add-user` need rights to manage the target
organization. `ROLE_SUPER_ADMIN` and `ROLE_GLOBAL_ADMIN` do not imply one another. `--org <id>` makes any other
command act on behalf of that organization, which is how an administrator reaches another
org's venues.

```bash
seatmap orgs list --search example
seatmap orgs create --name "Example Org" --email admin@example.com
seatmap orgs members 12
seatmap orgs add-user 12 1 --role ROLE_ADMIN
seatmap orgs move-tenant 12 1
seatmap orgs inventory 12 --out inventory.json --viewbox
seatmap orgs regenerate-images 12
```

`orgs create` reuses an existing account when the email already belongs to one, so it
adds an admin rather than creating a second login for the same person. The caller is
added as an admin too. `orgs inventory` walks every venue and schema of an organization
into one JSON file. With `--viewbox` it also records the bounding box of the seats and the
bounding box of the background, which is how you spot a schema whose background image sits
off the map.

## Moving things between venues and organizations

`move` re-parents the rows in place. Ids survive, events keep pointing at the same schema,
and nothing is duplicated. It needs a global-admin session because it crosses organization
boundaries.

```bash
seatmap schemas move 108 --to-venue 42
seatmap venues move 42 --to-org 12
```

Moving a schema into a venue that belongs to another organization carries the schema's
organization, its background, its preview image and its events across with it. Moving a
venue does the same for every schema under it.

`transfer` is the older route and does something different: it exports each schema and
imports the bytes into a venue that already exists elsewhere, which produces **new**
schemas and leaves the originals in place. Use it against an instance that predates the
move endpoints, or when you deliberately want a copy.

```bash
seatmap schemas transfer 108 109 --to-venue 55 --source-org 7 --target-org 12
```

## The venue library

The library is how a venue reaches another organization on an instance without the move
endpoints. The source organization needs the publisher flag, and each venue has to be
listed before it can be copied.

```bash
seatmap orgs publisher 7 --enable
seatmap orgs publish-venues 7 --enable
seatmap library list --search arena
seatmap library copy 71 72 73 --to 12
seatmap library copy 71 --schema 108 --to 12
seatmap orgs publish-venues 7 --disable
seatmap orgs publisher 7 --disable
```

`library copy` accepts several venue ids and reports one row per venue, so a partial
failure does not lose the ids that succeeded. Copying a venue with many large schemas can
run for several minutes; the copy request is sent over Node's http client rather than
`fetch` so it is not cut short by the 300-second header timeout `fetch` imposes.

## Model Context Protocol server

`seatmap mcp` serves the CLI's operations to an MCP client over stdio, so an assistant can inspect venues, schemas and events, and validate a build spec before anyone writes anything.

```bash
seatmap mcp
```

It speaks JSON-RPC 2.0 on stdin and stdout and implements `initialize`, `tools/list` and `tools/call`. Nothing else is written to stdout, so the stream stays clean for the client; warnings go to stderr.

Register it by pointing an MCP client at the installed binary:

```json
{
  "mcpServers": {
    "seatmap": {
      "command": "seatmap",
      "args": ["mcp", "--profile", "dev"]
    }
  }
}
```

The server resolves its target and credentials from the profile at startup, exactly like any other command, so `--url`, `--profile` and `--org` work here too.

### Tools

| Tool                     | Writes | Purpose                                                                |
| ------------------------ | ------ | ---------------------------------------------------------------------- |
| `seatmap_session`        | no     | Which instance and profile, whether it counts as production            |
| `seatmap_list_venues`    | no     | Page through venues                                                    |
| `seatmap_list_schemas`   | no     | Schemas belonging to one venue                                         |
| `seatmap_get_schema`     | no     | Metadata for one schema                                                |
| `seatmap_schema_summary` | no     | Section, row, seat and shape counts for a persisted seatmap            |
| `seatmap_list_events`    | no     | Page through events                                                    |
| `seatmap_validate_spec`  | no     | Compile a spec offline and report per-section counts                   |
| `seatmap_build`          | yes    | Compile a spec and push it, creating the venue and schema if necessary |

`seatmap_schema_summary` returns counts rather than the seatmap itself, which runs to megabytes on a large venue.

### What the server will not do

- **Write without being asked.** `seatmap_build` is absent from `tools/list` and refused by `tools/call` unless the server was started with `--allow-write`.
- **Touch production.** A build against a production host is refused outright; there is no protocol equivalent of `--force`.
- **Overwrite a seatmap.** Building into a schema that already holds one is refused. The service matches rows and seats by numeric id, so a second build would duplicate them rather than replace them, and duplicate rows cannot be deleted afterwards. Build into a new schema, or use `seatmap build --schema <id> --replace` from a terminal where a human confirms it.
- **Read outside its working directory.** Spec and underlay paths are resolved against the directory the server was started in, and anything escaping it is refused.
- **Run a JavaScript spec.** `seatmap build` accepts a module spec; the MCP path takes JSON only, because here the client chooses the path rather than the operator.

Every tool except `seatmap_session`, `seatmap_validate_spec` and a dry-run build needs a stored session, and says so plainly rather than passing an unauthenticated request to the API.

### Turning writes on

```bash
seatmap mcp --allow-write
```

That is the only switch. The production and overwrite refusals above still apply, on the reasoning that a guard a model can talk its way past is not a guard.

## Stability

The CLI drives the editor service's own REST endpoints — the same ones the editor UI calls. Those endpoints are first-party: they carry no version guarantee, and they can change between editor releases without notice.

What that means in practice: pin a CLI version, and expect that a newer editor instance may need a newer CLI. If you are building a product integration rather than tooling, use the Booking API instead; it is the versioned, supported surface.

## Safety

Deleting and replacing prompt for confirmation; `--yes` skips the prompt for automation.

Any host under `seatmap.pro` counts as production, and mutations against it are refused unless `--force` is also passed. Add more hosts through `SEATMAP_CLI_PRODUCTION_HOSTS` (comma-separated, `*.example.com` allowed) or a `productionHosts` array in the config file — do that for any self-hosted customer production instance you connect to.

`--force-delete` maps to the service's `forceDelete` flag, which permits removing seats that have already been sold. It requires typing the phrase `force-delete` to confirm.

## Environment variables

| Variable                             | Purpose                                |
| ------------------------------------ | -------------------------------------- |
| `SEATMAP_API_URL`                    | Default base URL                       |
| `SEATMAP_PROFILE`                    | Default profile name                   |
| `SEATMAP_TOKEN`                      | Bearer token, overrides the stored one |
| `SEATMAP_EMAIL` / `SEATMAP_PASSWORD` | Non-interactive login                  |
| `SEATMAP_CLI_CONFIG`                 | Config file path                       |
| `SEATMAP_CLI_PRODUCTION_HOSTS`       | Extra production hosts                 |

## Exit codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| 0    | Success                                                               |
| 1    | Runtime or API failure                                                |
| 2    | Usage or spec validation error                                        |
| 3    | Not authenticated                                                     |
| 4    | Refused by a safety guard or by the operator                          |
| 5    | Sent but never confirmed -- verify server state, do NOT retry blindly |

## Development

```bash
yarn test
yarn type-check
yarn lint
yarn build
```

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
