# Migrating to 0.1.2

S11tnext 0.1.2 introduces artifact version 2, authored provider-message roles, optional variables,
conditional sections, reusable section profiles, and newline-preserving untrusted text.

Version `0.1.1` is intentionally skipped and is not published. Although `0.1.2` is a patch-numbered
release, it is a documented one-time compatibility reset from the initial `0.1.0` contract.

1. Upgrade `s11tnext` and `s11tnext-cli` to exactly `0.1.2`.
2. Remove section `enforcement` fields. Keep descriptive `kind`, `severity`, and `optimizable` metadata,
   preferably through `section_profiles`.
3. Add `message_role = "user"` to contexts that must be submitted as user messages. Omitted roles
   remain `system`.
4. Replace `json-string` with `delimited-text` for untrusted multiline Markdown or retrieved text when
   actual newlines must be preserved.
5. Mark optional values with `required = false` and use `omit_if_empty = true` on optional overlay
   sections.
6. Move keyspace-specific locale requirements to
   `release_profiles.<name>.required_locales_by_keyspace` when catalog-wide requirements are too broad.
7. Run `s11tnext lint` and `s11tnext build` for every deployed release profile, then commit
   `catalog.json` and `catalog.generated.ts` together.
8. Update provider adapters to submit `{ role: invocation.role, content: invocation.content.text }`.
   Persist `manifest.messageRole` and `manifest.messageHash` where prompt-message integrity is audited.

Artifact version 2 is intentionally incompatible with unversioned 0.1 artifacts. The Runtime reports
`S11TNEXT_ARTIFACT_VERSION_UNSUPPORTED` rather than guessing compatibility. There is no in-place artifact
adapter; rebuild from authored sources.

`SystemContextInvocation` and related system-only aliases remain temporarily available as deprecated
compatibility names. New code should use `PromptInvocation`, `PromptKey`, and
`PromptMessageRoleMap`.
