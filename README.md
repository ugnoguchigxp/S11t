# S11t

S11t is a backend-first toolkit for authoring, compiling, and rendering SystemContext templates.

Authors edit content-first TOML. The CLI emits deterministic JSON artifacts and TypeScript contracts, and
applications load those artifacts into a filesystem-independent runtime.

## Install

```sh
npm install @s11t/runtime
npm install --save-dev @s11t/cli
```

S11t derives canonical dot keys from source paths, binds locale at the request boundary, structurally
delimits untrusted values, and returns immutable content identity for audited provider paths. Start with
the [getting-started guide](./docs/guides/getting-started.md).

## Development

Requirements: Node.js 20.19 or newer in the Node 20 line, Node.js 22, or Node.js 24, plus
Corepack-enabled pnpm.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:packages
```

`pnpm test:packages` creates runtime and CLI tarballs, checks their public contents, and installs them
into an isolated ESM consumer. Release candidates add `pnpm release:dry-run -- --channel canary` after
the Git remote and package repository metadata are configured.

## Project boundary

- `@s11t/runtime` contains portable TypeScript and does not import Node.js builtins.
- `@s11t/cli` owns filesystem access, TOML parsing, validation, and file emission.
- LLM calls, authorization, persistence, and provider adapters belong to the host application.

The contracts are documented under [`docs/specification`](./docs/specification), with public JSON
Schemas under [`schemas`](./schemas). See the [backend integration](./docs/guides/backend-integration.md)
and [trust-boundary](./docs/guides/trust-boundaries.md) guides, or run
[`examples/node-basic`](./examples/node-basic).

Maintainers preparing a registry release should follow the
[npm publishing runbook](./docs/release/npm-publishing.md).

## License

Apache License 2.0. See [LICENSE](./LICENSE).
