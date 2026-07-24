# S11tnext catalog artifact

The compiler emits deterministic `s11tnext.catalog` artifact version 2. Runtime loading rejects
unversioned, legacy, and future artifacts with `S11TNEXT_ARTIFACT_VERSION_UNSUPPORTED`; rebuild the
catalog and generated TypeScript with the exact Runtime/CLI release pair.

The artifact contains:

- the literal `artifactVersion: 2`;
- compiler and release-profile identity;
- policy and catalog digests;
- relative source provenance;
- canonical dot-key contexts.

Each context records its provider-message role, owner, source and required locales, variables, compiled
locale sections, definition hash, locale artifact hashes, and release digest. Runtime loading validates
structure, cross-field integrity, and every digest before cloning and freezing the model.

Every untrusted variable uses `delimited-context` placement and a non-raw encoding. The runtime emits a
structural boundary and escapes closing-tag characters before interpolation.
`delimited-text` preserves embedded newlines, while `json-string` emits the JSON string representation.
Optional variables interpolate as empty text when absent. Sections marked `omitIfEmpty` are removed when
all referenced values are absent or empty strings, and the invocation manifest records only included
section IDs.

Section metadata contains descriptive `kind`, `severity`, and `optimizable` values. It contains no
`enforcement` claim; external schema, authorization, and host/tool controls are not verified by the
artifact.

The machine-readable contract is
[`schemas/s11tnext-artifact.schema.json`](../../schemas/s11tnext-artifact.schema.json).

## Runtime binding

`createCatalog()` accepts unknown input. `bind()` returns one immutable `PromptInvocation` whose
top-level `role` and manifest `messageRole` are both the authored context role. The manifest also
contains `messageHash`, a domain-separated digest over the exact `{ role, text }` provider message.
`bindText()` and `createTextRenderer()` return text only. `bindRequest()` records a request-local render
trace and final manifest. Pass explicitly included earlier invocations as the second argument to
`finalize(finalInvocation, fragments)` to receive a composition receipt. The receipt records the final
payload hash and byte ranges proving that those fragments occur in order without modification. It does
not attest that an external provider received the payload.

Bindings require `instructionLocale` and may include ordered `fallbackLocales`. Locale resolution is
fail-closed and never adds an implicit fallback. Set `trailingNewline: false` when the rendered text must
not end with the default terminal newline. The selected behavior is recorded in the invocation manifest.

Generated contracts use `Record<string, never>` for contexts without variables so extra values remain a
compile-time error.

## Hash identity

Definition, artifact, release, policy, catalog, rendered-text, and provider-message hashes use separate
domain separators and canonical JSON where applicable. A role change affects definition, release, and
catalog identity but not the locale artifact text hash. `messageHash` is produced only after rendering;
static inspection reports `messageRole`, not a message hash. These digests are integrity identifiers,
not signatures or proof of provider delivery. Source paths do not affect catalog identity. Golden
vectors in `packages/runtime/tests/golden/hash.json` freeze the contract across supported Node.js
releases.

Artifact compatibility, version mixing, deprecation, and migration requirements are defined in the
[compatibility policy](./compatibility.md).
