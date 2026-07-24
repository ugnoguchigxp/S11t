# S11tnext

Keep natural-language SystemContext out of your application logic.

TypeScript向けの、バックエンドファーストなSystemContext作成・多言語化・コンパイル・実行時レンダリング基盤です。

[日本語](#japanese) | [English](#english)

---

<a id="japanese"></a>

## 日本語

### S11tnextとは

S11tnextは、LLMアプリケーションで使うシステム指示や実行時コンテキストを、アプリケーションコードから分離して管理するためのTypeScriptツールキットです。

人が編集しやすいTOMLをCLIで検証・コンパイルし、決定的なJSONアーティファクトと型付きTypeScriptファクトリを生成します。アプリケーションは、ファイルシステムに依存しないRuntimeへ生成物を渡し、リクエスト単位で言語を選択して安全にレンダリングできます。

```text
*.context.toml
      │
      ▼
s11tnext-cli ── 検証・コンパイル ──▶ catalog.json + catalog.generated.ts
                                               │
                                               ▼
                                      s11tnext Runtime
                                               │
                                               ▼
                                  アプリケーション / LLMプロバイダー
```

S11tnextは、UI文言の翻訳ライブラリではありません。バックエンドからLLMへ渡すSystemContextを、型、安全性、ロケール、所有者、変更監査の観点から管理することに特化しています。

### 主な特徴

- **コンテンツファースト** — 指示文と翻訳をTOMLで管理し、TypeScriptコードから分離します。
- **型付きAPI** — コンテキストキーと変数から型定義を生成し、キーの誤りや変数の過不足をコンパイル時に検出します。
- **決定的な生成物** — 同じ入力とポリシーから同じカタログとダイジェストを生成します。
- **リクエスト単位のロケール** — 使用言語とフォールバック順をリクエスト境界で固定します。暗黙のフォールバックは行いません。
- **信頼境界の明示** — 信頼できない値には、構造的な区切りと非rawエンコーディングを必須にできます。
- **監査可能なID** — レンダリング結果に、定義・リリース・ロケール・内容を識別する不変のmanifestが付属します。
- **RuntimeとCLIの分離** — RuntimeはNode.js組み込みモジュール、ファイルシステム、TOMLパーサーに依存しません。

### 開発状況

現在はプレリリース開発中です。パッケージ名は`s11tnext`と`s11tnext-cli`を予定していますが、初回公開まではnpmレジストリからインストールできません。公開前に試す場合は、このリポジトリをpnpm workspaceとして利用してください。`0.0.0`は開発用バージョンであり、本番環境から依存しないでください。

### 必要環境

- Node.js `20.19.0`以降のNode 20、Node.js 22、またはNode.js 24
- ESMを使用するTypeScriptまたはJavaScriptプロジェクト
- CLIを利用する場合は、プロジェクトのdevDependencyとして`s11tnext-cli`

### インストール

初回npm公開後は、RuntimeとCLIをそれぞれインストールします。

```sh
npm install s11tnext
npm install --save-dev s11tnext-cli
```

pnpmの場合:

```sh
pnpm add s11tnext
pnpm add --save-dev s11tnext-cli
```

### クイックスタート

#### 1. 設定ファイルを作る

プロジェクトルートに`s11tnext.config.toml`を作成します。

```toml
source_dir = "contexts"
out_dir = ".s11tnext"

[authoring]
source_locale = "ja-JP"

[governance]
require_owner = true

[keyspaces.codingAgent]
owner = "agent-platform"

[release_profiles.development]
required_locales = ["$source", "en-US"]

[variable_profiles."untrusted.text"]
type = "string"
trust = "untrusted"
placement = "delimited-context"
encoding = "json-string"
```

- `source_dir`: `.context.toml`を配置するディレクトリ
- `out_dir`: コンパイル結果の出力先
- `source_locale`: 原文のロケール
- `keyspaces`: トップレベルのキースペースと所有者
- `release_profiles`: ビルドごとに必須とするロケール
- `variable_profiles`: 再利用可能な変数の型・信頼・配置・エンコーディング規則

#### 2. SystemContextを書く

`contexts/codingAgent/task.context.toml`を作成します。

```toml
text = '''次のユーザー要求を処理してください。
[[taskGoal]]'''

[variables.taskGoal]
profile = "untrusted.text"

[translations."en-US"]
text = '''Handle the following user request.
[[taskGoal]]'''
```

ファイルパスから正規キー`codingAgent.task`が生成されます。翻訳は原文と同じプレースホルダーを使用する必要があります。宣言されていない変数、未使用の変数、ロケール間の変数不一致はCLIがエラーとして報告します。

複数の役割や強制レベルを持つプロンプトは、単一の`text`ではなく順序付き`sections`として記述できます。詳細は[Authoring仕様](./docs/specification/authoring.md)を参照してください。

#### 3. npm scriptsを追加する

```json
{
  "scripts": {
    "s11tnext:lint": "s11tnext lint --release-profile development",
    "s11tnext:build": "s11tnext build --release-profile development",
    "s11tnext:check": "s11tnext build --check --release-profile development"
  }
}
```

#### 4. 検証・ビルドする

```sh
npm run s11tnext:lint
npm run s11tnext:build
npm run s11tnext:check
```

ビルドは次の2ファイルを生成します。

- `.s11tnext/catalog.json` — 検証済みの決定的なカタログアーティファクト
- `.s11tnext/catalog.generated.ts` — キーと変数を型付けした`createAppCatalog()`ファクトリ

2ファイルは必ず一緒に更新・コミットしてください。`build --check`はファイルを書き換えず、生成物が古い場合に`S11TNEXT_BUILD_STALE`を返すため、CIで利用できます。

#### 5. アプリケーションから利用する

```ts
import { readFile } from "node:fs/promises";
import { createAppCatalog } from "./.s11tnext/catalog.generated.js";

const artifact: unknown = JSON.parse(
  await readFile(".s11tnext/catalog.json", "utf8"),
);
const catalog = createAppCatalog(artifact);

const render = catalog.bind({
  instructionLocale: "ja-JP",
  fallbackLocales: ["en-US"],
});

const invocation = render("codingAgent.task", {
  taskGoal: "認証機能を実装する",
});

await provider.generate({
  system: invocation.content.text,
});
await auditStore.write(invocation.manifest);
```

`createAppCatalog()`はJSONの構造、カタログダイジェスト、定義ハッシュ、ロケールアーティファクトハッシュ、リリースダイジェストを検証します。`bind()`はロケール設定を固定し、レンダリング済みテキストと不変のmanifestを返します。

JSONの読み込み方法はアプリケーション側で選べます。ファイルのほか、静的import、データベース、オブジェクトストレージ、HTTPなどから取得した値を`unknown`として渡せます。

### CLI

`lint`、`build`、`inspect`では、使用するポリシーを明確にするため`--release-profile`が必須です。設定ファイルがプロジェクトルート以外にある場合は`--config path`を指定します。

| コマンド | 用途 |
| --- | --- |
| `s11tnext lint --release-profile development` | 設定、TOML、ロケール、変数ポリシーを検証します。ファイルは生成しません。 |
| `s11tnext build --release-profile development` | JSONアーティファクトとTypeScriptファクトリを生成します。 |
| `s11tnext build --check --release-profile development` | 生成物が最新かを、書き込みなしで確認します。 |
| `s11tnext inspect codingAgent.task --resolved --locale ja-JP --release-profile development` | 1件の正規キーと、必要に応じて解決後の内容を確認します。 |
| `s11tnext inspect --coverage --locale en-US --fallback-locale ja-JP --release-profile development` | ロケールの直接一致、明示的フォールバック、欠落を確認します。 |
| `s11tnext completion bash\|zsh\|fish` | シェル補完スクリプトを標準出力へ出します。 |
| `s11tnext help [command]` | 全体またはコマンド別のヘルプを表示します。 |
| `s11tnext --version` | CLIとコンパイラのバージョンを表示します。 |

人向け出力の代わりに機械可読な結果が必要な場合は、対応するコマンドへ`--format json`を追加してください。

### Runtime APIの選び方

| API | 適した用途 | 戻り値 |
| --- | --- | --- |
| `catalog.bind(binding)` | プロバイダー送信、監査、ハッシュ記録 | テキストとmanifestを持つinvocation |
| `catalog.bindText(binding)` | 1リクエスト内で固定ロケールを使ったテキスト合成 | `p(key, values)`と`byKey` |
| `catalog.bindRequest(binding)` | 複数回のレンダリングを1リクエストの監査記録にまとめる | レンダートレースと最終manifest |
| `catalog.createTextRenderer(resolver)` | 呼び出しごとにトップレベル設定を読み直す独立した処理 | テキストレンダラー |
| `catalog.list()` / `catalog.describe(key)` | 使用可能なコンテキストや変数・ロケールの確認 | 読み取り専用メタデータ |
| `hashRendered()` / `verifyRenderedHash()` | プロバイダーへ渡した正確なテキストの同一性確認 | ダイジェストまたは検証結果 |

プロバイダー送信や監査経路では、テキストとmanifestの対応を失わないよう`bind()`または`bindRequest()`を使用してください。`bindText()`と`createTextRenderer()`は、manifestを必要としないテキスト合成向けです。

### 安全性と決定性

- 信頼できない変数には`placement = "delimited-context"`と、`json-string`または`json-value`のような非rawエンコーディングが必要です。
- Runtimeは信頼できない値を構造的な境界内へ配置し、閉じタグに使われる文字をエスケープしてから補間します。
- ロケール解決はfail-closedです。`fallbackLocales`に指定していないロケールへ暗黙にフォールバックしません。
- アーティファクトはロード時に構造とすべての整合性ダイジェストを検証され、その後clone・freezeされます。
- 定義、アーティファクト、リリース、ポリシー、カタログ、レンダリング済みテキストには、それぞれ分離されたハッシュ領域を使用します。

S11tnextはプロンプトインジェクション対策の一部を支援しますが、アプリケーション全体のセキュリティを単独で保証するものではありません。認可、ツール実行制御、出力検証、レート制限、監査保存もホストアプリケーションで実装してください。

### プロジェクトの責務範囲

- `s11tnext`は、アーティファクト検証、ロケール解決、型付きレンダリング、manifest、ハッシュ機能を提供します。
- `s11tnext-cli`は、ファイル探索、TOML解析、authoring検証、コンパイル、型生成、ファイル出力を担当します。
- LLM API呼び出し、認可、リトライ、永続化、プロバイダーアダプター、ツール強制はホストアプリケーションの責務です。

### ドキュメントとサンプル

- [Getting started](./docs/guides/getting-started.md)
- [Backend integration](./docs/guides/backend-integration.md)
- [Trust boundaries](./docs/guides/trust-boundaries.md)
- [Troubleshooting](./docs/guides/troubleshooting.md)
- [Authoring仕様](./docs/specification/authoring.md)
- [Artifact仕様](./docs/specification/artifact.md)
- [互換性ポリシー](./docs/specification/compatibility.md)
- [診断コード](./docs/specification/diagnostics.md)
- [Node.jsサンプル](./examples/node-basic)
- [npm公開手順](./docs/release/npm-publishing.md)

### このリポジトリで開発する

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm test:packages
```

- `pnpm verify`はバージョン整合性、型チェック、テストとカバレッジ、ビルド、型fixture、Runtime境界、ブラウザbundle、CLI起動を検証します。
- `pnpm test:packages`はRuntimeとCLIのtarballを作成し、公開ファイルを検査して、隔離されたESM consumerへインストールします。

主要ディレクトリ:

| パス | 内容 |
| --- | --- |
| `packages/runtime` | npmパッケージ`s11tnext` |
| `packages/cli` | npmパッケージ`s11tnext-cli`と`s11tnext`コマンド |
| `schemas` | 公開JSON Schema |
| `docs` | ガイド、仕様、リリース手順 |
| `examples/node-basic` | 最小のNode.js統合例 |
| `test-consumer` | 公開tarballと型定義のconsumerテスト |

### ライセンス

[Apache License 2.0](./LICENSE)。NOTICEについては[NOTICE](./NOTICE)を参照してください。

---

<a id="english"></a>

## English

### What is S11tnext?

S11tnext is a TypeScript toolkit for managing LLM system instructions and runtime context separately from application code.

Authors write human-friendly TOML. The CLI validates and compiles it into a deterministic JSON artifact and a typed TypeScript factory. Applications load those outputs into a filesystem-independent Runtime, select a locale at the request boundary, and render the final content safely.

```text
*.context.toml
      │
      ▼
s11tnext-cli ── validate and compile ──▶ catalog.json + catalog.generated.ts
                                                      │
                                                      ▼
                                             s11tnext Runtime
                                                      │
                                                      ▼
                                         Application / LLM provider
```

S11tnext is not a UI string translation library. It is designed specifically for backend SystemContext sent to LLMs, with explicit contracts for types, safety, locale policy, ownership, and change auditing.

### Highlights

- **Content-first authoring** — Keep instructions and translations in TOML instead of application code.
- **Typed API** — Generate types for context keys and variables, catching unknown keys and missing or extra values at compile time.
- **Deterministic outputs** — Produce the same catalog and digests from the same source and policy.
- **Request-bound locale** — Snapshot the requested locale and ordered fallbacks at the request boundary. There is no implicit fallback.
- **Explicit trust boundaries** — Require structural delimiters and non-raw encoding for untrusted values.
- **Auditable identity** — Every invocation includes an immutable manifest identifying its definition, release, locale, and rendered content.
- **Separated Runtime and CLI** — The Runtime does not depend on Node.js builtins, filesystem APIs, or TOML parsing.

### Development status

S11tnext is currently in pre-release development. The intended package names are `s11tnext` and `s11tnext-cli`, but they cannot be installed from the npm registry until the first release is published. Before that release, use this repository as a pnpm workspace. Version `0.0.0` is for development and must not be used as a production dependency.

### Requirements

- Node.js 20.19 or newer in the Node 20 line, Node.js 22, or Node.js 24
- A TypeScript or JavaScript project using ESM
- `s11tnext-cli` as a project devDependency when using the CLI

### Installation

After the first npm release, install the Runtime and CLI separately:

```sh
npm install s11tnext
npm install --save-dev s11tnext-cli
```

With pnpm:

```sh
pnpm add s11tnext
pnpm add --save-dev s11tnext-cli
```

### Quick start

#### 1. Create the configuration

Create `s11tnext.config.toml` in the project root:

```toml
source_dir = "contexts"
out_dir = ".s11tnext"

[authoring]
source_locale = "ja-JP"

[governance]
require_owner = true

[keyspaces.codingAgent]
owner = "agent-platform"

[release_profiles.development]
required_locales = ["$source", "en-US"]

[variable_profiles."untrusted.text"]
type = "string"
trust = "untrusted"
placement = "delimited-context"
encoding = "json-string"
```

- `source_dir`: directory containing `.context.toml` files
- `out_dir`: destination for compiled outputs
- `source_locale`: locale of the authored source text
- `keyspaces`: top-level keyspaces and their owners
- `release_profiles`: locales required for each build profile
- `variable_profiles`: reusable variable type, trust, placement, and encoding policies

#### 2. Author a SystemContext

Create `contexts/codingAgent/task.context.toml`:

```toml
text = '''次のユーザー要求を処理してください。
[[taskGoal]]'''

[variables.taskGoal]
profile = "untrusted.text"

[translations."en-US"]
text = '''Handle the following user request.
[[taskGoal]]'''
```

The file path produces the canonical key `codingAgent.task`. A translation must use the same placeholders as the source text. The CLI reports undeclared variables, unused declarations, and variable mismatches between locales as errors.

Prompts with multiple roles or enforcement levels can use ordered `sections` instead of one root `text` value. See the [authoring specification](./docs/specification/authoring.md) for the complete format.

#### 3. Add npm scripts

```json
{
  "scripts": {
    "s11tnext:lint": "s11tnext lint --release-profile development",
    "s11tnext:build": "s11tnext build --release-profile development",
    "s11tnext:check": "s11tnext build --check --release-profile development"
  }
}
```

#### 4. Validate and build

```sh
npm run s11tnext:lint
npm run s11tnext:build
npm run s11tnext:check
```

The build creates two files:

- `.s11tnext/catalog.json` — the validated, deterministic catalog artifact
- `.s11tnext/catalog.generated.ts` — a typed `createAppCatalog()` factory for your keys and variables

Always update and commit these two files together. `build --check` performs no writes and returns `S11TNEXT_BUILD_STALE` when generated outputs are out of date, making it suitable for CI.

#### 5. Use the catalog in an application

```ts
import { readFile } from "node:fs/promises";
import { createAppCatalog } from "./.s11tnext/catalog.generated.js";

const artifact: unknown = JSON.parse(
  await readFile(".s11tnext/catalog.json", "utf8"),
);
const catalog = createAppCatalog(artifact);

const render = catalog.bind({
  instructionLocale: "ja-JP",
  fallbackLocales: ["en-US"],
});

const invocation = render("codingAgent.task", {
  taskGoal: "認証機能を実装する",
});

await provider.generate({
  system: invocation.content.text,
});
await auditStore.write(invocation.manifest);
```

`createAppCatalog()` validates the JSON structure, catalog digest, definition hashes, locale artifact hashes, and release digests. `bind()` snapshots the locale policy and returns rendered text with an immutable manifest.

The host application chooses how to load the JSON. It can pass a value obtained from a file, static import, database, object store, or HTTP request as `unknown`.

### CLI

`lint`, `build`, and `inspect` require `--release-profile` so that the active policy is explicit. Use `--config path` when the configuration is not in the project root.

| Command | Purpose |
| --- | --- |
| `s11tnext lint --release-profile development` | Validate configuration, TOML, locales, and variable policy without writing files. |
| `s11tnext build --release-profile development` | Generate the JSON artifact and TypeScript factory. |
| `s11tnext build --check --release-profile development` | Check generated outputs without writing them. |
| `s11tnext inspect codingAgent.task --resolved --locale ja-JP --release-profile development` | Inspect one canonical key and, optionally, its resolved content. |
| `s11tnext inspect --coverage --locale en-US --fallback-locale ja-JP --release-profile development` | Report direct, explicit fallback, and missing locale coverage. |
| `s11tnext completion bash\|zsh\|fish` | Print a shell completion script to stdout. |
| `s11tnext help [command]` | Show global or command-specific help. |
| `s11tnext --version` | Print the CLI and compiler version. |

Add `--format json` to supported commands when machine-readable output is required.

### Choosing a Runtime API

| API | Best for | Returns |
| --- | --- | --- |
| `catalog.bind(binding)` | Provider submission, auditing, and hash recording | An invocation containing text and a manifest |
| `catalog.bindText(binding)` | Text composition with one locale snapshot per request | `p(key, values)` and `byKey` |
| `catalog.bindRequest(binding)` | Recording multiple renders as one request audit | A render trace and final manifest |
| `catalog.createTextRenderer(resolver)` | Independent calls that re-read top-level settings | A text renderer |
| `catalog.list()` / `catalog.describe(key)` | Discovering available contexts, variables, and locales | Read-only metadata |
| `hashRendered()` / `verifyRenderedHash()` | Verifying the exact text submitted to a provider | A digest or verification result |

Use `bind()` or `bindRequest()` on provider and audit paths so that rendered content stays correlated with its manifest. `bindText()` and `createTextRenderer()` are intended for composition where a manifest is not required.

### Safety and determinism

- Untrusted variables require `placement = "delimited-context"` and a non-raw encoding such as `json-string` or `json-value`.
- The Runtime places untrusted values inside a structural boundary and escapes closing-tag characters before interpolation.
- Locale resolution is fail-closed. It never falls back to a locale that is absent from `fallbackLocales`.
- Artifacts are structurally and cryptographically validated when loaded, then cloned and frozen.
- Definition, artifact, release, policy, catalog, and rendered-text hashes use separate domains.

S11tnext supports one layer of prompt-injection defense, but it does not secure an entire application by itself. The host must also implement authorization, tool enforcement, output validation, rate limiting, and audit persistence.

### Project boundaries

- `s11tnext` provides artifact validation, locale resolution, typed rendering, manifests, and hashing.
- `s11tnext-cli` owns file discovery, TOML parsing, authoring validation, compilation, type generation, and file emission.
- LLM API calls, authorization, retries, persistence, provider adapters, and tool enforcement belong to the host application.

### Documentation and examples

- [Getting started](./docs/guides/getting-started.md)
- [Backend integration](./docs/guides/backend-integration.md)
- [Trust boundaries](./docs/guides/trust-boundaries.md)
- [Troubleshooting](./docs/guides/troubleshooting.md)
- [Authoring specification](./docs/specification/authoring.md)
- [Artifact specification](./docs/specification/artifact.md)
- [Compatibility policy](./docs/specification/compatibility.md)
- [Diagnostic codes](./docs/specification/diagnostics.md)
- [Node.js example](./examples/node-basic)
- [npm publishing runbook](./docs/release/npm-publishing.md)

### Developing this repository

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm test:packages
```

- `pnpm verify` checks version alignment, types, tests and coverage, builds, type fixtures, Runtime boundaries, the browser bundle, and CLI startup.
- `pnpm test:packages` packs Runtime and CLI tarballs, checks their public files, and installs them into an isolated ESM consumer.

Main directories:

| Path | Contents |
| --- | --- |
| `packages/runtime` | The `s11tnext` npm package |
| `packages/cli` | The `s11tnext-cli` npm package and `s11tnext` command |
| `schemas` | Public JSON Schemas |
| `docs` | Guides, specifications, and release procedures |
| `examples/node-basic` | Minimal Node.js integration |
| `test-consumer` | Consumer tests for published tarballs and types |

### License

[Apache License 2.0](./LICENSE). See [NOTICE](./NOTICE) for attribution notices.
