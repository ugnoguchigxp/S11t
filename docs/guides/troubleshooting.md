# Troubleshooting

## npm reports `E404` for `s11tnext` or `s11tnext-cli`

The packages are not available from the npm registry before the first repository bootstrap. Use the
pnpm workspace for repository development. Do not treat `0.0.0` tarballs as published production
packages.

After the first release, verify the requested dist-tag and registry:

```sh
npm view s11tnext dist-tags
npm config get registry
```

## A command says `--release-profile is required`

Every lint, build, and inspect operation requires an explicit profile. Select a name declared under
`release_profiles` in `s11tnext.config.toml`:

```sh
s11tnext lint --release-profile development
```

## `S11TNEXT_BUILD_STALE` is reported

Generated output differs from the current sources, configuration, or compiler. Rebuild and commit the
JSON and TypeScript outputs together:

```sh
s11tnext build --release-profile development
git diff -- .s11tnext/catalog.json .s11tnext/catalog.generated.ts
```

Do not update only one generated file.

## A locale is missing or resolves unexpectedly

S11tnext uses only the requested locale and explicitly ordered fallbacks. It never adds the source locale
implicitly. Inspect the catalog before changing release policy:

```sh
s11tnext inspect --coverage --locale en-US --fallback-locale ja-JP \
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
source <(s11tnext completion bash)

# zsh
source <(s11tnext completion zsh)

# fish
s11tnext completion fish | source
```

For persistent completion, save the emitted script in the completion directory used by the shell
installation. Run `s11tnext help completion` for the supported shell names.

## Runtime rejects an artifact or reports a digest mismatch

Upgrade `s11tnext` and `s11tnext-cli` together, regenerate both outputs, and verify that deployment did
not mix files from different builds. Cross-minor artifacts are unsupported unless release notes say
otherwise. See the [compatibility policy](../specification/compatibility.md).

If the failure remains, run:

```sh
pnpm verify
pnpm test:packages
```

Report a suspected vulnerability privately using the process in the repository `SECURITY.md`.
