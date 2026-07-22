# Typed Text Renderer Binding 実装指示書

## 1. 目的

S11tが`.context.toml`から生成したcanonical keyとvariable contractを、runtimeでそのまま利用できる
typed text rendererとして公開する。

現状はS11tが次までを所有している。

```text
.context.toml
  -> catalog artifact
  -> SystemContextKey / SystemContextValueMap
  -> createAppCatalog()
  -> catalog.bind(binding)
  -> SystemContextInvocation
```

一方、consumerは`SystemContextInvocation.content.text`を取り出すwrapper、keyごとのrenderer、設定変更を
反映するbinding resolverを独自実装する必要がある。NightWorkersではこの責務がapplication側の
`createSystemContextRenderer()`、`p()`、binding選択処理として残っている。

この重複を解消し、TOMLからtyped text rendererを生成するところまでをS11tの正式機能にする。

## 2. 完了後のconsumer code

NightWorkersのようなhost applicationは、application設定からS11t bindingへ変換するresolverだけを渡す。

```ts
import { createAppCatalog } from "./generated/catalog.generated.js";
import artifact from "./generated/catalog.json" with { type: "json" };

const catalog = createAppCatalog(artifact);

export const p = catalog.createTextRenderer(() => {
	const { language } = readGeneralSettings();
	return language === "en"
		? {
				instructionLocale: "en-US",
				fallbackLocales: ["ja-JP"],
			}
		: {
				instructionLocale: "ja-JP",
				fallbackLocales: [],
			};
});
```

call siteはhost独自のrenderer実装を持たず、従来どおり型付き`p()`だけを使用する。

```ts
p("structuredGeneration.repair", {
	outputRequirements,
});
```

固定bindingが必要なrequest/runでは、keyごとのfunction objectもS11tから取得できるようにする。

```ts
const bound = catalog.bindText({
	instructionLocale: "ja-JP",
	fallbackLocales: [],
});

bound.byKey["structuredGeneration.repair"]({
	outputRequirements,
});

bound.p("structuredGeneration.repair", {
	outputRequirements,
});
```

複数contextから1つのrequest/runを組み立てる場合は、処理開始時に`bindText()`を1回だけ作成し、同じ
snapshotを最後まで使用する。`createTextRenderer()`は、呼出単位で最新設定を反映してよい独立した
text取得に使用する。

## 3. 責務境界

### S11tが所有する

- artifactからcanonical key一覧とkeyごとのvariable型を解決する。
- keyごとのtyped renderer function objectを生成する。
- 型付き`p(key, values)`を生成する。
- bindingのvalidation、clone、immutable snapshot化を行う。
- resolverをrenderer呼出時に評価し、その呼出専用bindingを確定する。
- ordered fallbackを含む既存locale resolutionを実行する。
- `SystemContextInvocation.content.text`をtext rendererの戻り値として返す。
- key、values、locale、artifact、digestに関する既存のtyped failureを維持する。

### Host applicationが所有する

- language設定の保存場所と読取方法。
- application languageから`instructionLocale`へのmapping。
- application固有の`fallbackLocales` policy。
- resolverをS11t catalogへ注入するcomposition root。

### S11tが所有してはいけない

- NightWorkersのGeneral Settingsを直接importすること。
- environment variable、filesystem、process globalからlanguageを読むこと。
- source localeを暗黙のruntime defaultまたはfallbackとして追加すること。
- application固有の`ja`、`en`などのlanguage codeを推測すること。

## 4. 必須public API

名称と責務を次で固定する。

```ts
export type TextRenderer<C extends DefaultContract> =
	<K extends ContractKey<C>>(
		key: K,
		values: ContractValues<C>[K],
	) => string;

export type TextRendererObject<C extends DefaultContract> = {
	readonly [K in ContractKey<C>]: (
		values: ContractValues<C>[K],
	) => string;
};

export type BoundTextCatalog<C extends DefaultContract> = {
	readonly p: TextRenderer<C>;
	readonly byKey: TextRendererObject<C>;
};

export type CatalogBindingResolverV2 = () => CatalogBindingV2;
```

`CatalogV2<C>`へ次を追加する。

```ts
bindText(binding: CatalogBindingV2): BoundTextCatalog<C>;
createTextRenderer(resolveBinding: CatalogBindingResolverV2): TextRenderer<C>;
```

