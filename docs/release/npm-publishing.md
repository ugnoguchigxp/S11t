# npm publishing runbook

This runbook separates the one-time package bootstrap from normal OIDC releases. Repository preparation
does not authorize a publish; every registry-changing step below is a maintainer operation.

## Current release contract

- Public packages: `s11tnext` and `s11tnext-cli`.
- Both packages are a fixed Changesets group and must publish the same version.
- `canary` is a commit-addressed snapshot and must never move `latest`.
- `stable` is a normal SemVer version from the version PR and must publish from the exact `main` head.
- `.github/workflows/release.yml` is the only npm publishing workflow. The root package commands described
  below only dispatch that workflow; they never publish directly from the local checkout.
- Stable publishing remains disabled until the repository variable
  `S11TNEXT_STABLE_RELEASE_ENABLED` is explicitly set to `true`.

The workflow validates an immutable 40-character commit SHA, package metadata, registry uniqueness,
tarball contents, an isolated ESM install, production dependency audit, registry dist-tags, signatures,
and provenance. A successful stable publish then creates an annotated `v<version>` tag and GitHub Release
at the same commit.

## External prerequisites

Before any dispatch:

1. Confirm the maintainer owns the unscoped `s11tnext` and `s11tnext-cli` package names and both are intended
   to be public.
2. Enable 2FA on every npm maintainer account.
3. Protect `main` and require the CI matrix.
4. Enable GitHub private vulnerability reporting and verify the link in `SECURITY.md`.
5. Create GitHub environments:
   - `npm-bootstrap`: required reviewer; used once.
   - `npm-canary`: required reviewer appropriate for prereleases.
   - `npm-stable`: strict required reviewer; no self-approval if the repository plan supports it.
6. Keep `S11TNEXT_STABLE_RELEASE_ENABLED` absent or `false` during bootstrap and canary validation.
7. Review package tarballs for secrets and unexpected files with `pnpm test:packages`.

Both package names are unscoped and public. S11tnext records the public registry explicitly in each
package's `publishConfig`, and the dry-run also supplies `--access public`.

## One-command workflow dispatch

The root package exposes convenience commands that read the shared release version from
`packages/runtime/package.json` and `packages/cli/package.json`, resolve the current Git commit, and
dispatch the existing GitHub Actions workflow:

```sh
pnpm release:publish:plan
pnpm release:publish:bootstrap
pnpm release:publish:canary
pnpm release:publish
```

`release:publish` dispatches `stable`. The other commands select the channel named by their suffix.
The commands require a clean, committed checkout and an authenticated GitHub CLI. Commit and push the
exact release state before dispatching. The workflow remains responsible for npm authentication,
pre-publication checks, publishing both packages, provenance, signatures, dist-tags, and registry
verification.

The plan command performs no dispatch and prints the package names, version, repository, commit,
confirmation value, and resulting `gh workflow run` arguments. No version environment variable is used.

## One-time bootstrap

npm Trusted Publisher settings live under an existing package, and staged publishing cannot create a new
package. The first publication therefore uses the workflow's explicit `bootstrap` channel with a
short-lived granular access token.

1. Merge the release preparation to `main`, but leave the initial Changesets version PR unmerged. The
   pending changeset is what produces the ephemeral `0.1.0-canary-<sha>` version.
2. Copy the exact 40-character `main` SHA.
3. Create a short-expiry granular npm token that can publish both public packages and can operate without
   an interactive OTP. Store it only as the `NPM_BOOTSTRAP_TOKEN` secret in the `npm-bootstrap`
   environment.
4. Dispatch `Release` with:
   - `channel`: `bootstrap`
   - `ref`: the exact `main` SHA
   - `confirm`: `publish-bootstrap`
5. Approve the `npm-bootstrap` environment and watch every verification step.
6. Confirm both `canary` dist-tags point to the same commit-addressed version and `latest` is absent or
   unchanged.

