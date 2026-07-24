# s11tnext

Portable S11tnext artifact contracts, deterministic compiler primitives, and the typed catalog API.
This package uses no Node.js builtins, filesystem APIs, process state, or TOML parsing.
Supported Node.js releases are 20.19+, 22, and 24.

This package is available from the npm registry and remains in `0.x` pre-release development.
Review the changelog and compatibility policy when upgrading.

```sh
npm install s11tnext
```

Applications pass an artifact to `createCatalog()`—normally through a generated `createAppCatalog()`
factory—and bind an explicit locale:

```ts
const invocation = catalog.bind(binding)("context.key", values);
provider.send({ role: invocation.role, content: invocation.content.text });
const fixedText = catalog.bindText(binding);
const liveText = catalog.createTextRenderer(() => bindingFromTopLevelSettings());
```

- `bind()` returns immutable content and its manifest.
- Each context produces exactly one `system` or `user` provider message; use the invocation's authored
  `role` instead of hard-coding it.
- `bindText()` captures one immutable binding snapshot.
- `createTextRenderer()` reads its resolver once per independent call.

For compound provider prompts, bind one request:

```ts
const request = catalog.bindRequest(binding);
const role = request.invoke("context.role", {});
const final = request.invoke("context.provider", { role: role.content.text });
const audit = request.finalize(final, [role]);
```

The audit contains the final manifest and successful request-local renders in call order. When fragments
are supplied to `finalize()`, it also proves their byte ranges in the final payload. Set
`trailingNewline: false` on a binding when the default terminal newline is not wanted.
`hashRendered()` and `verifyRenderedHash()` let hosts verify the exact submitted text.
`manifest.messageHash` additionally binds the provider-message role to that text. These hashes are
integrity identifiers, not signatures or proof that a provider accepted the message.

Untrusted variables require `delimited-context` placement and a non-raw encoding. Use `bind()` or
`bindRequest()` on provider and audit paths so content and its immutable identity stay correlated.
For multiline Markdown or retrieved text, `delimited-text` preserves real newlines while escaping
delimiter boundary characters. Optional variables may be omitted, and `omitIfEmpty` sections are excluded
from both rendered text and the manifest's `sectionIds`.

See the [complete guide](https://github.com/ugnoguchigxp/s11tnext/blob/main/docs/guides/getting-started.md)
and [backend integration guide](https://github.com/ugnoguchigxp/s11tnext/blob/main/docs/guides/backend-integration.md).
