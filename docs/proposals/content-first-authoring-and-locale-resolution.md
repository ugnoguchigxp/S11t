# S11t Content-first Authoring and Locale Resolution 実装計画

## Status

- Plan status: core implementation complete; NightWorkers local canary verified
- Created: 2026-07-22
- Last reviewed against implementation: 2026-07-22
- Target: S11t authoring v2 / catalog artifact v2
- Primary concern: SystemContext編集者がmetadataではなく本文へ集中できること
- Compatibility: authoring v1とcatalog artifact v1を移行期間中サポートする
- First migration target: NightWorkersの単一SystemContext catalog
- Decision: 本文を正本とする方針を採用し、v1を固定したままv2を追加する

### Implementation status (2026-07-22)

- P0〜P3: authoring/config/artifact/runtime v2、schema、test vectorsを実装済み。
- P4: `s11t migrate authoring-v2`を実装済み。`s11t move`と`s11t locale promote`は未実装。
- P5: NightWorkersの70 contextをcontent-firstへ移行し、canonical dot keyへ切替済み。旧key利用0件を確認し、NightWorkers artifactから互換aliasを削除済み。
- NightWorkersの言語切替元はGeneral Settings最上位の`language`だけとし、`ja`→`ja-JP`、`en`→`en-US`を確認済み。現在は日本語sourceのみのため、英語設定では明示的に`ja-JP`へfallbackする。
- S11t local/package GateとNightWorkersのtypecheck、verify、backend/desktop bundleは成功済み。commit由来のcanary version発行は未実施。

## 1. 結論

S11t authoring v2では、通常のSystemContext fileをcontent-firstにする。

1. `id`を廃止し、i18nと同じdot keyをsource pathから導出する。
2. `version`を必須metadataから削除し、正確なrevision identityはdigestで表す。
3. `output = "text"`を削除する。SystemContextの既定content kindはtextとし、将来別kindを追加するときだけ差分を宣言する。
4. `owner`を各contextから削除し、dot keyのprefixに対するproject設定として管理する。
5. `schema_version`、`source_locale`、`required_locales`を各contextから削除する。
6. source localeはproject authoring設定で一度だけ宣言し、runtimeで使用するlocaleとは分離する。
7. runtime localeはrequest/runごとに必須指定し、catalogの静的default localeへ暗黙依存しない。
8. 反復するvariable定義は安全性を保ったnamed profileへまとめる。
9. shorthandを展開したresolved canonical definitionをhash対象にし、省略によって監査性を失わない。
10. `s11t inspect --resolved`で、継承後の全metadataと由来を確認できるようにする。

目標とする通常のauthoring fileは次の形である。

```toml
text = '''あなたは構造化応答の修復を担当します。
元の回答の意味を維持し、契約不整合だけを直してください。
[[outputRequirements]]'''

[variables.outputRequirements]
profile = "trusted.block"
```

このfileを`contexts/structuredGeneration/repair.context.toml`へ置いた場合、keyは
`structuredGeneration.repair`になる。

## 2. 背景

S11t v0.1は、各`.context.toml`に次のmetadataを必須要求する。

```toml
schema_version = 1

[context]
id = "structuredGeneration:repair"
version = "1.0.0"
owner = "structured-generation"
source_locale = "ja-JP"
required_locales = ["ja-JP"]
output = "text"

[variables.outputRequirements]
required = true
type = "string"
trust = "trusted"
placement = "delimited-context"
encoding = "raw"

[locales."ja-JP"]
text = '''...'''
```

個々のfieldには意味があるが、同じ値をすべてのfileへ書くことは、その意味を明確にするよりも
SystemContext本文から注意を奪う結果になっている。

NightWorkersの2026-07-22時点のcatalogでは次の反復が発生している。

| 項目 | 実測 |
| --- | ---: |
| Context files | 70 |
| TOML total lines | 2,089 |
| `schema_version = 1` | 70 |
| `source_locale = "ja-JP"` | 70 |
| `required_locales = ["ja-JP"]` | 70 |
| `output = "text"` | 70 |
| `version = "1.0.0"` | 67 |
| Variable declarations | 68 |
| 最多variable shape | `trusted / string / inline / raw`: 52 |

これは単なる見た目の問題ではない。

- 本文review時に安全上重要な差分がmetadataへ埋もれる。
- locale policyを変更すると、多数のfileを機械的に更新する必要がある。
- 同じvariable policyのcopyがずれ、trustやencodingの誤設定を生みやすい。
- 手動SemVerが実際のcontent変更と同期しない。
- `namespace:key`がi18n keyや階層pathと異なる独自記法になっている。
- `default_locale`がauthoring言語とruntime選択言語を同じ概念に見せている。

## 3. Design principles

### 3.1 Content first

通常のfileでは本文が最初に見えることを優先する。metadataは、context固有の差分だけを書く。

### 3.2 Progressive disclosure

text以外のcontent kind、個別owner、個別locale policyなどが将来必要になった場合も、該当contextだけが
追加fieldを宣言する。現在すべてtextであることを全fileへ書かせない。

### 3.3 Locale identityとruntime locale selectionを分離する

日本語で書かれたsource textを日本語と識別するmetadata自体は必要である。一方、そのmetadataを各fileへ
書く必要はなく、runtimeが常に日本語を選ぶ理由にもならない。

- authoring source locale: literal textが何語かを表す。projectで一度だけ宣言する。
- translation coverage: release時に何語を必須とするかを表す。
- requested locale: request/runごとにhostが指定する。
- fallback locales: request/runまたは明示的なruntime policyが順序付きで指定する。

source localeを設定変更だけで別言語へ「切り替える」ことは禁止する。それは日本語本文を英語と誤表示する
relabelになるためである。primary source languageを変更する場合は、translationを昇格する専用commandで
本文とlocale mappingを同時に変更する。

### 3.4 Safe shorthand

省略は安全性を弱めてはならない。特にvariableの`trust`と`encoding`を名前や本文から推測しない。
省略できるのは、明示的に選んだprofileを決定的に展開できる場合だけとする。

