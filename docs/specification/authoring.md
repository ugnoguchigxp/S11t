# S11t authoring format

Each `.context.toml` file contains content and variable declarations. Project-wide ownership, source
locale, release locale policy, and reusable variable profiles live in `s11t.config.toml`.

```toml
source_dir = "contexts"
out_dir = ".s11t"

[authoring]
source_locale = "ja-JP"

[governance]
require_owner = true

[keyspaces.codingAgent]
owner = "agent-platform"

[release_profiles.development]
required_locales = ["$source"]
```

A file may use root `text` plus `translations`, or an ordered `sections` array. It must not use both
forms. Its canonical dot key is always derived from the source-relative path.

```toml
text = "Task: [[taskGoal]]"

[variables.taskGoal]
type = "string"
trust = "untrusted"
placement = "delimited-context"
encoding = "json-string"

[translations."ja-JP"]
text = "タスク: [[taskGoal]]"
```

All sections define the same locale set. Each translation must use the same placeholder-name set as the
source locale for that section. Placeholders must be declared and every declared variable must be used.
Untrusted variables require `delimited-context` placement and a non-raw encoding.

The machine-readable source contract is
[`schemas/s11t-authoring.schema.json`](../../schemas/s11t-authoring.schema.json). Cross-file policy and
reference rules are enforced by the CLI in addition to JSON Schema.

All `lint`, `build`, and `inspect` operations require an explicit `--release-profile`.