`bind()`と`SystemContextInvocationV2`は削除・変更しない。manifest、監査、diagnosticsが必要なconsumerは
従来の`bind()`を使用する。`bindText()`はtext-only consumer向けの公式adapterとして追加する。

variableを持たないcontextのgenerated values型は`Record<string, never>`とする。TypeScriptの`{}`は
non-nullish value全般を受理して余分なpropertyを拒否できないため、exact empty valuesの表現には使用しない。

## 5. `bindText()`契約

`bindText(binding)`は固定bindingのimmutable snapshotを返す。

1. 作成時に既存`bind(binding)`と同じvalidationを行う。
2. `fallbackLocales`を含むcaller-owned object/arrayをcloneする。
3. 作成後にcallerが元のbindingを変更しても結果へ影響させない。
4. `p()`と`byKey[key]()`は同じsnapshotと同じrendering primitiveを使用する。
5. 戻り値、`byKey` object、各rendererの可観測stateを外部から変更できないようにする。
6. 戻り値は`invocation.content.text`とbyte-for-byteで一致させ、末尾newlineも維持する。
7. aliasがartifactに存在する場合は既存`bind()`と同じroutingを行う。
8. context、locale、valuesが不正な場合は既存`S11tError` codeとpathを変えない。

`byKey`はartifactとgenerated contractに含まれるkeyだけをown propertyとして持つ。prototype由来のkeyを
rendererとして扱わない。canonical keyと移行中aliasの扱いは既存`ContractKey<C>`に従う。

## 6. `createTextRenderer()`契約

`createTextRenderer(resolveBinding)`は、設定変更を次の呼出から反映するlive typed `p()`を返す。

1. resolverはrenderer作成時には実行しない。
2. `p(key, values)`の各呼出でresolverを正確に1回実行する。
3. resolverの戻り値をその呼出専用のimmutable binding snapshotへ変換する。
4. render中にresolverを再実行しない。
5. 次の呼出ではresolverを再実行し、変更後のlanguage/localeを反映する。
6. 前の呼出で作成したbinding、invocation、textを後から変更しない。
7. resolverの結果をmodule-global defaultとして保存しない。
8. resolverがthrowした場合は固定文へ置換せず、そのfailureをcallerへ返す。
9. locale解決失敗時は既存`S11T_LOCALE_NOT_FOUND`を維持する。

このlive rendererは、各呼出を独立した設定snapshotとして扱える用途向けである。複数回のrender結果を
同一request/runへまとめる場合は、途中の設定変更でlocaleが混在しないよう`bindText()`を1回作成して使う。

内部最適化として同一bindingのrendererをcacheしてもよい。ただしresolver自体をmemoizeせず、各呼出で
必ず評価する。cache keyは`instructionLocale`と順序を維持した`fallbackLocales`から決定し、可変objectの
identityへ依存しない。

## 7. 実装方針

実装の正本は`packages/runtime/src/catalog-v2.ts`に置く。

- `bindText()`は既存`bind()`または同じ内部primitiveを使用し、rendering、validation、locale resolutionを
  複製しない。
- `createTextRenderer()`は`bindText()`または同じtext adapter primitiveを使用する。
- `packages/cli/src/emit-types.ts`にapplication固有wrapperを生成しない。
- `packages/cli/src/emit-types.ts`は、variableを持たないv2 contextへ`Record<string, never>`を生成する。
- generated `createAppCatalog()`の戻り型から、新APIのkey/value相関がそのまま推論される形にする。
- `packages/runtime/src/index.ts`から新しいpublic typeをexportする。
- runtimeへNode.js builtin、TOML parser、filesystem依存を追加しない。
- authoring v2、artifact v2、digest、hash、manifestのschemaを変更しない。

初回実装はcatalog v2を必須対象とする。v1へ同名APIを追加する場合もv1のlocale/fallback意味を変更しては
ならない。v1対応を理由にv2実装を`unknown`や非型付き共通wrapperへ劣化させない。

## 8. 型契約

generated contractのkeyとvaluesの相関を保持する。

```ts
bound.p("context.with-values", { value: "ok" });
bound.byKey["context.with-values"]({ value: "ok" });
```

次はcompile errorにする。

```ts
bound.p("context.with-values", {});
bound.p("context.without-values", { extra: true });
bound.p("unknown.context", {});
bound.byKey["unknown.context"]({});
```

