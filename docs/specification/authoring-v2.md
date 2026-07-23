# S11t authoring v2

Authoring v2 keeps the SystemContext body in each `.context.toml` and moves repeated policy to
`s11t.config.toml`.

## Project configuration

```toml
schema_version = 2
authoring_version = 2
artifact_version = 2
source_dir = "contexts"
out_dir = ".s11t"

[authoring]
source_locale = "ja-JP"

[governance]
require_owner = true

[keyspaces.structuredGeneration]
owner = "structured-generation"

[release_profiles.development]
required_locales = ["$source"]

[variable_profiles."trusted.block"]
type = "string"
trust = "trusted"
placement = "delimited-context"
encoding = "raw"
```

`authoring.source_locale` is the only authoring-language declaration. A context cannot override or
relabel it. Runtime language selection is not stored in this config or in an artifact default; the host
binds it once at its top-level request/run boundary.

The root `text` (or each section's `text`) is the source-locale authority. A `translations` table whose
key equals `authoring.source_locale` is rejected instead of silently overriding that text.

## Content-first source

`contexts/structuredGeneration/repair.context.toml`:

```toml
text = '''構造化応答を修復してください。
[[outputRequirements]]'''

[variables.outputRequirements]
profile = "trusted.block"

[translations.en-US]
text = '''Repair the structured response.
[[outputRequirements]]'''
```

The canonical key is `structuredGeneration.repair`. Each path segment must match
`^[A-Za-z][A-Za-z0-9_-]*$`. An explicit root `key` is available only for migrations.

## Resolution

The CLI resolves values in this order:

1. derive the canonical key from the source path;
2. resolve owner by the longest keyspace match;
3. assign root `text` to `authoring.source_locale`;
4. expand the selected release profile and `$source`;
5. expand variable profiles;
6. validate locale coverage, placeholders, and variable safety;
7. compile the resolved semantic definition.

All v2 commands require an explicit release profile:

```sh
s11t lint --release-profile development
s11t build --release-profile development
s11t inspect structuredGeneration.repair --resolved --release-profile development
```

## Migration

```sh
s11t migrate authoring-v2 --config s11t.config.toml
s11t migrate authoring-v2 --config s11t.config.toml --write
s11t migrate authoring-v2 --config s11t.config.toml --restore authoring-v2-<operation-id>
```

Dry-run is the default. The write form generates project-level owner, locale, release, variable-profile,
and legacy-alias policy, then reloads the v2 project and rejects any content, section, variable, owner, or
locale semantic drift. Dry-run performs the same generated-TOML parse and semantic comparison before any
filesystem mutation. A v1 project with per-context required locales that cannot be represented by one v2
release profile is rejected explicitly.

Before the first replacement, the write form stores original bytes, before/after SHA-256 digests, and a
manifest under `.s11t/migrations/<operation-id>/`. A prepared operation blocks another write until it is
restored. Restore verifies backup checksums and refuses to overwrite a target whose bytes match neither
the recorded before nor after state.