### 3.5 Resolved semantics are canonical

hash、type generation、runtime artifactは、raw TOMLではなくdefaultsとprofilesを展開したcanonical definitionを
入力にする。同じ意味を持つlong formとshorthandは同じdefinition hashを生成する。

## 4. Dot key model

### 4.1 Path-derived key

`source_dir`からのrelative pathをdot keyへ変換する。

| Source path | Derived key |
| --- | --- |
| `codingAgent/identity.context.toml` | `codingAgent.identity` |
| `codingAgent/runtime/system.context.toml` | `codingAgent.runtime.system` |
| `structuredGeneration/repair.context.toml` | `structuredGeneration.repair` |

変換規則:

1. `.context.toml`を除去する。
2. path separatorを`.`へ変換する。
3. 各segmentは`^[A-Za-z][A-Za-z0-9_-]*$`を満たす。
4. keyはcase-sensitiveとする。
5. 正規化後の重複keyをbuild errorにする。

`namespace:key`はauthoring v2で新規生成しない。runtime v2のkey contractもdot keyを使用する。

### 4.2 Explicit key override

通常はkeyを書かない。既存keyを維持したままfileを移動するmigration等に限り、rootの`key`を許可する。

```toml
key = "structuredGeneration.repair"
text = '''...'''
```

overrideは例外であり、CLIはpath-derived keyとの差を`inspect --resolved`へ表示する。

### 4.3 Rename and aliases

path renameは既定ではkeyのbreaking changeである。安全なrename用に次を提供する。

```sh
s11t move structuredGeneration.repair structuredGeneration.outputRepair
```

commandはfile移動とalias追加を同一操作で行う。

```toml
[key_aliases]
"structuredGeneration.repair" = "structuredGeneration.outputRepair"
```

aliasは移行用途に限定し、循環、複数hop、alias先不存在をlint errorにする。生成TypeScriptでは旧keyを
deprecatedとして残せるようにする。

## 5. Metadata model

### 5.1 Remove `version` from required authoring

content identityには既存の`definitionHash`、`releaseDigest`、`catalogDigest`を使用する。手動SemVerは正確な
revision判定に使わない。

artifact v2とinvocation manifestでは次の形にする。

```ts
type SystemContextRevision = {
	definitionHash: string;
	releaseDigest: string;
	catalogDigest: string;
	label?: string;
};
```

人間向けのrelease名が必要な場合だけ、optionalな`label`を付ける。`label`はidentityの代わりにしない。
authoring v1の`version`はv1 artifactを生成する間だけ維持する。

### 5.2 Remove `output = "text"` from authoring

authoring v2の既定content kindはtextとする。artifactではruntime validationのdiscriminantとして
`contentKind = "text"`を保持してよいが、authorに反復させない。

将来message配列等を追加する場合は、非default kindだけを明示する。

```toml
content_kind = "messages"
```

将来の可能性だけを理由に、現在の全contextへ`text`を書かせない。

### 5.3 Move `owner` to key-prefix policy

ownerはcontext本文ではなくproject governanceである。dot key prefixに対して一度だけ定義する。

```toml
[keyspaces.codingAgent]
owner = "coding-agent"

[keyspaces.missionPilot]
owner = "mission-pilot"

[keyspaces.structuredGeneration]
owner = "structured-generation"
```

最長一致するkeyspaceを採用する。owner未解決を許可するかはproject policyで決める。

```toml
[governance]
require_owner = true
```

個別owner overrideは原則提供しない。所有境界の例外が必要なら、より具体的なkeyspaceを設定する。

### 5.4 Remove per-file `schema_version`

authoring schemaはproject configで選ぶ。

```toml
schema_version = 2
authoring_version = 2
artifact_version = 2
```

移行期間中は、`schema_version`を持つ既存contextをv1、持たないcontent-first contextをv2として読み込める。
新規projectではconfigの`authoring_version`と`artifact_version`をそれぞれの出力境界の正本とする。

## 6. Locale design

### 6.1 Project authoring locale

literal textの言語はprojectで一度だけ宣言する。

```toml
[authoring]
source_locale = "ja-JP"
```

通常のcontextではlocale tableを使わない。

```toml
text = '''日本語のSystemContext本文'''
```

translationがある場合だけlocaleを明示する。

```toml
text = '''日本語のSystemContext本文'''

[translations.en-US]
text = '''English SystemContext text'''
```

`ja-JP`を各contextへ固定記述しない。`en-US`は実在するtranslationを識別するためにだけ現れる。

### 6.2 Release-time locale coverage

required localeはcontext metadataではなくrelease profileに置く。

```toml
[release_profiles.development]
required_locales = ["$source"]

[release_profiles.production]
required_locales = ["ja-JP", "en-US"]
```

`$source`は`authoring.source_locale`への明示的aliasである。CLIはprofileを指定してlint/buildする。

```sh
s11t lint --release-profile development
s11t build --release-profile production
```

これにより、同じcontext fileを編集せずにtranslation coverage policyを切り替えられる。

### 6.3 Runtime locale has no hidden default

artifact v2では`defaultLocale`を必須にしない。hostはrequest/runごとにlocaleをbindする。

```ts
const p = catalog.bind({
	instructionLocale: run.instructionLocale,
	fallbackLocales: run.instructionFallbackLocales,
});
```

- `instructionLocale`は必須。
- `fallbackLocales`は順序付き配列で、省略時はfallbackしない。
- request localeがなくfallbackも解決できなければfail closedする。
- `sourceLocale`を暗黙fallbackとして使用しない。
- environment variableやprocess-global mutable localeをruntimeが直接読まない。

これにより、同じcatalog instanceで日本語、英語、その他localeをrequest単位に切り替えられる。

### 6.4 Source locale promotion

primary authoring languageを変更する場合は単純なconfig変更ではなく、専用commandを使う。

```sh
s11t locale promote en-US
```

commandは次をatomicに行う。

