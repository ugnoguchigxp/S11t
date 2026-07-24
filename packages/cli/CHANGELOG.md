# s11tnext-cli

## 0.1.2

### Patch Changes

- aea25be: Add newline-preserving `delimited-text` encoding, optional variables and
  conditional sections, keyspace-scoped release locale requirements, reusable
  section profiles, configurable terminal newlines, document and keyspace
  source-locale overrides, generated TypeScript indentation, and byte-range
  composition receipts. Add authored `system`/`user` provider-message roles,
  role-aware invocations and message hashes, and version 2 artifacts that reject
  unversioned or incompatible catalogs. Remove unverifiable section `enforcement` claims.
  Document composite TypeScript and Bun support boundaries, correct the published
  package status, and make verification workflows build package exports before
  tests that resolve them.
- Updated dependencies [aea25be]
  - s11tnext@0.1.2

## 0.1.0

### Minor Changes

- 2aa483d: Publish the initial S11tnext runtime and CLI packages.

  - Compile content-first TOML into one deterministic catalog format with path-derived keys and generated
    TypeScript contracts.
  - Render trusted and delimited untrusted values through a portable, browser-compatible runtime.
  - Audit immutable invocations, request-local render traces, locale coverage, and content digests.
  - Validate authoring, translations, artifacts, package contents, and isolated npm consumers fail-closed.

### Patch Changes

- Updated dependencies [2aa483d]
  - s11tnext@0.1.0

## 0.0.0

Initial development version.
