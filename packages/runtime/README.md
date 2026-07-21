# @s11t/runtime

Portable S11t artifact contracts, deterministic compiler primitives, and the typed catalog API.

This package intentionally does not use Node.js builtins, filesystem APIs, process state, or TOML parsing.

Applications pass an artifact object to `createCatalog()` (normally through a generated `createAppCatalog()` factory), bind a request locale, and call synchronous `p()` to obtain immutable text and manifest data.
