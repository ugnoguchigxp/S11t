# @s11t/cli

The S11t command-line interface owns TOML loading, authoring validation, deterministic compilation, type generation, and artifact emission.

```sh
s11t lint [--config s11t.config.toml] [--release-profile name] [--format human|json]
s11t build [--config s11t.config.toml] [--release-profile name] [--check]
s11t inspect key [--resolved] [--locale ja-JP] [--release-profile name]
s11t migrate authoring-v2 [--write] [--config s11t.config.toml]
```

Config v1 continues to build artifact v1 unchanged. Config v2 uses content-first source files, derives
canonical dot keys from their paths, resolves locale/owner/variable policy at project level, and requires an
explicit release profile for lint, build, and inspect.
