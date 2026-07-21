# S11t diagnostics v1

CLI diagnostics contain a stable `code`, `severity`, `message`, source `file`, and structured `path`; line and column are optional until a source location is available. Programs must branch on `code`, not message text.

Phase 1 authoring codes are:

| Code | Meaning |
| --- | --- |
| `S11T_CONFIG_INVALID` | Invalid project configuration |
| `S11T_SOURCE_INVALID` | Invalid or unsupported source shape |
| `S11T_SCHEMA_VERSION_UNSUPPORTED` | Unknown config or authoring schema version |
| `S11T_UNSUPPORTED_OUTPUT` | Reserved output kind used in v0.1 |
| `S11T_UNSUPPORTED_OPTIONAL_VARIABLE` | `required = false` used in v0.1 |
| `S11T_DUPLICATE_ID` | Context ID appears in more than one file |
| `S11T_LOCALE_MISSING` | Required or source locale is missing |
| `S11T_VARIABLE_UNDECLARED` | Placeholder has no declaration |
| `S11T_VARIABLE_UNUSED` | Declared variable is not referenced |
| `S11T_PLACEHOLDER_INVALID` | Placeholder syntax is malformed or unsupported |
| `S11T_UNSAFE_UNTRUSTED_RAW` | Untrusted variable uses raw encoding |
| `S11T_ENCODING_TYPE_MISMATCH` | Encoding and declared type are incompatible |
| `S11T_SECTION_DUPLICATE_ID` | Section ID repeats in one context |
| `S11T_SOURCE_SHAPE_CONFLICT` | Simple and sectioned shapes are both present or both absent |
| `S11T_FILE_NOT_FOUND` | Configured input file cannot be read |
| `S11T_TOML_SYNTAX` | TOML parsing failed, with line and column when available |
| `S11T_SOURCE_DIR_NOT_FOUND` | Configured source directory does not exist |
| `S11T_SOURCE_EMPTY` | No `.context.toml` files were discovered |
| `S11T_BUILD_STALE` | `build --check` detected missing or stale generated output |

Runtime artifact validation throws `S11T_ARTIFACT_INVALID` with a structured path. Digest mismatches use `S11T_ARTIFACT_DIGEST_MISMATCH`; catalog lookup, locale resolution, and runtime value validation use the stable `S11T_CONTEXT_NOT_FOUND`, `S11T_LOCALE_NOT_FOUND`, `S11T_VALUE_MISSING`, `S11T_VALUE_EXTRA`, and `S11T_VALUE_INVALID` codes.
