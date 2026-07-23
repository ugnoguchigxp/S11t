# Getting started

S11t compiles content-first TOML into deterministic JSON plus a generated, typed runtime factory. The
application owns artifact loading and chooses the instruction locale at its top-level request or run
boundary.

## Install

```sh
npm install @s11t/runtime
npm install --save-dev @s11t/cli
```

Add scripts to `package.json` so every v2 command names the policy it is validating:

```json
{
  "scripts": {
    "s11t:lint": "s11t lint --release-profile development",
    "s11t:build": "s11t build --release-profile development",
    "s11t:check": "s11t build --check --release-profile development"
  }
}
```

## Configure a v2 catalog

Create `s11t.config.toml`:

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

`authoring.source_locale` is the only authoring-language declaration. Runtime language is deliberately
absent from the config and artifact: the host supplies it from one top-level setting.

Use `artifact_version = 3` when untrusted values must receive an enforced
`delimited-context-v1` structural boundary. Version 2 preserves the original rendered text and treats
placement as metadata.

Create `contexts/codingAgent/task.context.toml`:

```toml
text = '''次のユーザー要求を処理してください。
[[taskGoal]]'''

[variables.taskGoal]
profile = "untrusted.text"

[translations.en-US]
text = '''Handle the following user request.
[[taskGoal]]'''
```

Create `contexts/codingAgent/role.context.toml`:

```toml
text = '''あなたはバックエンド実装エージェントです。'''

[translations.en-US]
text = '''You are a backend implementation agent.'''
```

The path produces the canonical key `codingAgent.task`. Provider/user-controlled text is marked
`untrusted` and encoded instead of being interpolated as raw instructions.

## Validate and build

```sh
npm run s11t:lint
npm run s11t:build
npm run s11t:check
```

The build writes `.s11t/catalog.json` and `.s11t/catalog.generated.ts`. Regenerate and commit them
together. The `--check` form performs no writes and fails with `S11T_BUILD_STALE` when either file differs.

## Bind language once per request

Load JSON through an application-owned mechanism and use the generated factory:

```ts
import { readFile } from "node:fs/promises";
import { createAppCatalog } from "./.s11t/catalog.generated.js";

const artifact: unknown = JSON.parse(await readFile(".s11t/catalog.json", "utf8"));
const catalog = createAppCatalog(artifact);

const p = catalog.bind({
  instructionLocale: request.settings.instructionLocale,
  fallbackLocales: request.settings.instructionFallbackLocales,
});

const invocation = p("codingAgent.task", { taskGoal: request.userMessage });
await provider.generate({
  system: invocation.content.text,
});
await auditStore.write(invocation.manifest);
```

`bind()` clones the language binding. Reusing `p` therefore gives every SystemContext in the request the
same locale snapshot even if a global setting changes concurrently. Its immutable manifest carries the
resolved locale and content identity for audit and diagnostics.

For text-only composition, use one fixed snapshot:

```ts
const text = catalog.bindText({
  instructionLocale: run.settings.instructionLocale,
  fallbackLocales: [],
});

const role = text.byKey["codingAgent.role"]({});
const task = text.p("codingAgent.task", { taskGoal: run.userMessage });
```

For independent UI or preview calls that should observe a later top-level language change, use
`createTextRenderer()`. Its resolver runs once per call:

```ts
const render = catalog.createTextRenderer(() => ({
  instructionLocale: readTopLevelSettings().instructionLocale,
  fallbackLocales: [],
}));
```

Do not use the live renderer for a multi-context request snapshot. The text-only adapters also omit the
invocation manifest, so provider submission and audited paths should use `bind()`.

For compound audited prompts, use one request snapshot:

```ts
const requestCatalog = catalog.bindRequest({
  instructionLocale: request.settings.instructionLocale,
  fallbackLocales: request.settings.instructionFallbackLocales,
});
const role = requestCatalog.p("codingAgent.role", {});
const final = requestCatalog.invoke("codingAgent.task", {
  taskGoal: `${role}\n${request.userMessage}`,
});
const audit = requestCatalog.finalize(final);
```

The audit preserves successful render calls, including duplicates, in call order. Verify the text passed
to the provider with `verifyRenderedHash(sentText, audit.finalManifest.renderedHash)`.

Inspect staged locale rollout without making the target locale required:

```sh
s11t inspect --coverage --locale en-US --fallback-locale ja-JP \
  --release-profile development --format json
```

S11t does not call an LLM provider and does not own authorization, retries, tool enforcement, or trace
persistence. See [backend integration](./backend-integration.md), [trust boundaries](./trust-boundaries.md),
and [the v1-to-v2 migration guide](./migrating-v1-to-v2.md).
