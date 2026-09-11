## What changed

<!-- One or two sentences. What does the CLI do now that it did not before? -->

## Why

<!-- The problem this solves. Link an issue if there is one. -->

## How it was verified

<!-- Commands you ran, and what you ran them against. Say if you only tested against a local editor service. -->

## Checklist

- [ ] `yarn type-check`, `yarn lint`, `yarn format:check` and `yarn test` all pass
- [ ] New behaviour has a test
- [ ] No new runtime dependency, or the pull request explains why one is unavoidable
- [ ] A command that writes calls `assertMutationAllowed`, and a destructive one also confirms
- [ ] README updated if a command, flag, spec field or MCP tool changed
