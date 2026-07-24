# S11t catalog artifact

The compiler emits one deterministic `s11t.catalog` JSON format. There are no legacy format variants
or version-selection branches.

The artifact contains:

- compiler and release-profile identity;
- policy and catalog digests;
- relative source provenance;
- canonical dot-key contexts.

Each context records owner, source and required locales, variables, compiled locale sections, definition
hash, locale artifact hashes, and release digest. Runtime loading validates structure, cross-field
integrity, and every digest before cloning and freezing the model.

Every untrusted variable uses `delimited-context` placement and a non-raw encoding. The runtime emits a
structural boundary and escapes closing-tag characters before interpolation.

The machine-readable contract is
[`schemas/s11t-artifact.schema.json`](../../schemas/s11t-artifact.schema.json).

## Runtime binding

`createCatalog()` accepts unknown input. `bind()` returns immutable rendered content plus a manifest.
`bindText()` and `createTextRenderer()` return text only. `bindRequest()` records a request-local render
trace and final manifest.

Bindings require `instructionLocale` and may include ordered `fallbackLocales`. Locale resolution is
fail-closed and never adds an implicit fallback.

Generated contracts use `Record<string, never>` for contexts without variables so extra values remain a
compile-time error.

## Hash identity

Definition, artifact, release, policy, catalog, and rendered-text hashes use separate domain separators
and canonical JSON where applicable. Source paths do not affect catalog identity. Golden vectors in
`packages/runtime/tests/golden/hash.json` freeze the contract across supported Node.js releases.

Artifact compatibility, version mixing, deprecation, and migration requirements are defined in the
[compatibility policy](./compatibility.md).
