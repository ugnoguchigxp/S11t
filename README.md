# S11t

S11t is a backend-first authoring, compilation, and runtime toolkit for versioned SystemContext templates.

The v0.1 implementation is under active development. Authors edit TOML sources, the CLI emits deterministic JSON artifacts and TypeScript contracts, and applications load those JSON objects into a filesystem-independent runtime.

## Development

Requirements: Node.js 20.19 or newer in the Node 20 line, Node.js 22, or Node.js 24,
plus Corepack-enabled pnpm.

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

To dogfood a canary in a sibling NightWorkers checkout without publishing it to
npm, run `pnpm deploy:nightworkers-canary`. The command builds and validates a
snapshot from the committed S11t `HEAD`, then updates NightWorkers' vendored
tarballs, `package.json`, and `bun.lock` with automatic rollback on failure. Pass
`--target /path/to/nightWorkers` for a non-sibling checkout and `--verify` to
also run NightWorkers' full typecheck and build.

## Project boundary

- `@s11t/runtime` contains portable TypeScript and must not import Node.js builtins.
- `@s11t/cli` owns filesystem access, TOML parsing, validation, and file emission.
- LLM calls, authorization, persistence, and provider adapters belong to the host application.

The current v1 contracts are documented under [`docs/specification`](./docs/specification), with public schemas under [`schemas`](./schemas).

See the [getting started guide](./docs/guides/getting-started.md) and the runnable [`examples/node-basic`](./examples/node-basic) project for the complete TOML-to-`p()` flow.

## License

Apache License 2.0. See [LICENSE](./LICENSE).
