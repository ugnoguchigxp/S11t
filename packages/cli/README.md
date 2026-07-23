# @s11t/cli

The S11t command-line interface owns TOML loading, authoring validation, deterministic compilation, type generation, and artifact emission.

```sh
npm install --save-dev @s11t/cli
```

```sh
s11t lint [--config s11t.config.toml] [--release-profile name] [--format human|json]
s11t build [--config s11t.config.toml] [--release-profile name] [--check] [--format human|json]
s11t inspect key [--resolved] [--locale ja-JP] [--release-profile name] [--format human|json]
s11t migrate authoring-v2 [--write | --restore operation-id] [--config s11t.config.toml] [--format human|json]
```

Config v1 continues to build artifact v1 unchanged. Config v2 uses content-first source files, derives
canonical dot keys from their paths, resolves locale/owner/variable policy at project level, and requires an
explicit release profile for lint, build, and inspect.

Migration is a dry-run by default. `--write` creates checksummed backups and returns an operation ID;
`--restore` uses that ID and refuses to overwrite files changed after migration.

Start new catalogs with the
[v2 guide](https://github.com/ugnoguchigxp/S11t/blob/main/docs/guides/getting-started.md). Existing v1
catalogs can use the dry-run-first
[migration guide](https://github.com/ugnoguchigxp/S11t/blob/main/docs/guides/migrating-v1-to-v2.md).
