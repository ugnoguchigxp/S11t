# Getting started

S11t compiles content-first TOML into deterministic JSON and a typed runtime factory. The host
application loads the artifact and chooses the instruction locale at its request or run boundary.

## Install and scripts

```sh
npm install @s11t/runtime
npm install --save-dev @s11t/cli
```

```json
{
  "scripts": {
    "s11t:lint": "s11t lint --release-profile development",
    "s11t:build": "s11t build --release-profile development",
    "s11t:check": "s11t build --check --release-profile development"
  }
}
```

## Configure a catalog

Create `s11t.config.toml`:

```toml
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

The path produces the canonical key `codingAgent.task`. Untrusted values must use
`delimited-context` placement and a non-raw encoding.

## Validate and build

```sh
npm run s11t:lint
npm run s11t:build
npm run s11t:check
```

The build writes `.s11t/catalog.json` and `.s11t/catalog.generated.ts`. Commit them together.
`--check` performs no writes and reports `S11T_BUILD_STALE` when either output differs.

## Bind one request

```ts
import { readFile } from "node:fs/promises";
import { createAppCatalog } from "./.s11t/catalog.generated.js";

const artifact: unknown = JSON.parse(await readFile(".s11t/catalog.json", "utf8"));
const catalog = createAppCatalog(artifact);
const requestCatalog = catalog.bindRequest({
  instructionLocale: request.settings.instructionLocale,
  fallbackLocales: request.settings.instructionFallbackLocales,
});

const final = requestCatalog.invoke("codingAgent.task", {
  taskGoal: request.userMessage,
});
const audit = requestCatalog.finalize(final);
await provider.generate({ system: final.content.text });
await auditStore.write(audit);
```

For one independently audited render, use `catalog.bind(binding)`. For text-only composition with one
locale snapshot, use `catalog.bindText(binding)`. `createTextRenderer()` is for independent calls that
should re-read a top-level locale setting on each call.

Inspect staged locale rollout without changing release requirements:

```sh
s11t inspect --coverage --locale en-US --fallback-locale ja-JP \
  --release-profile development --format json
```

S11t does not call an LLM provider and does not own authorization, retries, tool enforcement, or trace
persistence. See [backend integration](./backend-integration.md) and
[trust boundaries](./trust-boundaries.md).
