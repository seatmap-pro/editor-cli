# Contributing

Thanks for taking the time. This is a small package with a narrow job, so the bar for a change is that it makes `seatmap` easier to drive against a real editor instance.

## Getting set up

```bash
yarn install
yarn build
```

Node 22 or newer. The published package has no runtime dependencies, and pull requests that add one will be asked to justify it — everything so far runs on `fetch`, `node:util`, `node:readline` and `node:crypto`.

`bin/seatmap.mjs` runs the compiled output in `dist/`, so rebuild after editing. Link the binary onto your PATH while you work:

```bash
yarn link
```

## Before you open a pull request

```bash
yarn type-check
yarn lint
yarn test
yarn format:check
```

All four must pass. Continuous integration runs the same commands on Node 22 and 24.

## House style

- TypeScript strict mode. No `any`; use a specific type, or `unknown` plus narrowing.
- `module` and `moduleResolution` are `NodeNext`, so **relative imports carry a `.js` extension even in `.ts` sources**.
- `verbatimModuleSyntax` is on: type-only imports use `import type`.
- Express intent through names and small functions rather than explanatory comments.
- Tests are co-located as `*.test.ts` and run under Vitest in a node environment.

## Things that need care

**The production guard.** Any host under `seatmap.pro` is treated as production and mutations against it are refused without `--force`. Do not widen that list in code — extra hosts belong in the config file or `SEATMAP_CLI_PRODUCTION_HOSTS`. A new command that writes must call `assertMutationAllowed` before the request, and a destructive one must also `confirm`.

**Requests that may run for minutes.** `fetch` aborts after undici's 300-second header timeout while the server goes on to commit the transaction, so the caller sees a failure that already succeeded. Pass `longRunning: true` for those; it routes the request through `node:http` bounded by socket inactivity instead. An abandoned write raises `IndeterminateError` rather than `CliError` — report it as an outcome to verify, never retry it silently.

**The MCP server.** `seatmap mcp` owns stdout for JSON-RPC. Anything a tool wants to say to a human goes to stderr. Tools are read-only unless declared `mutating`, and a mutating tool is hidden from `tools/list` and refused by `tools/call` when the server was not started with `--allow-write`.

**Spec compilation is pure.** `compileSpec` takes a `uuid` generator, so tests pass a deterministic one instead of mocking `node:crypto`. Keep new pipeline code testable the same way.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), no emojis. `feat:` for a new capability, `fix:` for a bug, `docs:`, `refactor:`, `test:`, `chore:` for the rest.

## Reporting bugs

Include the command you ran, the editor service version you ran it against, and the output with `--verbose`. That flag logs each request method and URL to stderr, so check the query parameters for anything you would rather not publish.

Security issues go through [SECURITY.md](SECURITY.md) instead of the public issue tracker.
