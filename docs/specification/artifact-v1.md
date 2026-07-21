# S11t catalog artifact v1

Status: implementation contract for v0.1.

The runtime artifact is a JSON-compatible object with `format = "s11t.catalog"` and `schemaVersion = 1`. It contains compiled template segments but never runtime variable values, rendered text, application identity, timestamps, credentials, or absolute paths.

The machine-readable structural contract is [s11t-artifact-v1.schema.json](../../schemas/s11t-artifact-v1.schema.json). `@s11t/runtime` validates unknown input independently; the schema drift test runs both validators over the same accept/reject matrix.

Every context has at least one required locale, at least one compiled locale, and at least one section per locale. Required locale names are unique. The catalog `defaultLocale` must be compiled for every context. The compiler runs the same integrity checks as the runtime, so it never returns an artifact that `createCatalog()` would reject.

## Provenance

`createdFrom.configPath` and every `createdFrom.sourceFiles` entry are config-directory-relative POSIX paths. Backslashes, absolute paths, drive-prefixed paths, and `..` traversal are invalid. Provenance is excluded from semantic digests.

## Canonical JSON

Canonical JSON recursively sorts object keys, preserves array order, uses standard JSON string and finite-number serialization, and emits no insignificant whitespace. It rejects `undefined`, functions, symbols, bigints, non-finite numbers, cycles, and non-plain objects. UTF-8 bytes are hashed without Unicode normalization.

## Hash identity payloads

Every digest is lowercase SHA-256 formatted as `sha256:<64 hex>` and uses the domain string, a NUL byte, and the canonical payload.

| Digest | Domain | Identity payload |
| --- | --- | --- |
| definition | `s11t.definition.v1` | canonical context fields: ID, version, owner, output, source locale, required locales, variables, ordered sections |
| artifact | `s11t.artifact.v1` | context ID, locale, ordered compiled sections |
| release | `s11t.release.v1` | ID, version, schema version, compiler version, definition hash, locale/artifact-hash pairs sorted by locale |
| catalog | `s11t.catalog.v1` | schema version, compiler version, default locale, context-ID/release-digest pairs sorted by ID |
| rendered | `s11t.rendered.v1` | rendered UTF-8 text directly, without JSON encoding |

Hash fields never include themselves. Release and catalog identities omit source paths, time, Git information, and machine information. Golden vectors in `packages/runtime/tests/golden/hash-v1.json` freeze the v1 behavior.
