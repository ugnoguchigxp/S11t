import { readFileSync } from "node:fs";

import { COMPILER_VERSION, tokenizeTemplate } from "@s11t/runtime/compiler";

import { createAppCatalog } from "../.s11t/catalog.generated.js";
import { createAppCatalog as createAppCatalogV2 } from "../.s11t-v2/catalog.generated.js";

const artifact: unknown = JSON.parse(
	readFileSync(new URL("../../.s11t/catalog.json", import.meta.url), "utf8"),
);
const catalog = createAppCatalog(artifact);
const invocation = catalog.bind({ instructionLocale: "ja-JP" })("consumer:identity", {
	taskGoal: "tarballを検証する",
});
const artifactV2: unknown = JSON.parse(
	readFileSync(new URL("../../.s11t-v2/catalog.json", import.meta.url), "utf8"),
);
const catalogV2 = createAppCatalogV2(artifactV2);
const invocationV2 = catalogV2.bind({
	instructionLocale: "ja-JP",
})("consumer.identity", { taskGoal: "tarballを検証する" });
const boundTextV2 = catalogV2.bindText({ instructionLocale: "ja-JP" });
const textV2 = boundTextV2.p("consumer.identity", { taskGoal: "tarballを検証する" });
const statusTextV2 = boundTextV2.byKey["consumer.status"]({});
const liveTextV2 = catalogV2.createTextRenderer(() => ({ instructionLocale: "ja-JP" }));
const liveStatusTextV2 = liveTextV2("consumer.status", {});

if (false) {
	// @ts-expect-error missing required v2 value
	boundTextV2.p("consumer.identity", {});
	// @ts-expect-error exact empty v2 values reject extra properties
	liveTextV2("consumer.status", { extra: true });
	// @ts-expect-error unknown v2 key
	boundTextV2.byKey["consumer.unknown"]({});
}

process.stdout.write(
	`${JSON.stringify({ invocation, invocationV2, textV2, statusTextV2, liveStatusTextV2, compilerVersion: COMPILER_VERSION, segments: tokenizeTemplate("[[value]]") })}\n`,
);
