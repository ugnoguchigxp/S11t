# S11t Phase 5 packaging / release 実装計画

## Status

- Plan status: `local_gates_implemented`
- Created: 2026-07-21
- Target repository: `/Users/y.noguchi/Code/S11t`
- Scope: package tarball検証、隔離consumer、Changesets、canary/stable release基盤
- Out of scope: NightWorkers dogfood本体、`latest`への実publish、Phase 6 public API review

Implementation status on 2026-07-21:

- P5-01〜P5-06: implemented and verified locally。
- Snapshot version verification: `0.1.0-canary-<commit>`で成功。
- Stable version verification: 一時Git repository上の`0.1.0`で、実tarball、content allowlist、隔離consumer、`release:dry-run --channel stable`まで成功。
- Full review hardening: runtime決定性、path confinement、tarball checksum/export/version検証、immutable release SHA、Action SHA pin、OIDC jobのinstall script抑止、registry retryを実装。82 tests passed。
- P5-00: public GitHub repository、origin、default branch、package metadataを確定。npm scope confirmationのみ未完了。
- P5-07: external registry mutationのため未実施。

## 1. 目的

次の経路を再現可能かつfail-closeにする。

```text
runtime / CLI source
        │ pnpm pack:all
        ▼
2つの実tarball
        │ content allowlist / manifest validation
        ▼
隔離したESM Node consumer
        │ install / typecheck / CLI / runtime smoke
        ▼
Changesets snapshot version
        │ release:dry-run
        ▼
canary dist-tag publish
        │ downstream確認後のみ
        ▼
stable release候補
```

このPhaseでは、コードを作ることではなく次の証拠が揃った状態を完了とする。

1. workspace linkやregistry上の未公開S11t packageに依存せず、2つのtarballを隔離consumerへinstallできる。
2. tarballのESM export、TypeScript declaration、CLI bin、CLIからruntimeへの依存が動作する。
3. tarball内容がallowlistに収まり、absolute path、source fixture、test data、workspace protocolを含まない。
4. Changesetsがruntime / CLIを同じrelease lineとしてversioningできる。
5. canary versionが一意で、`canary`以外のdist-tag、とくに`latest`を変更しない。
6. publish workflowはOIDC trusted publishingを使い、長期npm write tokenを要求しない。
7. stable publish経路は用意するが、NightWorkers dogfoodとPhase 6 Gateが終わるまで実行不能にする。

## 2. 現状とブロッカー

実装着手時点（2026-07-21）の確認結果。現在の状態は冒頭のImplementation statusを参照する。

- `pnpm verify`: 成功、63 tests passed。
- `npm pack --dry-run --json`: runtime / CLIとも成功。
- rootに`pack:all`、`test:package-contents`、`test:consumer`、`release:dry-run`はない。
- `test-consumer/esm-node`、`.changeset/`、release workflowはない。
- package versionとcompiler versionは`0.0.0`。
- package metadataに`license`、`repository`、`homepage`、`bugs`がない。
- tarballには`LICENSE`、`NOTICE`、`README`は入るが、`SECURITY`と`CONTRIBUTING`は入らない。
- Git repositoryにcommitとremoteがない。GitHub Actionsやtrusted publisherの対象repositoryを確定できない。
- `npm whoami`は`E401`。この環境ではnpm identityを確認できない。
- `npm view @s11t/runtime`と`npm view @s11t/cli`は`E404`。未公開または権限不足であり、scope ownershipの証拠にはならない。

publish実装へ進む前に、次の値をユーザーが確定する。

| Decision | Required value | Stop condition |
| --- | --- | --- |
| GitHub repository | publicな`<owner>/<repo>` | remote未設定、またはprivate repositoryならprovenance publishへ進まない |
| npm scope | `@s11t`を利用可能か | owner/member権限を確認できなければfallback名を先に決める |
| package names | runtime / CLIの最終名 | registry availabilityと権限が未確認なら初回publishしない |
| protected environments | `npm-canary` / `npm-stable` | stable environmentにrequired reviewerがなければstable pathを有効化しない |

## 3. Locked decisions

### 3.1 実tarballを正本にする

- package検証は`--dry-run`出力だけで完了にしない。
- `pnpm pack`が生成した`.tgz`をcontent testとconsumer testの両方へ渡す。
- 出力先はrepository内のignored directory `.artifacts/packages/`に固定する。
- scriptはNode.jsで実装し、bash依存やOS固有path処理を避ける。

