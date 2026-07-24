# S11tnext authoring format

Each `.context.toml` file contains content and variable declarations. Project-wide ownership, source
locale, release locale policy, and reusable variable and section profiles live in
`s11tnext.config.toml`.

```toml
source_dir = "contexts"
out_dir = ".s11tnext"

[authoring]
source_locale = "ja-JP"

[governance]
require_owner = true

[keyspaces.codingAgent]
owner = "agent-platform"

[release_profiles.development]
required_locales = ["$source"]

[release_profiles.development.required_locales_by_keyspace]
codingAgent = ["$source", "ja-JP"]

[variable_profiles."untrusted.multiline"]
type = "string"
trust = "untrusted"
placement = "delimited-context"
encoding = "delimited-text"

[section_profiles."user.overlay"]
kind = "overlay"
severity = "may"
optimizable = false

[generation]
typescript_indent = 2
```

`authoring.source_locale` is the project default. A keyspace may override it with `source_locale`, and an
individual `.context.toml` document may set root `source_locale`. Resolution order is document, longest
matching keyspace, then project default. `$source` is resolved after this selection.

```toml
[keyspaces.englishDocs]
owner = "docs-team"
source_locale = "en-US"
```
The longest matching `required_locales_by_keyspace` entry similarly overrides a release profile's
default requirements for that context.

`inspect --coverage --format json` reports effective values in `sourceLocalesByContext` and
`requiredLocalesByContext`. Its singular `sourceLocale` field is the project default retained for
compatibility, not necessarily the source locale of every context.

Generated TypeScript uses tabs by default. Set `generation.typescript_indent` to `"tab"` or an integer
from 1 to 8 to select the number of spaces.

A file may use root `text` plus `translations`, or an ordered `sections` array. It must not use both
forms. Its canonical dot key is always derived from the source-relative path.

```toml
message_role = "user"

[variables.userContext]
profile = "untrusted.multiline"
required = false

[[sections]]
id = "user.context"
profile = "user.overlay"
omit_if_empty = true
text = '''
<USER_SYSTEM_CONTEXT>
[[userContext]]
</USER_SYSTEM_CONTEXT>
'''
```

`message_role` declares the provider-message role for the complete rendered context. Supported values
are `system` and `user`; omission defaults to `system` for source compatibility. A context always
renders exactly one provider message. Sections describe ordered content within that message and never
create provider-message boundaries. The role is security-sensitive metadata, but it does not prove
delivery, authorization, or provider acceptance.

All sections define the same locale set. Each translation must use the same placeholder-name set as the
source locale for that section. Placeholders must be declared and every declared variable must be used.
Untrusted variables require `delimited-context` placement and a non-raw encoding. `delimited-text`
preserves multiline text and escapes boundary characters; `json-string` intentionally emits a JSON
string and represents embedded newlines as `\n`.

Variables are required by default. Set `required = false` on an inline declaration or profile reference
to make a value optional; an absent optional placeholder renders as an empty string. A section may set
`omit_if_empty = true` to omit itself when all of its referenced values are absent or empty. Such a
section must contain at least one placeholder. The invocation manifest lists only rendered section IDs.

Section profiles supply `kind`, `severity`, and `optimizable`; `id`, content, and `omit_if_empty` remain
local to the section. Authors may instead specify all three metadata fields inline. `enforcement` is not
an authoring field: schema validation, authorization, and host/tool enforcement remain external controls
and are never inferred from prompt metadata.

The machine-readable source contract is
[`schemas/s11tnext-authoring.schema.json`](../../schemas/s11tnext-authoring.schema.json). Cross-file policy and
reference rules are enforced by the CLI in addition to JSON Schema.

All `lint`, `build`, and `inspect` operations require an explicit `--release-profile`.
