# s11tnext-cli

The S11tnext CLI owns TOML loading, authoring validation, deterministic compilation, type generation, and
artifact emission.
Supported Node.js releases are 20.19+, 22, and 24.

This package is available from the npm registry and remains in `0.x` pre-release development.
Review the changelog and compatibility policy when upgrading.

```sh
npm install --save-dev s11tnext-cli
```

```sh
s11tnext lint [--config s11tnext.config.toml] --release-profile name [--format human|json]
s11tnext build [--config s11tnext.config.toml] --release-profile name [--check] [--format human|json]
s11tnext inspect key [--resolved] [--locale ja-JP] --release-profile name [--format human|json]
s11tnext inspect --coverage --locale en-US [--fallback-locale ja-JP] --release-profile name [--format human|json]
s11tnext completion bash|zsh|fish
s11tnext help [command]
s11tnext --version
```

Sources are content-first. The CLI derives canonical dot keys from paths, resolves locale, owner, and
variable policy at project level, and always requires an explicit release profile.

Root `message_role = "system" | "user"` declares the role of the single provider message rendered by a
context and defaults to `system`. Generated types expose `PromptKey`, `PromptMessageRoleMap`, and
role-specific `PromptInvocation` results. Static inspect output includes `messageRole`; `messageHash`
exists only after runtime rendering.

Source locale may be overridden per keyspace or document. Variables may be optional, sections may use
`omit_if_empty`, and generated TypeScript indentation can be configured while retaining deterministic
output.

Coverage inspection reports canonical keys as `direct`, ordered explicit `fallback`, or `missing`.
It never adds the source locale implicitly and does not change build policy. Release profiles may scope
required locales by keyspace, and coverage output includes the resolved requirements for every context.
Reusable section profiles provide `kind`, `severity`, and `optimizable` without repeating them in each
section.

See the [getting-started guide](https://github.com/ugnoguchigxp/s11tnext/blob/main/docs/guides/getting-started.md),
[compatibility policy](https://github.com/ugnoguchigxp/s11tnext/blob/main/docs/specification/compatibility.md),
and [troubleshooting guide](https://github.com/ugnoguchigxp/s11tnext/blob/main/docs/guides/troubleshooting.md).