### 3.2 consumerをworkspaceから隔離する

- test scriptが`mkdtemp()`で一時directoryを作る。
- `test-consumer/esm-node`から必要なfixtureだけをcopyする。
- runtime tarballとCLI tarballを同一の`npm install`へ渡す。
- consumerからS11t repositoryの`node_modules`、workspace symlink、source importを使用しない。
- 外部dependencyのregistry取得は許可するが、`@s11t/*`は必ずfile tarballから解決されたことをlockfileと`npm ls`で確認する。

### 3.3 runtime / CLIを同じrelease lineにする

- Changesetsの`fixed` groupへ`@s11t/runtime`と`@s11t/cli`を入れる。
- CLIの`workspace:*` dependencyがpack時に公開可能な同一versionへ変換されることをtestする。
- package version変更時はpure runtime内の`COMPILER_VERSION`も同期する。
- version同期は手作業にせず、Changesetsのversion commandから呼ぶscriptで行う。

### 3.4 canaryはsnapshot releaseにする

- main上でChangesets prerelease modeへ入らない。
- ephemeral checkout上で`changeset version --snapshot canary`を使う。
- `.changeset/config.json`は`useCalculatedVersion: true`と、commit SHAを含むsnapshot templateを設定する。
- publishは必ず明示的に`--tag canary`を指定し、canaryではgit tagを作らない。
- publish前後の`latest` dist-tagを比較し、追加または変更を検出したら失敗にする。

Changesetsの通常prerelease modeは新規packageの初回公開を`latest`へ置く場合があるため、初回packageには使わない。

### 3.5 npm publish workflowは1ファイルに集約する

npm trusted publisherは1 packageにつき1設定である。したがってnpm publishを行うworkflowは
`.github/workflows/release.yml`だけにする。

- `release.yml`: `workflow_dispatch`の`channel=canary|stable`で実publishする唯一のworkflow。
- `canary.yml`: PRまたは手動実行でsnapshot tarball、content、consumer、dry-runを検証する。npm publishは行わない。
- trusted publisherのworkflow filenameは`release.yml`とする。

### 3.6 stable pathは実装しても閉じておく

- stable jobはGitHub environment `npm-stable`を要求する。
- canary registry consumer、NightWorkers dogfood、Phase 6 reviewの証拠がない場合はstable jobを失敗させる。
- Phase 5では`release:dry-run --channel stable`までを自動検証し、`latest`へのpublishは行わない。

## 4. 実装単位

## P5-00 Repository / registry前提を確定する

変更:

1. initial commitを作成可能な状態まで既存成果物をreviewする。
2. public GitHub repositoryを作成し、`origin`とdefault branch `main`を設定する。
3. `@s11t` scopeのowner/member権限と2 package名をnpm UIまたは認証済みCLIで確認する。
4. rootと両packageのmetadataへ次を追加する。
   - `license: "Apache-2.0"`
   - case-sensitiveに一致する`repository`
   - `homepage`
   - `bugs`
   - `publishConfig.registry: "https://registry.npmjs.org/"`
   - public packageには`publishConfig.access: "public"`

検証:

```bash
git remote -v
npm whoami
npm view @s11t/runtime
npm view @s11t/cli
pnpm install --frozen-lockfile
pnpm verify
```

期待結果:

- GitHub repository URLとpackage metadataがcase-sensitiveに一致する。
- registryの`E404`だけをscope ownershipの証拠として扱わない。
- scopeが使えない場合は、package名を変更してから以降の実装へ進む。

## P5-01 Changesetsとversion同期を導入する

追加・変更対象:

```text
.changeset/config.json
.changeset/README.md
packages/runtime/CHANGELOG.md
packages/cli/CHANGELOG.md
scripts/sync-package-versions.mjs
package.json
pnpm-lock.yaml
packages/runtime/src/compiler.ts または生成version module
```

実装:

1. `@changesets/cli`をversion固定したdevDependencyとして追加する。
2. Changesets configを次の方針で作る。
   - `access: "public"`
   - `baseBranch: "main"`
   - runtime / CLIを同じ`fixed` groupにする。
   - `updateInternalDependencies: "patch"`
   - snapshotはcalculated versionと`{tag}-{commit}`を使う。