1. 現在の`en-US` translationが全対象contextに存在することを確認する。
2. `text`と旧source translationを入れ替える。
3. `authoring.source_locale`を更新する。
4. resolved definitionとdigest差分を表示する。

本文を変更せずlocale labelだけを変更する操作は提供しない。

## 7. Variable profiles

### 7.1 Project-defined profiles

反復するvariable shapeをconfigへ置く。

```toml
[variable_profiles."trusted.inline"]
type = "string"
trust = "trusted"
placement = "inline"
encoding = "raw"

[variable_profiles."trusted.block"]
type = "string"
trust = "trusted"
placement = "delimited-context"
encoding = "raw"

[variable_profiles."untrusted.text"]
type = "string"
trust = "untrusted"
placement = "delimited-context"
encoding = "json-string"

[variable_profiles."untrusted.json"]
type = "json"
trust = "untrusted"
placement = "delimited-context"
encoding = "json-value"
```

authoring側はprofileだけを選ぶ。

```toml
[variables.outputRequirements]
profile = "trusted.block"
```

### 7.2 Required behavior

v2でvariableが引き続きrequired-onlyなら`required = true`をauthoringから完全に削除する。optional variableを
追加するversionでのみ、`optional = true`を差分として導入する。

### 7.3 Safety rules

- profileは名前ではなく展開後のfieldで安全性検証する。
- `untrusted + raw`はprofile経由でも拒否する。
- profile不存在、循環継承、未知fieldはfail closedする。
- variable名やplaceholder位置からtrustを推測しない。
- inline overrideを許可する場合も、profile展開後に完全なcontractを生成して検証する。
- security-sensitive profile変更は、そのprofileを使う全contextのdigestを変更する。

初期実装ではprofile inheritanceを提供しない。1 profileを完全な定義とし、解決規則を単純に保つ。

## 8. Complete project example

### 8.1 `s11t.config.toml`

```toml
schema_version = 2
authoring_version = 2
artifact_version = 2
source_dir = "contexts"
out_dir = ".s11t"

[authoring]
source_locale = "ja-JP"

[governance]
require_owner = true

[keyspaces.structuredGeneration]
owner = "structured-generation"

[release_profiles.development]
required_locales = ["$source"]

[release_profiles.production]
required_locales = ["ja-JP", "en-US"]

[variable_profiles."trusted.block"]
type = "string"
trust = "trusted"
placement = "delimited-context"
encoding = "raw"
```

### 8.2 `contexts/structuredGeneration/repair.context.toml`

```toml
text = '''あなたは構造化応答の修復を担当します。
元の回答の意味、判断、主張、自由記述を維持し、JSON構文・契約・参照不整合だけを直してください。
不足情報を推測で創作したり、アプリケーション都合の別回答へ置き換えたりしないでください。
[[outputRequirements]]'''

[variables.outputRequirements]
profile = "trusted.block"

[translations.en-US]
text = '''You repair structured responses.
Preserve the original meaning and only fix JSON syntax, contract, and reference inconsistencies.
[[outputRequirements]]'''
```

### 8.3 Runtime

```ts
const p = catalog.bind({
	instructionLocale: request.locale,
	fallbackLocales: request.localeFallbacks,
});

const systemContext = p("structuredGeneration.repair", {
	outputRequirements,
});
```

## 9. Resolution and precedence

CLIはraw authoringを次の順でresolved canonical definitionへ変換する。

1. source pathからdot keyを導出する。
2. explicit `key`があればmigration overrideとして適用する。
3. 最長一致keyspaceからownerを解決する。
4. project authoring source localeをsource textへ割り当てる。
5. selected release profileからrequired locale setを解決する。
6. translation tableをlocale mapへ展開する。
7. variable profileを完全なvariable contractへ展開する。
8. textをstable section `context.text`へ正規化する。
9. cross-field safety validationを行う。
10. canonical definitionをcompilerへ渡す。

raw sourceの記述方法ではなく、step 10の結果をdefinition hashへ使用する。

## 10. Inspectability

継承はnoiseを減らす一方、値の由来を見えにくくする。CLIで必ず解決結果を表示できるようにする。

```sh
s11t inspect structuredGeneration.repair --resolved --release-profile production
```

出力例:

```text
key: structuredGeneration.repair
key source: path contexts/structuredGeneration/repair.context.toml
owner: structured-generation
owner source: keyspaces.structuredGeneration
content kind: text (built-in default)
source locale: ja-JP
source locale source: authoring.source_locale
required locales: ja-JP, en-US
required locales source: release_profiles.production
variable outputRequirements: trusted.block
resolved variable: string / trusted / delimited-context / raw / required
definition hash: sha256:...
```

JSON形式も提供し、CIやeditor integrationから使用できるようにする。

```sh
s11t inspect structuredGeneration.repair --resolved --release-profile production --format json
```

## 11. Artifact and runtime changes

### 11.1 Artifact v2

artifact v2では次を変更する。

- context map keyをdot keyにする。
- legacy keyからcanonical keyへの1-hop alias mapを持つ。
- manual SemVer `version`を必須から外す。
- `defaultLocale`を削除し、runtime bindを明示化する。
- resolved owner、source locale、available/required locales、variable contractsは保持する。
- text content kindはruntime discriminantとして保持する。
- release profile名とresolved policy digestをprovenanceへ記録する。

authoringの簡略化はartifactの検証を弱めるものではない。runtimeは引き続きunknown artifactを完全検証する。

### 11.2 Hash identity

definition identityにはresolved semantic fieldsを含める。

- dot key
- resolved owner
- content kind
- source locale
- required locales
- fully expanded variable definitions
- ordered sections and translations

profile名そのものはidentityへ入れず、展開結果を入れる。同じprofile名の内容が変われば利用contextの
definition hashが変化する。release profileのcoverage policyとalias mapはcatalog build identityへ含める。

### 11.3 Runtime binding

artifact v2の`catalog.bind()`はrequested localeを必須にし、複数fallbackを受け取る。

