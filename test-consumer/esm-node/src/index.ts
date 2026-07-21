import { readFileSync } from "node:fs";

import { COMPILER_VERSION, tokenizeTemplate } from "@s11t/runtime/compiler";

import { createAppCatalog } from "../.s11t/catalog.generated.js";

const artifact: unknown = JSON.parse(
	readFileSync(new URL("../../.s11t/catalog.json", import.meta.url), "utf8"),
);
const catalog = createAppCatalog(artifact);
const invocation = catalog.bind({ instructionLocale: "ja-JP" })("consumer:identity", {
	taskGoal: "tarballを検証する",
});

process.stdout.write(
	`${JSON.stringify({ invocation, compilerVersion: COMPILER_VERSION, segments: tokenizeTemplate("[[value]]") })}\n`,
);
