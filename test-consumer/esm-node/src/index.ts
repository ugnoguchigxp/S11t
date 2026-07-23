import { readFileSync } from "node:fs";

import { verifyRenderedHash } from "@s11t/runtime";
import { COMPILER_VERSION, tokenizeTemplate } from "@s11t/runtime/compiler";

import { createAppCatalog } from "../.s11t/catalog.generated.js";

const artifact: unknown = JSON.parse(
	readFileSync(new URL("../../.s11t/catalog.json", import.meta.url), "utf8"),
);
const catalog = createAppCatalog(artifact);
const request = catalog.bindRequest({ instructionLocale: "ja-JP" });
const invocation = request.invoke("consumer.identity", {
	taskGoal: "tarballを検証する",
});
const requestAudit = request.finalize(invocation);
const renderedHashVerified = verifyRenderedHash(
	invocation.content.text,
	invocation.manifest.renderedHash,
);
const boundText = catalog.bindText({ instructionLocale: "ja-JP" });
const text = boundText.p("consumer.identity", { taskGoal: "tarballを検証する" });
const statusText = boundText.byKey["consumer.status"]({});
let topLevelInstructionLocale = "ja-JP";
const liveText = catalog.createTextRenderer(() => ({
	instructionLocale: topLevelInstructionLocale,
}));
const liveStatusTextJa = liveText("consumer.status", {});
topLevelInstructionLocale = "en-US";
const liveStatusTextEn = liveText("consumer.status", {});
const fixedStatusAfterLanguageChange = boundText.byKey["consumer.status"]({});

if (false) {
	// @ts-expect-error missing required value
	boundText.p("consumer.identity", {});
	// @ts-expect-error exact empty values reject extra properties
	liveText("consumer.status", { extra: true });
	// @ts-expect-error unknown key
	boundText.byKey["consumer.unknown"]({});
}

process.stdout.write(
	`${JSON.stringify({
		invocation,
		requestAudit,
		renderedHashVerified,
		text,
		statusText,
		liveStatusTextJa,
		liveStatusTextEn,
		fixedStatusAfterLanguageChange,
		compilerVersion: COMPILER_VERSION,
		segments: tokenizeTemplate("[[value]]"),
	})}\n`,
);
