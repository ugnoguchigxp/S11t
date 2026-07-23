# S11t catalog artifact v3

Artifact v3 preserves the content-first authoring, explicit locale binding, aliases, and request APIs from
artifact v2. It adds the `delimited-context-v1` rendering contract.

Select it explicitly in config:

```toml
schema_version = 2
authoring_version = 2
artifact_version = 3
```

Existing artifact v1 and v2 rendered text is unchanged.

## Delimited context rendering

Every variable whose `placement` is `delimited-context` is rendered as:

```text
<S11T_DELIMITED_CONTEXT variable="variableName">
encoded value
</S11T_DELIMITED_CONTEXT>
```

Artifact v3 requires every `untrusted` variable to use `delimited-context` and a non-raw encoding.
For untrusted values, `<`, `>`, `&`, U+2028, and U+2029 are escaped after deterministic JSON encoding,
including characters in nested JSON strings and object keys. A runtime value therefore cannot emit the
closing delimiter.

This contract protects the structural boundary. It does not make untrusted text semantically trustworthy,
prevent every form of prompt injection, or replace host-side authorization and tool enforcement.

`renderingContract`, schema version 3, variable placement, and encoding participate in artifact v3 digest
identity. Invocation manifests report `artifactSchemaVersion = 3` and
`renderingContract = "delimited-context-v1"`.

The machine-readable structural contract is
[`s11t-artifact-v3.schema.json`](../../schemas/s11t-artifact-v3.schema.json).
