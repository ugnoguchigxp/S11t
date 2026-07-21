import { readFileSync } from "node:fs";

import { createAppCatalog } from "../.s11t/catalog.generated.js";

const artifact: unknown = JSON.parse(
	readFileSync(new URL("../../.s11t/catalog.json", import.meta.url), "utf8"),
);
const catalog = createAppCatalog(artifact);
const p = catalog.bind({ instructionLocale: "ja-JP", fallbackLocale: "en-US" });
const invocation = p("codingAgent:identity", { taskGoal: "認証機能を実装する" });

process.stdout.write(`${JSON.stringify(invocation, null, 2)}\n`);
