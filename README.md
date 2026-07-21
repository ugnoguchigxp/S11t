# S11t

S11t is a backend-first authoring, compilation, and runtime toolkit for versioned SystemContext templates.

The v0.1 implementation is under active development. Authors edit TOML sources, the CLI emits deterministic JSON artifacts and TypeScript contracts, and applications load those JSON objects into a filesystem-independent runtime.

## Development

Requirements: Node.js 22 or 24 and Corepack-enabled pnpm.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:packages
```

`pnpm test:packages` creates real runtime and CLI tarballs, checks their public
contents, and installs them into an isolated ESM consumer. Release candidates
add `pnpm release:dry-run -- --channel canary` after a Git remote and package
repository metadata have been configured.

## Project boundary

- `@s11t/runtime` contains portable TypeScript and must not import Node.js builtins.
- `@s11t/cli` owns filesystem access, TOML parsing, validation, and file emission.
- LLM calls, authorization, persistence, and provider adapters belong to the host application.

The current v1 contracts are documented under [`docs/specification`](./docs/specification), with public schemas under [`schemas`](./schemas).

See the [getting started guide](./docs/guides/getting-started.md) and the runnable [`examples/node-basic`](./examples/node-basic) project for the complete TOML-to-`p()` flow.

## License

Apache License 2.0. See [LICENSE](./LICENSE).
