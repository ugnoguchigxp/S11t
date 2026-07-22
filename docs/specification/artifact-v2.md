# S11t catalog artifact v2

Artifact v2 uses canonical dot keys, digest identity, explicit policy provenance, and no catalog default
locale.

## Top-level contract

```ts
type S11tCatalogArtifactV2 = {
	format: "s11t.catalog";
	schemaVersion: 2;
	compilerVersion: string;
	releaseProfile: string;
	policyDigest: string;
	createdFrom: { configPath: string; sourceFiles: string[] };
	contexts: Record<string, S11tCompiledContextV2>;
	aliases: Record<string, string>;
	catalogDigest: string;
};
```

`contexts` contains canonical dot keys only. `aliases` is a one-hop migration map; targets must exist and
cannot themselves be aliases. Alias routing is included in `catalogDigest` but not in a context
`definitionHash`.

Structural validation rejects malformed locale identifiers and variable names in context maps and
template segments before digest verification. Runtime validation and the published JSON Schema enforce
the same patterns.

## Runtime locale binding

```ts
const p = catalog.bind({
	instructionLocale: topLevelSettings.instructionLocale,
	fallbackLocales: topLevelSettings.instructionFallbackLocales,
});
```

The requested locale is required. Fallbacks are ordered and explicit. The runtime does not add the source
locale, read an environment variable, or retain caller-owned mutable binding state. When a host language
variable changes, the host creates a new binding from its top-level setting; existing request bindings stay
unchanged.

The same typed key/value contract is available through two text-only adapters:

```ts
const fixed = catalog.bindText(binding);
fixed.p("context.key", values);
fixed.byKey["context.key"](values);

const live = catalog.createTextRenderer(() => bindingFromTopLevelSettings());
live("context.key", values);
```

`bindText()` validates and clones its binding once. It is the correct form when multiple texts must share one
request/run locale. `createTextRenderer()` evaluates its resolver exactly once per render call and observes a
top-level language change on the next call. It does not provide a multi-call snapshot.

Both adapters return the same text as `bind()`, including the trailing newline, but omit the invocation
manifest. Paths that persist audit data, hashes, or locale diagnostics must continue to use `bind()`.
Generated v2 values maps represent contexts without variables as `Record<string, never>`, not `{}`, so
extra values are rejected by TypeScript.

The v2 invocation manifest records canonical and requested keys, alias usage, requested and fallback
locales, resolved locale, content and release digests, release profile, and policy digest.

## Compatibility

`createCatalog()` dispatches structurally valid artifacts by `schemaVersion`; generated v2 factories call
`createCatalogV2()` for precise v2 types. Artifact v1 validators, hashes, runtime binding, and golden vectors
remain unchanged.