3. 初回release用changesetで両packageを`minor` bump対象にする。
4. `version-packages` scriptを`changeset version`とcompiler version同期の組合せにする。
5. canary snapshotでもstable version PRでもpackage versionと`COMPILER_VERSION`が一致するtestを追加する。

追加script:

```json
{
  "changeset": "changeset",
  "version-packages": "changeset version && node scripts/sync-package-versions.mjs"
}
```

期待するversion:

- repository上の初回stable候補: `0.1.0`
- canary: `0.1.0-canary-<commit>`相当の一意なversion
- `0.0.0`のままpublish対象になった場合は失敗

## P5-02 実tarball生成とcontent allowlistを実装する

追加・変更対象:

```text
scripts/pack-all.mjs
scripts/check-package-contents.mjs
.gitignore
package.json
packages/runtime/package.json
packages/cli/package.json
packages/runtime/SECURITY.md
packages/runtime/CONTRIBUTING.md
packages/cli/SECURITY.md
packages/cli/CONTRIBUTING.md
```

root scripts:

```json
{
  "pack:all": "node scripts/pack-all.mjs",
  "test:package-contents": "node scripts/check-package-contents.mjs"
}
```

`pack-all.mjs`:

1. repository rootと出力先を明示的に解決する。
2. `.artifacts/packages/`配下の既知の`.tgz`だけを削除する。
3. build後、runtime、CLIの順で`pnpm pack --pack-destination`を実行する。
4. 2 tarballの絶対path、package名、version、SHA-512をmachine-readable manifestへ出す。
5. 期待外の3個目のtarballと異なるrelease lineを拒否する。`0.0.0`はlocal packaging testでは許可し、release dry-runで拒否する。

`check-package-contents.mjs`:

1. tar archiveをNodeから読み、packageごとのallowlistとrequired filesを検証する。
2. runtimeはroot exportと`./compiler` exportのJS / declarationが存在することを確認する。
3. CLIはexecutableな`bin/s11t.js`とdist entrypointが存在することを確認する。
4. 両packageに`README.md`、`LICENSE`、`NOTICE`、`SECURITY.md`、`CONTRIBUTING.md`があることを確認する。
5. 全text fileとpacked `package.json`を走査し、次を拒否する。
   - `workspace:`
   - `/Users/`、`C:\\`等のabsolute build path
   - `contexts/*.toml`、fixture、test、`.tsbuildinfo`
   - repository rootへの`file:` dependency
6. CLIのpacked dependencyが同じversionの`@s11t/runtime`へ解決されていることを確認する。

## P5-03 隔離ESM consumerを実装する

追加対象:

```text
test-consumer/esm-node/package.json
test-consumer/esm-node/tsconfig.json
test-consumer/esm-node/s11t.config.toml
test-consumer/esm-node/contexts/identity.context.toml
test-consumer/esm-node/src/index.ts
scripts/test-tarball-consumer.mjs
```

root script:

```json
{
  "test:consumer": "node scripts/test-tarball-consumer.mjs"
}
```

consumer testの実行順:

1. OS temporary directoryを作り、consumer fixtureだけをcopyする。
2. runtime / CLI tarballを同じ`npm install`へ渡す。
3. installed packageとlockfileにworkspace linkやS11t repository pathがないことを確認する。
4. local binの存在を確認してから`npm exec -- s11t --help`を実行する。
5. `s11t lint`、`s11t build`、`s11t build --check`を実行する。
6. consumerのTypeScriptを`tsc --noEmit`またはbuildして、generated declarationとruntime exportを解決する。
7. Node ESMでgenerated JSONをapplication-owned loaderから読み、generated `createAppCatalog()`、`bind()`、`p()`を実行する。
8. key、日本語text、manifest digest、compiler versionをassertする。
9. test終了時にtemporary directoryを削除する。失敗時はdebug flagで保持できるようにする。

consumer testは少なくともNode 22と24で実行する。package tarball作成はNode 24 / Ubuntuで1回、consumer smokeは
Linux / macOS / Windowsでpathとbin差を確認する。

## P5-04 release dry-runを実装する

追加対象:

```text
scripts/release-dry-run.mjs
package.json
```

root script:

```json
{
  "release:dry-run": "node scripts/release-dry-run.mjs"
}
```

interface:

```bash
pnpm release:dry-run -- --channel canary
pnpm release:dry-run -- --channel stable
```

dry-runはpublishせず、次を順に実行・表示する。

