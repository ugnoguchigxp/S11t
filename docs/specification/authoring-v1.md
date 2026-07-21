# S11t authoring format v1

Status: implementation contract for v0.1.

Each SystemContext is authored as one `.context.toml` file with `schema_version = 1`. A project uses one explicitly selected `s11t.config.toml`; v0.1 does not search parent directories.

## Project configuration

```toml
schema_version = 1
source_dir = "contexts"
out_dir = ".s11t"
required_locales = ["ja-JP", "en-US"]
default_locale = "ja-JP"
```

Directories must be relative and cannot contain parent traversal. Existing symlinks may not resolve outside the configuration directory, and both paths must resolve to directories when they already exist. `default_locale` must appear in `required_locales`.

Locale identifiers use the portable v0.1 subset `^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$`. This covers the language/script/region forms used by S11t without claiming to validate every grandfathered or private-use BCP 47 tag.

## Context shape

`context.id` uses `namespace:key`, `version` is strict SemVer (including the prohibition on leading zeroes in numeric prerelease identifiers), `source_locale` must appear in `required_locales`, and `output` is exactly `text` in v0.1.

A source defines exactly one of:

- `locales`: a simple text context, normalized to the stable section ID `context.text`.
- `sections`: an ordered array of sectioned text definitions.

Every required locale must exist in every section. Newlines are normalized from CRLF or CR to LF before hashing. Unicode normalization is not applied.

## Variables and interpolation

Variable names and `[[variableName]]` placeholders use `^[A-Za-z][A-Za-z0-9_]*$`. Every placeholder must be declared and every declaration must be referenced at least once.

All v0.1 variables have `required = true`. Supported types are `string`, `number`, `boolean`, and `json`; trust is `trusted` or `untrusted`; placement is `inline` or `delimited-context`; encoding is `raw`, `json-string`, or `json-value`.

The following combinations are rejected:

- `untrusted` with `raw`.
- `raw` with a non-`string` type.
- `json-string` with the `json` type.

The machine-readable contract is [s11t-authoring-v1.schema.json](../../schemas/s11t-authoring-v1.schema.json). Cross-file and cross-field rules are enforced by the CLI validator in addition to JSON Schema.
