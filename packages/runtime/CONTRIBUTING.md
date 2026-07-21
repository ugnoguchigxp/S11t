# Contributing

Use Node.js 22 or 24 and the pnpm version pinned by the S11t repository.

Before submitting a change, run `pnpm verify` and the Phase 5 package checks from the repository root.

Keep the runtime free of Node.js builtins, filesystem access, process state, and TOML parsing. Public contract changes must include fixtures and deterministic tests.