```ts
type CatalogBindingV2 = {
	instructionLocale: string;
	fallbackLocales?: readonly string[];
};
```

process-global locale setterや、build時localeをruntime requestへ暗黙適用するAPIは追加しない。

## 12. Backward compatibility

### 12.1 Authoring

- v1 authoring fileは変更なしでlint/buildできる。
- v2 projectは移行中にv1 fileとv2 fileを混在可能にし、両方をresolved v2へ変換してartifact v2を生成する。
- v1の`namespace:key`はv1 runtime artifactを生成する限り維持する。
- v2 migrationではpath-derived dot keyをcanonicalとし、旧colon keyからのaliasを生成する。
- 未知fieldを黙って無視しない既存方針を維持する。

### 12.2 Artifact

- `createCatalog()`はartifact `schemaVersion`でv1/v2 validatorをdispatchする。
- v1 artifactのhash contractを変更しない。
- v2 artifactには新しいgolden hash vectorを用意する。
- generated factoryはartifact versionに対応したkey/value型を生成する。

### 12.3 Migration command

```sh
s11t migrate authoring-v2 --config s11t.config.toml --write
```

commandはdry-runを既定とし、次を表示する。

- pathから導出されるdot key
- colon keyからdot keyへのmapping
- configへ移動するsource localeとowner mapping
- 抽出されるvariable profiles
- 削除される`version`と、対応する既存digest
- translation coverage差分
- 生成されるalias

自動変換後にmigration semantic snapshotを比較し、key、alias、manual version、release policyとして列挙したexpected difference以外の
本文・section・variable・locale semantics差分があれば失敗する。

## 13. Diagnostics

追加する安定diagnostic code候補:

| Code | Meaning |
| --- | --- |
| `S11T_KEY_INVALID` | pathまたはexplicit keyがdot key規則に違反 |
| `S11T_KEY_COLLISION` | 複数sourceが同じdot keyへ解決 |
| `S11T_KEY_ALIAS_INVALID` | alias循環、複数hop、alias先不存在 |
| `S11T_OWNER_UNRESOLVED` | owner必須policyでkeyspace ownerを解決できない |
| `S11T_VARIABLE_PROFILE_NOT_FOUND` | 指定profileが存在しない |
| `S11T_VARIABLE_PROFILE_INVALID` | profile展開後contractが不正 |
| `S11T_RELEASE_PROFILE_NOT_FOUND` | release profileが存在しない |
| `S11T_TRANSLATION_MISSING` | selected release profileのlocale coverage不足 |
| `S11T_LOCALE_RELABEL_FORBIDDEN` | source textを移動せずsource localeだけ変更しようとした |
| `S11T_AUTHORING_MIGRATION_DRIFT` | migration前後で意図しないsemantic差分が発生 |

programはmessage文字列ではなくcodeで分岐する既存方針を維持する。

## 14. 現行実装のbaseline

2026-07-22時点のS11t実装はv1専用であり、変更境界は次のようになっている。

| Responsibility | Current implementation | v2で必要な変更 |
| --- | --- | --- |
| project config | `packages/cli/src/config.ts` | config v1を固定し、config v2 dispatcherとrelease profile解決を追加 |
| source discovery | `packages/cli/src/discover.ts` | source relative pathをparser/resolverへ渡し、v1/v2 sourceを判別 |
| authoring parse | `packages/cli/src/authoring-schema.ts` | raw v1 parseとraw v2 parseを分離し、resolved modelへの変換を後段へ移す |
| compile boundary | `packages/cli/src/compile-source.ts` | selected artifact versionへcompilerをdispatch |
| generated types | `packages/cli/src/emit-types.ts` | dot key、legacy alias、artifact v2 factoryを生成 |
| inspect | `packages/cli/src/inspect-command.ts` | compiled locale表示に加え、値と由来を示すresolved表示を追加 |
| canonical model | `packages/runtime/src/canonical-definition.ts` | v1 contractを不変に保ち、version/outputに依存しないv2 contractを追加 |
| artifact/compiler | `packages/runtime/src/types.ts`、`compiler.ts`、`artifact-schema.ts` | v2 types、compiler、validator、schema dispatchを追加 |
| runtime bind | `packages/runtime/src/catalog.ts` | artifact version dispatch、ordered fallback、alias解決、v2 manifestを追加 |
| hash | `packages/runtime/src/hash.ts` | v1 domain/vectorを固定し、独立したv2 domain/vectorを追加 |
| public schemas | `schemas/*-v1.schema.json` | v1を変更せずauthoring/artifact v2 schemaを追加 |

NightWorkers canaryのbaselineは次のとおりである。

- `.context.toml`は70 files、keyspaceは12個である。
- 旧IDを単純に`:`から`.`へ置換した値とpath-derived keyが異なるfileは55件ある。たとえば
  `codingAgent:roleInstructions`のcanonical keyはfile名に従い`codingAgent.role-instructions`になる。
- `p("namespace:key", ...)`のliteral call siteはtestsを含め57箇所ある。
- `api/systemContexts/catalog.ts`はmodule load時に`ja-JP`へbindしており、request/run localeを受け取っていない。
- `tests/s11t-system-context.test.ts`には最終textのSHA-256 baselineがあり、移行時のcontent drift検出に利用できる。
- 既存のcanary tarball配備、`s11t:lint`、`s11t:build`、`s11t:check`、backend/desktop bundle Gateは再利用できる。

したがってNightWorkersを一括でdot keyへ置換してからruntimeを切り替える方法は採らない。canonical keyとlegacy aliasを
同時に生成し、artifact/runtime、authoring、call siteの順に段階移行する。

## 15. 実装前に固定するcontract

### 15.1 Version dispatch

config、authoring、artifactのversionを暗黙に混同しない。

```toml
schema_version = 2
authoring_version = 2
artifact_version = 2
```