1. commit SHA、branch、remote repositoryとsnapshot生成前のclean Git stateを確認する。snapshot生成後はChangesetsが変更するversion、lockfile、changelog、compiler versionだけを許可する。
2. `pnpm verify`、`pack:all`、package contents、consumerを実行する。
3. `pnpm audit --prod --audit-level high`を実行する。
4. package名、version、tarball hash、packed dependency、registry、予定dist-tagを表示する。
5. `npm publish <tarball> --dry-run --json --access public --tag <tag>`を実行する。
6. registry上の同一version有無と現在のdist-tagsをread-onlyで確認する。
7. canaryではprerelease versionと`canary` tagを要求する。
8. stableではprereleaseでないversion、pending changesetなし、`npm-stable` approval前提を要求する。
9. `0.0.0`、既存version、dirty tree、package version不一致、`latest`を指すcanaryを拒否する。

出力は人間向けsummaryとCI artifact用JSONの両方を生成する。

## P5-05 CI package Gateを追加する

`.github/workflows/ci.yml`へpackage jobを追加する。

```text
verify matrix
  Node 22 / 24 × Linux / macOS / Windows

package job
  Ubuntu + Node 24
  build
  pack:all
  test:package-contents
  test:consumer
  upload tarball manifest（tarball自体は必要な場合だけ短期artifact）
```

追加でconsumerのWindows bin / path問題を検出するため、既存matrixのNode 24行でもconsumer smokeを実行する。
全matrixで毎回packすると時間が増えるため、tarball本体のcontent検査はUbuntu jobへ集約する。

## P5-06 canary validation / publish workflowを実装する

追加対象:

```text
.github/workflows/canary.yml
.github/workflows/release.yml
```

### `canary.yml`

- trigger: `workflow_dispatch`。通常PRをChangesets必須にしないため自動実行しない。
- permissions: `contents: read`
- GitHub-hosted Ubuntu / Node 24 / npm 11.5.1以上
- temporary snapshot versionを生成する。
- `pnpm verify`、pack、contents、consumer、`release:dry-run --channel canary`を実行する。
- npm registryへはpublishしない。

### `release.yml`

- trigger: `workflow_dispatch`。main push時はChangesets actionでversion PRだけを作成・更新する。
- input: `channel=canary|stable`、40桁のimmutable commit SHA。canaryはmain履歴上、stableは現在のmain HEADだけを許可する。
- npm publishを行う唯一のworkflow。
- publish job permissions: `contents: read`、`id-token: write`。
- GitHub-hosted Ubuntu runnerを使い、release buildではdependency cacheを無効にする。
- elevated permissionを持つjobではdependency lifecycle scriptを実行せず、外部Actionはcommit SHAへ固定する。
- npm CLI 11.5.1以上を明示確認する。
- canaryは`npm-canary`、stableはrequired reviewer付き`npm-stable` environmentを使う。
- stable jobは`npm-stable` environmentの`S11T_STABLE_RELEASE_ENABLED`が明示的に有効化されるまでfail-closeする。Phase 5では有効化しない。
- publish前に必ずdry-run Gateを再実行する。
- publish後にregistry反映遅延をretryしながらpackage/version/dist-tagを再取得する。
- canaryではpublish前後の`latest`が同一であることをassertする。
- stableではprovenance付きpackageが取得できることをregistry consumerと`npm audit signatures`で確認する。

## P5-07 初回package bootstrapとtrusted publisher設定

trusted publisherはregistryに存在するpackageへしか設定できないため、初回だけbootstrapが必要になる。

1. P5-00〜P5-06をmainへ入れ、public GitHub repositoryとmetadataを確定する。
2. disposable worktreeで`0.1.0-canary.0`相当のversionを生成する。
3. `release:dry-run --channel canary`を通す。
4. npm web login / 2FAを使う一時的なinteractive sessionから、runtime、CLIの順で
   `--access public --tag canary`を明示して初回publishする。
5. `npm dist-tag ls`で`canary`だけが設定され、`latest`が存在しないことを確認する。
6. npmjs.comで両packageのtrusted publisherをGitHub Actionsの`release.yml`へ設定する。
7. repository名、workflow filename、allowed action `npm publish`をcase-sensitiveに確認する。
8. OIDC canaryを1回publishし、provenanceとregistry consumerを確認する。
9. 不要になったlocal auth session / tokenを破棄する。

