# @s11t/cli

The S11t CLI owns TOML loading, authoring validation, deterministic compilation, type generation, and
artifact emission.

```sh
npm install --save-dev @s11t/cli
```

```sh
s11t lint [--config s11t.config.toml] --release-profile name [--format human|json]
s11t build [--config s11t.config.toml] --release-profile name [--check] [--format human|json]
s11t inspect key [--resolved] [--locale ja-JP] --release-profile name [--format human|json]
s11t inspect --coverage --locale en-US [--fallback-locale ja-JP] --release-profile name [--format human|json]
```

Sources are content-first. The CLI derives canonical dot keys from paths, resolves locale, owner, and
variable policy at project level, and always requires an explicit release profile.

Coverage inspection reports canonical keys as `direct`, ordered explicit `fallback`, or `missing`.
It never adds the source locale implicitly and does not change build policy.

See the [getting-started guide](https://github.com/ugnoguchigxp/S11t/blob/main/docs/guides/getting-started.md).