- `schema_version = 1` projectは現在のparser、compiler、artifact v1をそのまま使用する。
- `schema_version = 2` projectは`authoring_version = 2`と`artifact_version = 2`を必須にする。
- config v2 project内ではv1/v2 sourceを混在可能にするが、両方をresolved v2へ変換してartifact v2だけを生成する。
- authoring v2からartifact v1へのdowngradeは提供しない。manual versionやdefault localeを合成しないためである。
- `createCatalog()`はartifactの`schemaVersion`でv1/v2 validatorとruntime implementationをdispatchする。

### 15.2 Raw、resolved、compiledの分離

CLI内に次の3層を置き、raw TOMLをruntime compilerへ直接渡さない。

```text
RawAuthoringDocumentV1 | RawAuthoringDocumentV2
                    │ source path + project policy
                    ▼
ResolvedContextDefinitionV2 + ResolutionOrigins
                    │ semantic validation
                    ▼
S11tCatalogArtifactV2
```

`ResolvedContextDefinitionV2`にはcanonical key、resolved owner、content kind、source locale、required locales、
expanded variables、ordered sections/localesを持たせる。`ResolutionOrigins`はinspectとdiagnostic用に別objectで保持し、
definition hashへは含めない。

v1 sourceをv2 projectで読むadapterは、v1の本文、section、variable contract、owner、locale mapをそのままresolved v2へ移す。
v1 `version`と`output = "text"`はmigration reportに記録するが、v2 identityへは入れない。

### 15.3 Release profile selection

v2の`lint`、`build`、`inspect --resolved`は`--release-profile <name>`を必須にする。configの先頭profileや
environment variableを暗黙defaultとして使わない。

```sh
s11t lint --release-profile development
s11t build --release-profile production
s11t inspect structuredGeneration.repair --resolved --release-profile production
```

selected profile名、resolved required locales、policy digestをbuild provenanceへ保存する。同じsourceでもprofileが異なるbuildは
catalog digestが異ならなければならない。

### 15.4 Key and alias contract

- artifact v2の`contexts`にはcanonical dot keyだけを格納する。
- artifact v2に`aliases: Record<string, string>`を持たせ、valueは必ずcanonical keyとする。
- alias sourceはdot keyに加え、migration期間だけv1 colon keyを許可する。
- alias chainは作らず、aliasからcanonical keyへの1 hopだけを許可する。
- JSON Schemaはalias key/valueのshapeを検証し、alias keyとcanonical keyのcollision、alias先不存在、cycleは
  cross-field integrity validatorで拒否する。
- aliases mapはdefinition hashには含めず、catalog digestには含める。
- alias経由のinvokeはcanonical contextをrenderし、manifestへ`requestedKey`、`resolvedKey`、`aliasUsed`を記録する。
- generated typesは`CanonicalSystemContextKey`とJSDoc `@deprecated`付き`LegacySystemContextKey`を分け、
  compatibility用`SystemContextKey`を両者のunionとして生成する。
- alias削除はgenerated TypeScriptで旧key利用が0件になった後の別変更とする。

### 15.5 Locale binding contract

artifact v2とruntime v2には`defaultLocale`を置かない。bindingは次に固定する。

```ts
type CatalogBindingV2 = {
	instructionLocale: string;
	fallbackLocales?: readonly string[];
};
```

- `instructionLocale`はnon-emptyかつlocale patternに一致する値を必須とする。
- `fallbackLocales`はcaller順を保持し、重複、requested locale自身、invalid localeを拒否する。
- requested、fallbackの順で最初に存在するlocaleを選ぶ。source localeを自動追加しない。
- manifestにはrequested locale、試行したfallback順、resolved localeを記録する。
- v1の`fallbackLocale`はv1 artifactに対してのみ維持する。
- NightWorkersのcentral `p()`はmodule-global bindをやめ、request/run entryで作ったbinderを明示的に渡す。
- NightWorkersではGeneral Settingsの最上位`language`変数だけを切替元とし、`ja`を`ja-JP`、`en`を`en-US`へ変換する。
  context個別や`p()` call siteではlocaleを指定しない。変数変更後の呼び出しは新しいbindingを選び、既存bindingは変更しない。

### 15.6 Hash and migration equivalence

v2 hashは既存functionの条件分岐ではなく、`s11t.definition.v2`、`s11t.artifact.v2`、`s11t.release.v2`、
`s11t.catalog.v2`の独立domainで計算する。

migration前後のhashはkeyとversion contractが異なるため一致しない。`S11T_AUTHORING_MIGRATION_DRIFT`の判定には、次だけを比較する
`MigrationSemanticSnapshot`を使う。

- owner
- content kind
- source localeとavailable locale map
- fully expanded variable contracts
- section ID、kind、severity、enforcement、optimizable、順序、正規化済みtext

canonical key変更、legacy alias追加、manual version削除、selected release profileはmigration reportのexpected differenceとして別表示する。

### 15.7 Multi-file command safety

`migrate`、`move`、`locale promote`はdry-runを既定にする。`--write`時は全入力をmemory上で変換し、一時directoryで
parse、resolve、compile、semantic comparisonまで成功させてから対象fileを置換する。置換前bytesとSHA-256を
`.s11t/migrations/<operation-id>/`へ保存し、途中失敗時は自動restoreする。targetに前回の未完了operationがあれば新しいwriteを拒否する。

## 16. Work breakdown

実装はP0からP6までのreview可能な単位に分ける。各work itemは記載したGateを満たすまで次へ進めない。

### P0 — v2 contractとtest vectorsを固定する

変更対象:

```text
docs/specification/authoring-v2.md
docs/specification/artifact-v2.md
docs/specification/diagnostics-v2.md
schemas/s11t-authoring-v2.schema.json
schemas/s11t-artifact-v2.schema.json
packages/runtime/tests/golden/hash-v2.json
fixtures/valid/content-first-simple/
fixtures/valid/content-first-multilingual/
fixtures/valid/content-first-sectioned/
fixtures/valid/mixed-authoring/
fixtures/invalid/v2-*/
```

実装内容:

