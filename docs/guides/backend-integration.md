# Backend integration

Load the generated JSON artifact using an application-owned mechanism such as a file read, static import, database, object store, or HTTP client. Pass the parsed object as `unknown` to the generated `createAppCatalog()` factory.

Catalog creation validates the artifact schema, the expected generated catalog digest, every definition hash, locale artifact hash, release digest, and the catalog digest. It clones and freezes the validated model so later caller mutation cannot affect results.

Bind locale per request:

```ts
const p = catalog.bind({
  instructionLocale: request.locale,
  fallbackLocale: "en-US",
});
```

`p()` is synchronous. It validates missing, extra, and invalid runtime values; renders sections in source order; and returns immutable content plus a manifest. Runtime values and rendered text are not copied into the manifest.

S11t does not call an LLM provider and does not own authorization, retries, tool enforcement, or trace persistence. Pass `invocation.content.text` and the immutable manifest to those application-owned layers.
