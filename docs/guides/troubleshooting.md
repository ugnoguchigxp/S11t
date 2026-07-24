# Troubleshooting

## npm reports `E404` for `@s11t/runtime` or `@s11t/cli`

The packages are not available from the npm registry before the first repository bootstrap. Use the
pnpm workspace for repository development. Do not treat `0.0.0` tarballs as published production
packages.

After the first release, verify the requested dist-tag and registry:

```sh
npm view @s11t/runtime dist-tags
npm config get registry
```

## A command says `--release-profile is required`

Every lint, build, and inspect operation requires an explicit profile. Select a name declared under
`release_profiles` in `s11t.config.toml`:

```sh
s11t lint --release-profile development
```

## `S11T_BUILD_STALE` is reported

Generated output differs from the current sources, configuration, or compiler. Rebuild and commit the
JSON and TypeScript outputs together:

```sh
s11t build --release-profile development
git diff -- .s11t/catalog.json .s11t/catalog.generated.ts
```

Do not update only one generated file.

## A locale is missing or resolves unexpectedly

S11t uses only the requested locale and explicitly ordered fallbacks. It never adds the source locale
implicitly. Inspect the catalog before changing release policy:

```sh
s11t inspect --coverage --locale en-US --fallback-locale ja-JP \
  --release-profile development --format json
```

## Human diagnostics are difficult to process

Use `--format json`. Validation diagnostics are written to stderr and contain stable `code`, `severity`,
`message`, `file`, and `path` fields. Exit codes are documented in
[diagnostics](../specification/diagnostics.md).

## Install shell completion

For the current shell session:

```sh
# bash
source <(s11t completion bash)

# zsh
source <(s11t completion zsh)

# fish
s11t completion fish | source
```

For persistent completion, save the emitted script in the completion directory used by the shell
installation. Run `s11t help completion` for the supported shell names.

## Runtime rejects an artifact or reports a digest mismatch

Upgrade `@s11t/runtime` and `@s11t/cli` together, regenerate both outputs, and verify that deployment did
not mix files from different builds. Cross-minor artifacts are unsupported unless release notes say
otherwise. See the [compatibility policy](../specification/compatibility.md).

If the failure remains, run:

```sh
pnpm verify
pnpm test:packages
```

Report a suspected vulnerability privately using the process in the repository `SECURITY.md`.
