# Trust boundaries

S11tnext protects the boundary between authored SystemContext instructions and values supplied at runtime.
It does not determine whether a value is trustworthy; the host must classify each data source.

## Classify by origin

- Repository-authored, reviewed instruction fragments may use a `trusted` profile.
- User messages, model output, tool output, retrieved documents, webhook bodies, and provider responses
  are `untrusted`, even when they have already passed application validation.
- Authorization facts and tool policy should be enforced in application code. Rendering them into a
  prompt is not enforcement.

Configure reusable profiles centrally:

```toml
[variable_profiles."trusted.inline"]
type = "string"
trust = "trusted"
placement = "inline"
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

S11tnext rejects `untrusted` plus `raw` in both authoring and runtime artifact validation. Do not relabel
provider or user data as `trusted` merely to bypass this failure.

Every `untrusted` variable must use `delimited-context` placement and a non-raw encoding. The runtime
wraps those values and escapes boundary characters in JSON/string values so runtime data cannot emit the
closing tag.

The delimiter preserves structure; it does not make the content trustworthy or replace authorization,
schema validation, provider isolation, or tool policy.

## Keep provider input and audit identity together

For a provider call, render with `bind()` and carry both outputs through the same application operation:

```ts
const p = catalog.bind(request.languageBinding);
const invocation = p("reviewer.evaluate", {
  evidencePack: request.evidencePack,
});

await provider.generate({ system: invocation.content.text });
await auditStore.write({
  requestId: request.id,
  s11tnext: invocation.manifest,
});
```

The manifest intentionally excludes runtime values and rendered text. It identifies the requested and
canonical keys, locale resolution, definition/content hashes, release profile, and policy digest without
duplicating potentially sensitive input.

`bindText()` and `createTextRenderer()` deliberately discard that manifest. They are useful for
non-audited text composition, but substituting them into a provider path silently loses the correlation
data needed to explain which content was sent.
