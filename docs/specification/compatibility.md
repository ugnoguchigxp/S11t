# Public API and compatibility policy

This policy applies from the first `0.1.0` release. Until that release, `0.0.0` and artifacts generated
from the repository are development contracts and may change without compatibility guarantees.

## Versioned surfaces

S11t treats the following as public compatibility surfaces:

- exports from `@s11t/runtime` and `@s11t/runtime/compiler`;
- exports and command-line behavior from `@s11t/cli`;
- `s11t.config.toml` and `.context.toml` authoring formats;
- `schemas/s11t-authoring.schema.json` and `schemas/s11t-artifact.schema.json`;
- generated `catalog.json` and `catalog.generated.ts` files;
- documented diagnostic codes, JSON output fields, and process exit codes.

Internal source modules that are not reachable through package `exports` are not public API.

## Compatibility matrix

`@s11t/runtime` and `@s11t/cli` are a fixed Changesets release group and always publish the same
version.

| Producer | Consumer | Support |
| --- | --- | --- |
| CLI and runtime at the exact same version | Artifact and generated types from that CLI | Supported and recommended |
| Different patch versions in the same minor line | Artifact and generated types | Supported; patch releases do not change the artifact shape incompatibly |
| Different minor versions before 1.0 | Artifact, generated types, or compiler primitives | Unsupported unless that release's notes explicitly say otherwise |
| Different major versions after 1.0 | Any public surface | Unsupported unless a migration guide explicitly provides an adapter |

`compilerVersion` is part of release and catalog identity. It records the producer; it is not a
negotiated compatibility range. `createCatalog()` validates structure, cross-field integrity, and
digests, but callers must not interpret successful validation as a guarantee that arbitrary
cross-minor artifacts are supported.

The generated `createAppCatalog()` also pins the expected catalog digest. Always deploy
`catalog.json` and `catalog.generated.ts` as one pair.

## Change rules

Before 1.0:

- patch releases are backward-compatible bug, security, documentation, and tooling fixes;
- minor releases may make breaking changes to public APIs, schemas, artifacts, diagnostics, or CLI
  syntax;
- every public change requires a Changeset, tests, and an updated specification or migration note.

From 1.0 onward, normal Semantic Versioning applies: backward-compatible additions use minor releases,
compatible fixes use patch releases, and breaking changes use major releases.

Adding a required artifact field, removing or renaming a field, changing hash inputs, changing generated
TypeScript contracts, or changing the meaning of an existing diagnostic is a breaking change. Because
artifact schemas reject unknown fields, even an additive artifact field requires an explicitly
coordinated compiler/runtime release.

## Deprecation period

Before 1.0, a deprecated public API is normally retained through the next minor release. From 1.0
onward, it is retained for at least one minor release and at least 90 days, whichever is longer.
Deprecations must appear in TypeScript documentation where applicable, the package changelog, and the
release notes.

The retention period may be shortened only for an actively exploitable security issue, data corruption,
or behavior that cannot be preserved safely. Such removals require a prominent release note and a
replacement or mitigation when one exists.

## Upgrade and migration procedure

1. Read both package changelogs and the release Changeset.
2. Upgrade `@s11t/runtime` and `@s11t/cli` to the same exact version.
3. Run `s11t lint` and `s11t build` with every deployed release profile.
4. Commit the regenerated `catalog.json` and `catalog.generated.ts` together.
5. Run application type checking, tests, and `s11t inspect --coverage` for required locales.
6. Exercise the release in a canary environment before production.

Do not hand-edit generated artifacts or carry an old generated TypeScript file beside a newly generated
catalog. If a release changes an authoring or artifact contract, its migration note must describe the
required source edits and regeneration command.
