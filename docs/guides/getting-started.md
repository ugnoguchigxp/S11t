# Getting started

S11t v0.1 uses TOML as the authoring source and generated JSON as the runtime artifact.

Create `s11t.config.toml`:

```toml
schema_version = 1
source_dir = "contexts"
out_dir = ".s11t"
required_locales = ["ja-JP", "en-US"]
default_locale = "ja-JP"
```

Add one or more `contexts/*.context.toml` files, then validate and build them:

```sh
s11t lint
s11t build
s11t build --check
```

The build writes `.s11t/catalog.json` and `.s11t/catalog.generated.ts`. Both files are deterministic and should be regenerated together. `--check` performs no writes and fails with `S11T_BUILD_STALE` when either file differs.

Use the generated factory in application code:

```ts
import { readFileSync } from "node:fs";
import { createAppCatalog } from "./.s11t/catalog.generated.js";

const artifact: unknown = JSON.parse(readFileSync(".s11t/catalog.json", "utf8"));
const catalog = createAppCatalog(artifact);
const p = catalog.bind({ instructionLocale: "ja-JP", fallbackLocale: "en-US" });
const invocation = p("codingAgent:identity", { taskGoal: "認証機能を実装する" });
```

The application owns JSON loading. The runtime does not read TOML or access the filesystem.
