# Contributing

Use Node.js 20.19+, 22, or 24 and the pnpm version pinned in `package.json`.

Before submitting a change, run:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:packages
```

Keep the runtime free of Node.js builtins, filesystem access, process state, and TOML parsing. Public contract changes must include fixtures and deterministic tests.
