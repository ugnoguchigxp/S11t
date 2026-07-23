# S11t diagnostics

CLI diagnostics are stable objects with `code`, `severity`, `message`, `file`, and `path`; TOML syntax
errors also include line and column. Human output is written to stderr. `--format json` emits a JSON
array for machine consumers.

The main categories are:

- configuration and IO: `S11T_CONFIG_INVALID`, `S11T_FILE_NOT_FOUND`,
  `S11T_SOURCE_DIR_NOT_FOUND`, `S11T_SOURCE_EMPTY`, `S11T_TOML_SYNTAX`;
- authoring: `S11T_SOURCE_INVALID`, `S11T_SOURCE_SHAPE_CONFLICT`, `S11T_KEY_INVALID`,
  `S11T_KEY_COLLISION`, `S11T_KEY_ALIAS_INVALID`, `S11T_OWNER_UNRESOLVED`;
- locale and policy: `S11T_RELEASE_PROFILE_REQUIRED`, `S11T_RELEASE_PROFILE_NOT_FOUND`,
  `S11T_TRANSLATION_MISSING`, `S11T_LOCALE_INVALID`, `S11T_LOCALE_NOT_FOUND`;
- variables and safety: `S11T_VARIABLE_PROFILE_NOT_FOUND`, `S11T_VARIABLE_UNDECLARED`,
  `S11T_VARIABLE_UNUSED`, `S11T_PLACEHOLDER_INVALID`, `S11T_ENCODING_TYPE_MISMATCH`,
  `S11T_UNSAFE_UNTRUSTED_RAW`, `S11T_UNSAFE_UNTRUSTED_PLACEMENT`;
- generated output: `S11T_BUILD_STALE`;
- runtime: `S11T_ARTIFACT_INVALID`, `S11T_ARTIFACT_DIGEST_MISMATCH`,
  `S11T_CONTEXT_NOT_FOUND`, `S11T_VALUE_MISSING`, `S11T_VALUE_EXTRA`, `S11T_VALUE_INVALID`.

CLI exit codes are `0` for success, `1` for validation failure, `2` for command misuse, and `3` for an
unexpected internal error.