初回bootstrapもstable versionをpublishしない。`latest`が意図せず作られた場合は作業を停止し、dist-tagを
修正して監査記録を残す。package versionは再利用できないため、同じversionの再publishを試みない。

## 5. Test matrix

| Concern | Command / evidence | Expected result |
| --- | --- | --- |
| Baseline | `pnpm verify` | 既存63 testsと全boundary checkが成功 |
| Real pack | `pnpm pack:all` | 2 tarballとmanifestだけを生成 |
| Contents | `pnpm test:package-contents` | required files、exports、bin、allowlistが成功 |
| Workspace removal | packed CLI manifest | `workspace:*`が公開versionへ変換済み |
| ESM runtime | isolated consumer | root exportと`./compiler`がNode ESMで利用可能 |
| Types | isolated consumer `tsc` | declarationsとgenerated catalog typeが解決可能 |
| CLI | isolated consumer | `s11t --help/lint/build/build --check`が成功 |
| Cross platform | GitHub Actions | Node 22/24、Linux/macOS/Windowsでconsumer成功 |
| Dependencies | `pnpm audit --prod --audit-level high` | known high / critical vulnerabilityなし |
| Canary preview | `release:dry-run --channel canary` | unique version、tag=`canary`、publishなし |
| Stable preview | `release:dry-run --channel stable` | stable version、全前提表示、publishなし |
| OIDC | `release.yml` canary publish | token secretなしでpublish成功 |
| Provenance | registry install + signatures | attestationを確認 |
| Dist-tags | before / after comparison | canaryが`latest`を変更しない |

## 6. Stop / rollback conditions

次のいずれかで後続stepへ進まない。

1. GitHub repositoryが未確定、private、またはpackage metadataと一致しない。
2. npm scope ownershipまたはpackage名の利用権限を確認できない。
3. packed manifestに`workspace:`、absolute path、repository `file:` dependencyが残る。
4. isolated consumerがregistry上の`@s11t/*`へfallbackする。
5. runtimeとCLI、またはcompiler versionが一致しない。
6. tarballにfixture、test、秘密値、不要なsourceが入る。
7. canary versionが一意でない、または`latest`が変化する。
8. self-hosted runner、古いnpm CLI、`id-token: write`なしでpublishしようとする。
9. trusted publisher確認前にOIDC publishを成功扱いにする。
10. canary downstream検証前にstable pathを実行する。

publish後に失敗した場合、同一versionを再publishしない。修正版は新しいcanary versionとして出し、誤った
dist-tagは明示的に修正する。npm packageの削除を通常のrollback手段にしない。

## 7. Review / implementation order

レビュー可能な変更単位は次の4つに分ける。

1. **Packaging foundation**: metadata、Changesets、version同期、pack script。
2. **Consumer Gate**: content allowlist、isolated consumer、CI package job。
3. **Release safety**: dry-run、canary validation、single OIDC publisher workflow。
4. **Registry bootstrap**: scope確認、初回canary、trusted publisher、OIDC canary検証。

1〜3は外部publishなしで実装・reviewできる。4はnpm / GitHubの外部状態を変更するため、別途明示承認を
得て実施する。

## 8. Definition of done

- `pnpm pack:all`、`pnpm test:package-contents`、`pnpm test:consumer`、`pnpm release:dry-run`が存在する。
- `test-consumer/esm-node`が実tarballだけで成功する。
- CIにpackage / consumer Gateがあり、Node 22/24と3 OSの必要な証拠が揃う。
- `.changeset/`と両packageのCHANGELOGがversion PRで管理される。
- runtime / CLI / compiler versionが同一release lineになる。
- canary previewとpublishが`latest`を変更しない。
- `release.yml`だけがnpm publish権限を持つ。
- trusted publishingが長期write tokenなしでcanary publishできる。
- tarballにREADME、SECURITY、LICENSE、NOTICE、CONTRIBUTINGが含まれる。
- registry canaryをfresh consumerへinstallし、ESM、types、CLI、provenanceを確認できる。
- stable pathは用意されているが、NightWorkers dogfoodとPhase 6 Gateなしには実行できない。

## 9. Official references

- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/)
- [Changesets prereleases](https://github.com/changesets/changesets/blob/main/docs/prereleases.md)
- [Changesets config](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md)
- [Changesets action](https://github.com/changesets/action)