1. config v2、simple/sectioned authoring v2、artifact v2、alias、runtime manifestのJSON/TOML shapeをspecへ固定する。
2. sectioned sourceは各sectionに`text`と任意の`translations`を持つ形に固定し、source locale tableを反復させない。
3. simple source、translation、variable profile、keyspace longest match、alias、release profileのvalid fixtureを追加する。
4. invalid key、collision、owner未解決、profile不存在、unsafe expanded profile、coverage不足、alias不正をfixture化する。
5. v1 golden fileを変更しないtestと、v2 golden vectorのplaceholder testを先に追加する。

Gate:

- schemaとspecのrequired/optional fieldが一致する。
- v1 schema、v1 golden vector、既存fixtureにdiffがない。
- v2 contractに未決定fieldが残っていない。

### P1 — config v2とresolver boundaryを実装する

追加・変更対象:

```text
packages/cli/src/config.ts                 # version dispatcher
packages/cli/src/config-v1.ts              # 現行実装を挙動変更なしで分離
packages/cli/src/config-v2.ts
packages/cli/src/authoring-schema-v1.ts    # 現行実装を挙動変更なしで分離
packages/cli/src/authoring-schema-v2.ts
packages/cli/src/resolved-authoring.ts
packages/cli/src/resolve-authoring.ts
packages/cli/src/key-resolution.ts
packages/cli/src/discover.ts
packages/cli/tests/config-v2.test.ts
packages/cli/tests/resolve-authoring.test.ts
```

実装内容:

1. config schema versionでparserをdispatchし、unknown fieldを両versionともfail closedする。
2. discovery resultへ`source_dir`からのrelative POSIX pathを追加する。
3. `schema_version`を持つsourceはv1、持たないsourceはv2としてraw parseする。v2 source内のv1-only fieldは拒否する。
4. path-derived key、explicit override、longest keyspace owner、source locale、release coverage、translationsを解決する。
5. variable profileを完全なcontractへ展開した後、既存と同じtrust/encoding/type cross-field validationを行う。
6. placeholder validationはraw parserではなくresolved全localeに対して行う。
7. resultと同時に各fieldのoriginを返し、profile/configのtable順に依存しない決定的な並びへ正規化する。

Gate:

- v1 parserの既存testがbyte-for-byte同じcanonical v1を返す。
- 同じ意味のv1 long formとv2 shorthandから、migration snapshotが一致する。
- invalid path segment、Windows separator、collision、owner/profile/locale不足が安定diagnostic codeで失敗する。
- profile名だけを変えて展開結果が同じ場合、resolved semantic valueは一致する。

### P2 — content-first CLI surfaceを完成する

追加・変更対象:

```text
packages/cli/src/main.ts
packages/cli/src/lint-command.ts
packages/cli/src/build-command.ts
packages/cli/src/compile-source.ts
packages/cli/src/inspect-command.ts
packages/cli/src/emit-types.ts
packages/cli/tests/main.test.ts
packages/cli/tests/build-command.test.ts
packages/cli/tests/inspect-command.test.ts
packages/cli/tests/authoring-v2-json-schema.test.ts
```

実装内容:

1. `lint`、`build`、`inspect`へ`--release-profile`を追加し、v2 configでは未指定をusage errorにする。
2. `inspect <key> --resolved`をartifact build前のresolved modelから出力する。
3. human outputには値、由来、canonical/override key差、expanded variable contract、definition hashを表示する。
4. `--format json`はstable field名を持つmachine-readable resultにし、diagnostic testからmessage文字列へ依存しない。
5. build pipelineを`load raw -> resolve -> compile by artifact version`へ変更する。
6. `lint`もbuildと同じselected release profileおよびcross-context validationを通す。
7. help、CLI README、getting startedをv1/v2両方が判別できる表記へ更新する。

Gate:

- variableなしのv2 simple fixtureがroot `text`だけでlintできる。
- `inspect --resolved`のhuman/JSON snapshotがoriginまで含む。
- release profile変更時、source fileを変更せずcoverage結果だけが変わる。
- v1 configに`--release-profile`を渡した場合は曖昧に無視せずusage errorにする。

### P3 — artifact/runtime v2を実装する

追加・変更対象:

```text
packages/runtime/src/canonical-definition-v2.ts
packages/runtime/src/types.ts
packages/runtime/src/hash-v2.ts
packages/runtime/src/compiler-v2.ts
packages/runtime/src/artifact-schema-v2.ts
packages/runtime/src/catalog-v2.ts
packages/runtime/src/index.ts
packages/runtime/src/catalog.ts             # public dispatcher
packages/runtime/src/artifact-schema.ts     # public dispatcher
packages/runtime/tests/hash-v2.test.ts
packages/runtime/tests/compiler-v2.test.ts
packages/runtime/tests/artifact-schema-v2.test.ts
packages/runtime/tests/catalog-v2.test.ts
test-consumer/esm-node-v2/
```

実装内容:

1. v1 type/function exportを維持したまま、suffix `V2`を持つpublic typesを追加する。
2. compiler v2はresolved fieldsだけからartifact v2を作り、manual versionとdefault localeを参照しない。
3. artifact v2 validatorとJSON Schemaのstructural accept/reject matrixを共有fixtureで検証し、digest、alias参照、
   cross-context整合性はruntime integrity corpusで検証する。
4. `createCatalog()`はvalidation後にv1/v2 catalog implementationをdispatchし、caller-owned inputをclone/freezeする。
5. ordered fallback、fail-closed locale selection、alias解決、v2 invocation manifestを実装する。
6. `list()`と`describe()`はcanonical keyを返す。aliasを列挙するAPIは`listAliases()`として分離する。
7. generated factoryはartifact v2、canonical key、deprecated legacy key typeを型付けし、isolated ESM consumerで実行する。
8. runtime packageがNode builtinをimportしない既存boundaryを維持する。

Gate:

