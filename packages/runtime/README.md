# @s11t/runtime

Portable S11t artifact contracts, deterministic compiler primitives, and the typed catalog API.

This package intentionally does not use Node.js builtins, filesystem APIs, process state, or TOML parsing.

```sh
npm install @s11t/runtime
```

Applications pass an artifact object to `createCatalog()` (normally through a generated `createAppCatalog()` factory), bind a request locale, and render typed system context.

Artifact v2 has no default locale. The host selects language once in its top-level request/run settings and
passes `instructionLocale` plus optional ordered `fallbackLocales` to `createCatalogV2().bind()`. A changed
host language variable creates or selects a new binding without mutating existing request bindings.

Artifact v2 exposes three binding forms:

```ts
const invocation = catalog.bind(binding)("context.key", values);
const fixedText = catalog.bindText(binding);
const liveText = catalog.createTextRenderer(() => bindingFromTopLevelSettings());

fixedText.p("context.key", values);
fixedText.byKey["context.key"](values);
liveText("context.key", values);
```

- `bind()` returns immutable content and its manifest. Use it for provider, audit, hash, and locale-diagnostic paths.
- `bindText()` captures one immutable binding snapshot. Reuse it while assembling a compound request or run.
- `createTextRenderer()` reads its resolver exactly once per call, so the next independent call observes a changed top-level language setting.

The text-only APIs return `invocation.content.text` byte-for-byte, but intentionally discard the manifest.
Generated v2 contracts use `Record<string, never>` for contexts without variables so extra values remain a
compile-time error.

For compound provider prompts, bind one request:

```ts
const request = catalog.bindRequest(binding);
const role = request.p("context.role", {});
const final = request.invoke("context.provider", { role });
const audit = request.finalize(final);
```

The immutable audit contains the final manifest plus every successful request-local render in call order.
It is a render trace, not proof that every returned string was included byte-for-byte in the final prompt.
Duplicate calls are preserved. `finalize()` accepts only the latest invocation from the same request and
closes that request binding.

`hashRendered(text)` and `verifyRenderedHash(text, digest)` are exported from the package root so hosts do
not need to reproduce the `s11t.rendered.v1` domain separator.

Artifact v2 treats `placement` as metadata and does not insert delimiters. Artifact v3 is an explicit opt-in
that implements the `delimited-context-v1` structural boundary while leaving v1/v2 rendered text unchanged.

Use `bind()` on provider and audit paths so content and its immutable manifest stay correlated. Treat
user messages, model/provider output, tool output, and retrieved content as `untrusted` authoring
variables with a non-raw encoding. See the
[complete v2 guide](https://github.com/ugnoguchigxp/S11t/blob/main/docs/guides/getting-started.md) and
[backend integration guide](https://github.com/ugnoguchigxp/S11t/blob/main/docs/guides/backend-integration.md).
