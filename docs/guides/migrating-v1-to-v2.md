# Migrating authoring v1 to v2

Authoring v2 makes source files content-first, derives canonical dot keys from paths, centralizes repeated
policy, and removes the artifact default locale. Config v1 and artifact v1 remain supported, so migrate as
a deliberate project change rather than mixing formats.

## What changes

| v1 | v2 |
| --- | --- |
| `schema_version = 1` | `schema_version`, `authoring_version`, and `artifact_version` are `2` |
| `default_locale` in the artifact | no default; the host passes `instructionLocale` |
| per-context `key`, owner, locale, and variable policy | path-derived key plus project-level policy |
| colon key such as `codingAgent:task` | canonical dot key such as `codingAgent.task` |
| `fallbackLocale` | ordered `fallbackLocales` |
| optional command policy selection | explicit `--release-profile` on v2 commands |
| broad empty values object | `Record<string, never>` for contexts without variables |

## Generate and inspect the migration

Start from a clean branch and run the default dry-run:

```sh
npx s11t migrate authoring-v2 --config s11t.config.toml
```

The dry-run generates the proposed TOML in memory, parses it again, and compares its resolved semantics
with v1 without writing files. It refuses migrations whose per-context locale requirements cannot be
represented by one project release profile.

Apply only after the dry-run succeeds:

```sh
npx s11t migrate authoring-v2 --config s11t.config.toml --write
npx s11t lint --config s11t.config.toml --release-profile development
npx s11t build --config s11t.config.toml --release-profile development
npx s11t build --check --config s11t.config.toml --release-profile development
```

The write command prints an operation ID and stores checksummed backups under `.s11t/migrations/`. If
review finds a problem before subsequent authoring edits, restore the exact operation:

```sh
npx s11t migrate authoring-v2 \
  --config s11t.config.toml \
  --restore authoring-v2-<operation-id>
```

Restore refuses to overwrite a file that differs from both the pre-migration and migrated checksums.
Migration and restore preserve each source file's original POSIX permission bits. The journal directory
contains a managed `.gitignore`, so source-bearing backups are not added to Git. Config, source,
manifest, and backup symlinks are refused rather than replaced or followed during mutation.

List retained operations and remove a completed journal after review:

```sh
npx s11t migrate authoring-v2 --config s11t.config.toml --list
npx s11t migrate authoring-v2 \
  --config s11t.config.toml \
  --purge authoring-v2-<operation-id>
```

Purge refuses a `prepared` operation because it may be the only durable route back to the original
files. Restore it first. Journals are never deleted automatically.

The migration keeps legacy colon keys in `key_aliases`, allowing a staged caller migration. New code
should use the generated canonical dot keys.

## Update the host boundary

Replace a v1 binding:

```ts
const p = catalog.bind({
  instructionLocale,
  fallbackLocale: "en-US",
});
```

with an explicit v2 binding:

```ts
const p = catalog.bind({
  instructionLocale: topLevelSettings.instructionLocale,
  fallbackLocales: topLevelSettings.instructionFallbackLocales,
});
```

There is no implicit source-locale fallback. An empty `fallbackLocales` array means fail closed when the
requested locale is unavailable. Keep the locale in the request/run's top-level settings and create one
binding for that lifecycle. When the language variable changes, the next request creates a new binding;
an in-flight request retains its snapshot.

Use `bind()` wherever the provider call, audit record, hash, or locale diagnosis needs the invocation
manifest. Use `bindText()` only for text composition that shares one fixed snapshot. Reserve
`createTextRenderer()` for independent calls that intentionally observe the latest top-level setting.

## Verify before removing aliases

1. Search callers for legacy colon keys and `fallbackLocale`.
2. Exercise at least two real translations; a fallback-only test does not prove language switching.
3. Verify one request that renders multiple contexts from the same bound function.
4. Persist or inspect `requestedLocale`, `resolvedLocale`, `renderedHash`, and `releaseDigest` from the
   invocation manifest on audited paths.
5. Verify runtime/provider inputs use an `untrusted` profile with a non-raw encoding.
6. Remove a legacy alias only after deployed callers no longer emit it.

The durable operation backup handles immediate migration rollback; version control remains the
longer-lived rollback and review mechanism. Keep the v1-to-v2 conversion in an isolated commit, then
purge the completed journal when the version-controlled result has been reviewed.