- v1 artifact validator、hash、bind、manifest testが無変更で通る。
- v2 golden vectorがNode 20/22/24で一致する。
- requested locale、複数fallback、no fallback、duplicate fallbackを網羅する。
- alias経由とcanonical key経由のrendered text/definition identityが一致し、manifestのrouting fieldだけが異なる。
- artifact JSON Schemaとruntime validatorがstructural corpusで一致し、runtime integrity corpusがcross-field tamperingを拒否する。
- `pnpm test:no-node-builtins`と`pnpm test:browser-bundle`が通る。

### P4 — migration、move、locale promotionを実装する

追加・変更対象:

```text
packages/cli/src/migration-command.ts
packages/cli/src/migration-semantic-snapshot.ts
packages/cli/src/move-command.ts
packages/cli/src/locale-command.ts
packages/cli/src/multi-file-operation.ts
packages/cli/tests/migration-command.test.ts
packages/cli/tests/move-command.test.ts
packages/cli/tests/locale-command.test.ts
```

`migrate authoring-v2`:

1. v1 configと全sourceを読み、path-derived canonical key、legacy ID alias、owner keyspace、source locale、release profile、
   reusable variable profile候補を計算する。
2. profile抽出は同一の完全contractが複数回現れる場合だけ提案する。profile名は明示mappingまたはdeterministicなbuilt-in候補から選び、
   trustを名前から推測しない。
3. dry-run reportへ全70 fileのold key、canonical key、alias、削除metadata、profile、expected/actual semantic diffを出す。
4. `--write`はconfig v2、source v2、aliasesをstagingし、再load/rebuild後のsnapshotが一致した場合だけ置換する。
5. intended difference以外が1件でもあれば`S11T_AUTHORING_MIGRATION_DRIFT`で全体を失敗させる。

`move`:

- canonical keyからsource pathを逆引きし、file移動と旧canonical key alias追加を同一operationで行う。
- explicit key override sourceは自動移動せず、dry-runで必要な操作を表示する。

`locale promote`:

- 対象全contextにpromotion localeがあることを事前検証する。
- source textとtranslationを入れ替え、configのsource localeを更新し、全semantic diffを表示する。
- locale labelだけが変わりtext移動がない状態を`S11T_LOCALE_RELABEL_FORBIDDEN`で拒否する。

Gate:

- dry-runはfilesystemを変更しない。
- write途中のinjected failure testで元bytesへrestoreされる。
- migrationを2回実行した場合、2回目はno-op reportになる。
- move後もalias経由のrender結果が同じで、alias chainは生成されない。
- promoteを往復したとき、本文/translation mapが元に戻る。

### P5 — NightWorkers canaryを段階移行する

このwork itemだけはNightWorkers repositoryの変更を含む。S11tのP0〜P4とpackage Gateが通るまで開始しない。

#### P5-A: canary packageとdry-run report

1. S11tのcommitted HEADから既存`pnpm deploy:nightworkers-canary -- --verify`でv2対応tarballを配備する。
2. NightWorkersの現行v1 catalogに対してmigration dry-runを実行し、70/70 filesがdriftなしであることを確認する。
3. 70件のold→canonical mapping、55件のfilename/camelCase差、12 keyspace owner、profile extraction結果をreview artifactとして保存する。
4. この段階ではNightWorkers source、config、generated artifactを変更しない。

#### P5-B: authoring/config cutover

1. `api/systemContexts/s11t.config.toml`をconfig v2へ変換する。
2. 12 keyspace owner、`authoring.source_locale = "ja-JP"`、development release profile、実測したvariable profilesを定義する。
3. 70 sourceをcontent-firstへ変換し、old colon keyをlegacy aliasとして保持する。
4. package scriptsを次へ変更する。

```json
{
  "s11t:lint": "s11t lint --release-profile development --config api/systemContexts/s11t.config.toml",
  "s11t:build": "s11t build --release-profile development --config api/systemContexts/s11t.config.toml",
  "s11t:check": "s11t build --check --release-profile development --config api/systemContexts/s11t.config.toml"
}
```

5. generated catalog/typesを更新する。application call siteはlegacy aliasで動作するため、このcommitでは一括置換しない。
6. `tests/s11t-system-context.test.ts`の3つのpublic text hashが変化しないことを必須Gateにする。

#### P5-C: runtime locale cutover

1. `api/systemContexts/catalog.ts`のmodule-global `boundP`を削除する。
2. request/run entryで`instructionLocale`と明示的な`fallbackLocales`を決定し、catalog binderを生成する。
3. prompt builderへbinderまたはrequest-scoped rendererをdependencyとして渡す。S11t runtimeがNightWorkers configやenvironmentを直接読まない形にする。
4. Japanese-only runは`instructionLocale: "ja-JP"`、fallbackなしを明示する。
5. localeを持たないrun開始をfail closedし、並行するja/en bindingが互いに影響しないtestを追加する。

#### P5-D: canonical key cutover and alias removal

1. generated type errorを利用し、57 literal call siteをpath-derived dot keyへ機械的に置換する。
2. tests、architecture check、documentationにcolon keyが残っていないことを`rg`とAST checkで確認する。
3. alias利用0件を確認した次のcommitでlegacy aliasesをconfigから削除する。
4. alias削除によるcatalog digest変更を意図したrelease differenceとして記録する。

NightWorkers Gate:

```sh
bun run s11t:lint
bun run s11t:build
bun run s11t:check
bun run typecheck
bun run verify
bun run build:backend
bun run build:backend:desktop
```

期待結果:

- 70 contextsのsource text、section order、variable contract、locale mapにunexpected driftがない。
- public prompt textと末尾newlineが既存baselineと一致する。
- generated artifactはcanonical dot keyだけをcontexts mapに持つ。
- alias期間中は旧keyが動作し、P5-D後は旧keyがcompile-time/runtimeの両方で拒否される。
- request/run localeがmanifestに記録され、catalogの静的defaultへ依存しない。

### P6 — documentation、package、release closeout

変更対象:

```text
README.md
packages/cli/README.md
packages/runtime/README.md
docs/guides/getting-started.md
docs/guides/backend-integration.md
examples/node-basic/
test-consumer/esm-node/
packages/cli/CHANGELOG.md
packages/runtime/CHANGELOG.md
.changeset/*.md
```

