# s11tnext-cli

The S11tnext CLI owns TOML loading, authoring validation, deterministic compilation, type generation, and
artifact emission.
Supported Node.js releases are 20.19+, 22, and 24.

This package is in pre-release development and is not yet available from the npm registry. The install
command below applies after the first registry bootstrap.

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

Coverage inspection reports canonical keys as `direct`, ordered explicit `fallback`, or `missing`.
It never adds the source locale implicitly and does not change build policy.

See the [getting-started guide](https://github.com/ugnoguchigxp/s11tnext/blob/main/docs/guides/getting-started.md),
[compatibility policy](https://github.com/ugnoguchigxp/s11tnext/blob/main/docs/specification/compatibility.md),
and [troubleshooting guide](https://github.com/ugnoguchigxp/s11tnext/blob/main/docs/guides/troubleshooting.md).
