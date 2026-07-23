import { readFileSync } from "node:fs";

import { COMPILER_VERSION, tokenizeTemplate } from "@s11t/runtime/compiler";
import { verifyRenderedHash } from "@s11t/runtime";

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
const requestV3 = catalogV2.bindRequest({
	instructionLocale: "ja-JP",
});
const invocationV2 = requestV3.invoke("consumer.identity", {
	taskGoal: "tarballを検証する",
});
const requestAuditV3 = requestV3.finalize(invocationV2);
const renderedHashVerifiedV3 = verifyRenderedHash(
	invocationV2.content.text,
	invocationV2.manifest.renderedHash,
);
const boundTextV2 = catalogV2.bindText({ instructionLocale: "ja-JP" });
const textV2 = boundTextV2.p("consumer.identity", { taskGoal: "tarballを検証する" });
const statusTextV2 = boundTextV2.byKey["consumer.status"]({});
let topLevelInstructionLocale = "ja-JP";
const liveTextV2 = catalogV2.createTextRenderer(() => ({
	instructionLocale: topLevelInstructionLocale,
}));
const liveStatusTextJaV2 = liveTextV2("consumer.status", {});
topLevelInstructionLocale = "en-US";
const liveStatusTextEnV2 = liveTextV2("consumer.status", {});
const fixedStatusAfterLanguageChangeV2 = boundTextV2.byKey["consumer.status"]({});

if (false) {
	// @ts-expect-error missing required v2 value
	boundTextV2.p("consumer.identity", {});
	// @ts-expect-error exact empty v2 values reject extra properties
	liveTextV2("consumer.status", { extra: true });
	// @ts-expect-error unknown v2 key
	boundTextV2.byKey["consumer.unknown"]({});
}

process.stdout.write(
	`${JSON.stringify({
		invocation,
		invocationV2,
		requestAuditV3,
		renderedHashVerifiedV3,
		textV2,
		statusTextV2,
		liveStatusTextJaV2,
		liveStatusTextEnV2,
		fixedStatusAfterLanguageChangeV2,
		compilerVersion: COMPILER_VERSION,
		segments: tokenizeTemplate("[[value]]"),
	})}\n`,
);