実装内容:

1. default exampleをauthoring/artifact v2へ更新し、v1 exampleはcompatibility sectionへ残す。
2. schema、runtime API、migration、rollback、alias removalの手順を公開docsへ反映する。
3. isolated consumerをv1/v2両artifactで実行し、tarballにv2 schema/specが含まれることをpackage allowlistで確認する。
4. runtime/CLIをfixed Changesets releaseとしてcanary化し、NightWorkers P5-D完了後にstable候補とする。
5. v1 deprecationまたは削除時期は別proposalで決める。この計画ではv1 supportを削除しない。

Gate:

```sh
pnpm verify
pnpm test:packages
pnpm release:dry-run -- --channel canary
```

## 17. Dependency and merge order

```text
P0 contract/spec
   ↓
P1 raw parser + resolver
   ↓
P2 CLI authoring surface
   ↓
P3 artifact/runtime v2
   ↓
P4 migration commands
   ↓
P5-A report → P5-B authoring → P5-C locale → P5-D keys/aliases
   ↓
P6 docs/package/stable candidate
```

- P1とP2ではpublic runtime behaviorを変更しない。
- P3 merge時点でもv1 consumerは同じartifactとAPIを使える。
- P4はv2 runtime/validatorが完成してからmergeし、migration後artifactまで同一commandで検証する。
- P5-B、P5-C、P5-Dを1 commitへまとめない。authoring drift、locale wiring、key renameの原因を独立して切り戻せるようにする。
- P6 stable candidateはNightWorkers canaryの全Gateとalias removal後にだけ進める。

## 18. Verification matrix

| Layer | Required evidence |
| --- | --- |
| config/parser | v1 regression、v2 schema parity、unknown field rejection |
| key resolution | nested path、hyphen、case、separator、override、collision、longest owner match |
| variable safety | expanded profile parity、untrusted/raw rejection、type/encoding mismatch、unused/undeclared placeholder |
| locale policy | source assignment、translation map、profile coverage、missing locale、ordered fallback、no implicit source fallback |
| hash | v1 golden unchanged、v2 golden cross-Node、raw ordering invariance、semantic change sensitivity |
| artifact | structural schema/validator matrix、runtime integrity corpus、tamper detection、alias integrity、deep clone/freeze |
| generated types | canonical key/value map、deprecated alias、unknown key compile failure |
| CLI | human/JSON diagnostics、resolved origins、dry-run no-write、build `--check` |
| package | no Node builtin runtime、browser bundle、tarball contents、isolated v1/v2 consumer |
| NightWorkers | 70-file semantic snapshot、public text hashes、typecheck、verify、backend/desktop bundle |

S11t local verification:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:schema-drift
pnpm test:cross-node
pnpm test:type-fixtures
pnpm test:no-node-builtins
pnpm test:browser-bundle
pnpm test:packages
pnpm verify
```

Failure時はwork itemごとに次を切り分ける。

- resolved snapshot差: parser/resolverまたはmigration mappingを修正し、artifactへ進まない。
- v2 hash差: goldenを更新する前にcanonical field/order差を説明できる状態にする。
- schema/validator差: どちらかへ合わせるのではなくshared structural corpusを先に修正し、accept/reject contractを再確認する。
- NightWorkers text hash差: expected changeとして承認されていない限りP5-Bをrollbackする。
- locale bind差: P5-Cだけをrollbackし、content-first authoringと混同しない。

## 19. Acceptance criteria

1. variableなしのsimple contextはroot `text`だけでauthoringできる。
2. 通常のcontext fileに`id`、`version`、`owner`、`source_locale`、`required_locales`、`output`、`schema_version`が不要である。
3. canonical keyはpath-derived dot notationであり、artifact v2のcontexts mapにcolon keyが入らない。
4. ownerは最長一致keyspace policyから解決される。
5. runtime localeはrequest/run単位で必須指定され、artifact defaultやsource localeへ暗黙fallbackしない。
6. locale coverage policyはcontext sourceを変更せずrelease profileで切り替えられる。
7. variable trust/encoding safetyはprofile使用時もv1と同等以上である。
8. resolved metadata、値の由来、selected release policyをCLIのhuman/JSON両方で確認できる。
9. v1 authoring、artifact、hash golden、runtime APIは移行期間中壊れない。
10. migration、move、locale promotionはdry-run既定、drift検出、failure restoreを備える。
11. NightWorkersの70 contextを本文、section、variable、locale semanticsのdriftなしで移行できる。
12. NightWorkersの旧colon keyはalias期間を経て利用0件を確認してから削除される。
13. S11tのlocal/package GateとNightWorkersのtypecheck/verify/backend/desktop Gateがすべて成功する。

## 20. Rollback policy

- S11t側はv1 code pathとschemaを削除しないため、consumerはconfig v1と直前のcanary tarballへ戻せる。
- migration writeは`.s11t/migrations/<operation-id>/`のbackup manifestから元bytesへrestoreできる。
- NightWorkersはP5-B、P5-C、P5-Dを独立commitにし、問題のある境界だけをrevertする。
- generated catalogだけを手修正してrollbackしない。常にconfig/sourceと同じversionのCLIで再生成する。
- aliasはcanary中の互換手段であり、semantic driftを隠すfallbackとして使用しない。
- v1 support削除、stable publish、NightWorkers以外のconsumer一括移行はこの計画の完了条件に含めない。

## 21. Non-goals

- 本文の言語を自動判定すること。
- source locale labelの変更だけで翻訳したことにすること。
- LLMによる自動翻訳をbuildの暗黙処理にすること。
- variable trustを名前やplaceholderから推測すること。
- environment variableやprocess-global mutable stateでbuild結果を暗黙変更すること。
- provider call、Agent workflow、authorizationをS11tへ移すこと。
- authoring noise削減と同時にeval/experiment/optimizerを実装すること。
- v1 authoring/artifact/runtime supportをこの変更で削除すること。
