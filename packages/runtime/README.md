# @s11t/runtime

Portable S11t artifact contracts, deterministic compiler primitives, and the typed catalog API.
This package uses no Node.js builtins, filesystem APIs, process state, or TOML parsing.

```sh
npm install @s11t/runtime
```

Applications pass an artifact to `createCatalog()`—normally through a generated `createAppCatalog()`
factory—and bind an explicit locale:

```ts
const invocation = catalog.bind(binding)("context.key", values);
const fixedText = catalog.bindText(binding);
const liveText = catalog.createTextRenderer(() => bindingFromTopLevelSettings());
```

- `bind()` returns immutable content and its manifest.
- `bindText()` captures one immutable binding snapshot.
- `createTextRenderer()` reads its resolver once per independent call.

For compound provider prompts, bind one request:

```ts
const request = catalog.bindRequest(binding);
const role = request.p("context.role", {});
const final = request.invoke("context.provider", { role });
const audit = request.finalize(final);
```

The audit contains the final manifest and successful request-local renders in call order.
`hashRendered()` and `verifyRenderedHash()` let hosts verify the exact submitted text.

Untrusted variables require `delimited-context` placement and a non-raw encoding. Use `bind()` or
`bindRequest()` on provider and audit paths so content and its immutable identity stay correlated.

See the [complete guide](https://github.com/ugnoguchigxp/S11t/blob/main/docs/guides/getting-started.md)
and [backend integration guide](https://github.com/ugnoguchigxp/S11t/blob/main/docs/guides/backend-integration.md).
