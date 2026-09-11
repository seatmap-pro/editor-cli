# Security policy

## Supported versions

Fixes land on the latest published release. Please reproduce an issue against that before reporting it.

## Reporting a vulnerability

Email **support@seatmap.pro** with `SECURITY` in the subject, a description, the steps to reproduce, and the impact as you see it. Do not open a public issue, and do not include working credentials or customer data in the report.

Expect an acknowledgement within three working days and an assessment within ten. We will tell you when a fix ships and credit you in the release notes unless you would rather we did not.

## Scope

This repository is a client. It holds no secrets of its own and runs entirely on the reporter's machine, so the interesting surface is what it does with credentials and what it will do on someone else's instruction:

- the profile store at `~/.config/seatmap/cli.json`, which holds access and refresh tokens and is written with mode `0600`
- the production guard, which refuses mutations against a production host
- the Model Context Protocol server, which exposes CLI operations to an AI client and is read-only unless started with `--allow-write`

A report that one of those can be bypassed is in scope and welcome.

Vulnerabilities in the editor service itself are out of scope here — send those to the same address and say which deployment you found them on.

## What ends up in output

`--verbose` logs each request's method and URL to stderr. Those URLs carry query parameters such as search terms and organization ids; they do not carry credentials, and no request header or body is logged.

Tokens live only in the profile store. Never paste that file into an issue, a pull request, or a chat with an AI assistant.