The workflow rejects `bootstrap` if either package name already exists. A partial first publication must
be repaired deliberately; it cannot fall back to the token bootstrap path.

Bootstrap runs on a GitHub-hosted runner with `id-token: write` and
`NPM_CONFIG_PROVENANCE=true`, so the first publication can carry provenance even though authentication
uses the temporary token. npm documents the supported CI and provenance requirements in
[Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements/).

Stop immediately if only one package publishes. Do not reuse the version or move `latest`; inspect the
registry, repair the unpublished package only after confirming its dependency version exists, and record
the partial release in the GitHub issue or release log.

## Switch to Trusted Publishing

After both package pages exist, configure the following Trusted Publisher separately on
`s11tnext` and `s11tnext-cli`:

| npm field | value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `ugnoguchigxp` |
| Repository | `s11tnext` |
| Workflow filename | `release.yml` |
| Environment name | leave blank |
| Allowed actions | `npm publish` |

The environment is intentionally blank in npm because each package supports only one Trusted Publisher
and the same workflow uses separate `npm-canary` and `npm-stable` GitHub environments. Approval boundaries
remain enforced in GitHub. npm requires the workflow filename only, not
`.github/workflows/release.yml`, and all fields are case-sensitive; see
[Trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Then:

1. Record the bootstrap result in a reviewed release-log or documentation commit on `main`, without
   consuming the initial changeset. This gives the OIDC proof a new commit-addressed canary version.
2. Dispatch a normal `canary` release from that immutable commit SHA with `publish-canary`.
3. Verify the run authenticates through OIDC and `npm audit signatures` succeeds.
4. Verify npm shows provenance for both packages.
5. Delete the `NPM_BOOTSTRAP_TOKEN` GitHub secret and revoke the npm token.
6. In each npm package's publishing access, require 2FA and disallow token publishing.

Do not delete the bootstrap token until one OIDC canary succeeds. Do not retain it after that proof.

## Stable `0.1.0`

1. Confirm the version PR contains matching non-prerelease versions, generated changelogs, and no pending
   Changesets.
2. Install the packed artifacts into NightWorkers or another real host and exercise Japanese and English
   through the top-level language setting.
3. Confirm provider paths use `bind()` when the invocation manifest is needed and untrusted runtime values
   do not use raw encoding.
4. Run CI on the exact version commit and review `pnpm release:dry-run -- --channel stable` output from a
   clean checkout.
5. Set `S11TNEXT_STABLE_RELEASE_ENABLED=true`.
6. Dispatch `Release` with the exact `main` SHA, `channel=stable`, and `confirm=publish-stable`.
7. Approve `npm-stable`.
8. Verify:
   - `latest` for both packages is the same version;
   - a fresh install and CLI invocation succeed;
   - registry signatures and provenance verify;
   - the annotated `v<version>` tag and GitHub Release point to the published commit.
9. Set `S11TNEXT_STABLE_RELEASE_ENABLED=false` again if the gate is intended to remain one-shot.

If npm publication succeeds but tag or GitHub Release creation fails, do not republish the immutable npm
version. Rerun or repair only the `v<version>` tag/release after verifying it targets the exact published
commit.

## Optional staged publishing after bootstrap

Staged publishing is not part of the initial `0.1.0` path. It requires npm CLI 11.15.0 or newer, Node
22.14.0 or newer, an already-existing package, and a separate 2FA approval. Adopting it later requires:

1. keeping the release workflow pinned to npm 11.15.0 or newer;
2. allowing `npm stage publish` in both Trusted Publisher settings;
3. changing the publish implementation to stage runtime and CLI in dependency order;
4. reviewing both staged tarballs and approving both with 2FA;
5. preserving the same post-approval dist-tag, consumer, signature, and provenance checks.

See npm's [staged publishing requirements](https://docs.npmjs.com/staged-publishing/) before changing the
workflow.
