# Backend integration

Load the generated JSON artifact using an application-owned mechanism such as a file read, static import, database, object store, or HTTP client. Pass the parsed object as `unknown` to the generated `createAppCatalog()` factory.

Catalog creation validates the artifact schema, the expected generated catalog digest, every definition hash, locale artifact hash, release digest, and the catalog digest. It clones and freezes the validated model so later caller mutation cannot affect results.

Bind locale per request:

```ts
const p = catalog.bind({
  instructionLocale: request.locale,
  fallbackLocales: ["en-US"],
});
```

`p()` is synchronous. It validates missing, extra, and invalid runtime values; renders sections in source order; and returns immutable content plus a manifest. Runtime values and rendered text are not copied into the manifest.

S11t does not call an LLM provider and does not own authorization, retries, tool enforcement, or trace persistence. Pass `invocation.content.text` and the immutable manifest to those application-owned layers.

For text-only composition with one locale snapshot, bind once at the start of the request or run:

```ts
const text = catalog.bindText({
  instructionLocale: request.locale,
  fallbackLocales: ["en-US"],
});

const role = text.byKey["codingAgent.role-instructions"]({});
const task = text.p("codingAgent.task", { taskGoal });
```

For independent calls that should observe the next top-level language change, inject a live resolver:

```ts
const p = catalog.createTextRenderer(() => {
  const { language } = readGeneralSettings();
  return {
    instructionLocale: language === "en" ? "en-US" : "ja-JP",
    fallbackLocales: [],
  };
});
```

The resolver runs exactly once for each `p()` call. Do not use this live form to assemble one request from
multiple calls, because settings could change between them; create one `bindText()` snapshot instead.

`bindText()` and `createTextRenderer()` discard the invocation manifest. Provider submission, audit, hash
recording, and locale diagnostics must use `bind()` so the manifest remains attached to the rendered text.