実装都合で`Record<string, unknown>`、`(key: string, values: object)`、consumer側castへ広げない。
variableを持たないcontextについても、`{}`ではなく`Record<string, never>`を生成し、余分なpropertyを
compile時に拒否する。

## 9. 必須test

### Runtime unit test

`packages/runtime/tests/catalog-v2.test.ts`へ少なくとも次を追加する。

1. `bindText().p()`と既存`bind()`の`content.text`が一致する。
2. `bindText().byKey[key]()`と`bindText().p()`が一致する。
3. binding作成後に元の`fallbackLocales` arrayを変更してもsnapshotが変化しない。
4. `BoundTextCatalog`と`byKey`が外部から変更できない。
5. `createTextRenderer()`が呼出ごとにresolverを1回読む。
6. resolverの返すlocaleを`ja-JP`から`en-US`へ変えると次の呼出から切り替わる。
7. 変更前に取得済みの`bindText()`は元のlocaleを維持する。
8. `en-US`から明示的な`["ja-JP"]` fallbackで日本語textを返す。
9. fallback未指定時にsource localeへ暗黙fallbackしない。
10. missing/extra values、不明key、不正localeのerror codeが既存`bind()`と一致する。

### Type fixture

`test-consumer/types/`または同等のcompile fixtureで次を確認する。

- canonical dot keyと正しいvaluesがcompileできる。
- keyごとの必須variableが推論される。
- missing/extra valuesがcompile errorになる。
- unknown keyと削除済みlegacy colon keyがcompile errorになる。
- `byKey`でも同じ型制約が働く。

### Portable runtime Gate

- `pnpm test:no-node-builtins`
- `pnpm test:browser-bundle`
- ESM tarball consumer

resolver注入によってruntimeがhost stateやNode.js APIへ依存していないことを確認する。

## 10. Documentation

次を更新する。

- `packages/runtime/README.md`
- `docs/specification/artifact-v2.md`のruntime binding節
- backend integration guide

documentationではsnapshot版とlive resolver版を明確に区別する。

```text
bind()               -> immutable Invocation renderer
bindText()           -> immutable text renderer object
createTextRenderer() -> resolverを呼出ごとに評価するlive typed p()
```

`bindText()`と`createTextRenderer()`は`SystemContextInvocationV2.manifest`を返さない。provider送信、監査、
hash記録、locale diagnosticsでmanifestが必要な経路ではtext-only APIを使用せず、`bind()`を使用する。

## 11. NightWorkersへの移行条件

S11t側の実装とpackage Gateが完了した後にだけNightWorkersを更新する。

1. S11tのcommitted HEADからcanary packageを作成する。
2. NightWorkersの`vendor/s11t/`、`package.json`、`bun.lock`を既存deploy commandで更新する。
3. NightWorkersの独自rendering、values typing、`content.text`抽出処理を削除する。
4. General Settingsから`CatalogBindingV2`を返すresolverを残し、独立したtext取得は
   `createTextRenderer()`へ接続する。
5. 複数contextからrequest/runを組み立てる経路は、開始時に`catalog.bindText(resolveBinding())`を1回作成し、
   そのsnapshotを処理全体で共有する。application側にcomposition helperを残す場合もrendering処理は持たせない。
6. manifestを保存・検証するprovider/監査経路は`bind()`を維持し、text-only APIへ置き換えない。
7. 既存の70 SystemContext、public prompt text hash、locale manifestに差分がないことを確認する。
8. `ja`から`en`への設定変更が次のlive `p()`呼出から反映されることを確認する。
9. 既に作成済みの`bindText()` snapshotと、そのsnapshotから組み立てたrequest/runのlocaleが変更されないことを
   確認する。

ローカルworking tree由来のversion `0.0.0`は実装中の検証だけに使用し、正式配備や公開を行わない。

## 12. S11t完了Gate

```sh
pnpm check:versions
pnpm typecheck
pnpm test
pnpm build
pnpm test:type-fixtures
pnpm test:no-node-builtins
pnpm test:browser-bundle
pnpm test:packages
```

全Gate成功、documentation更新、NightWorkersでの互換確認が揃うまで完了扱いにしない。

## 13. 非対象

- content-first TOML形式の変更
- artifact schema versionの追加
- locale自動検出
- source localeの暗黙fallback
- General Settingsなど特定applicationへのruntime依存
- manifestまたはhash contractの変更
- alias policyの再設計
- npm publish、正式release、NightWorkersへの未commit working tree配備
