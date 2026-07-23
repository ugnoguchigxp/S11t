import type { CanonicalVariableDefinition } from "@s11t/runtime/compiler";
import { relative } from "node:path";

import type { AuthoringDocument } from "../authoring-schema.js";

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function quoted(value: string): string {
	return JSON.stringify(value);
}

function literalText(value: string): string {
	if (value.includes("'''")) return JSON.stringify(value);
	return `'''${value}'''`;
}

export function variableSignature(variable: CanonicalVariableDefinition): string {
	return [variable.type, variable.trust, variable.placement, variable.encoding].join("|");
}

export function profileName(variable: CanonicalVariableDefinition): string {
	const signature = variableSignature(variable);
	const names: Record<string, string> = {
		"string|trusted|inline|raw": "trusted.inline",
		"string|trusted|delimited-context|raw": "trusted.block",
		"string|untrusted|delimited-context|json-string": "untrusted.text",
		"json|untrusted|delimited-context|json-value": "untrusted.json",
		"json|trusted|delimited-context|json-value": "trusted.json",
		"number|trusted|inline|json-value": "trusted.number",
	};
	return names[signature] ?? `${variable.trust}.${variable.type}.${variable.placement}.${variable.encoding}`;
}

export function canonicalKey(sourceDir: string, sourceFile: string): string {
	const path = relative(sourceDir, sourceFile)
		.replaceAll("\\", "/")
		.replace(/\.context\.toml$/, "");
	return path.replaceAll("/", ".");
}

export function serializeConfigV2(input: {
	sourceDir: string;
	outDir: string;
	sourceLocale: string;
	requiredLocales: string[];
	owners: Record<string, string>;
	profiles: Record<string, CanonicalVariableDefinition>;
	aliases: Record<string, string>;
}): string {
	const lines = [
		"schema_version = 2",
		"authoring_version = 2",
		"artifact_version = 2",
		`source_dir = ${quoted(input.sourceDir)}`,
		`out_dir = ${quoted(input.outDir)}`,
		"",
		"[authoring]",
		`source_locale = ${quoted(input.sourceLocale)}`,
		"",
		"[governance]",
		"require_owner = true",
	];
	for (const [prefix, owner] of Object.entries(input.owners).sort(([left], [right]) =>
		compareCodeUnits(left, right),
	)) {
		lines.push("", `[keyspaces.${quoted(prefix)}]`, `owner = ${quoted(owner)}`);
	}
	lines.push(
		"",
		"[release_profiles.development]",
		`required_locales = [${input.requiredLocales.map(quoted).join(", ")}]`,
	);
	for (const [name, profile] of Object.entries(input.profiles).sort(([left], [right]) =>
		compareCodeUnits(left, right),
	)) {
		lines.push(
			"",
			`[variable_profiles.${quoted(name)}]`,
			`type = ${quoted(profile.type)}`,
			`trust = ${quoted(profile.trust)}`,
			`placement = ${quoted(profile.placement)}`,
			`encoding = ${quoted(profile.encoding)}`,
		);
	}
	lines.push("", "[key_aliases]");
	for (const [alias, target] of Object.entries(input.aliases).sort(([left], [right]) =>
		compareCodeUnits(left, right),
	)) {
		lines.push(`${quoted(alias)} = ${quoted(target)}`);
	}
	return `${lines.join("\n")}\n`;
}

export function serializeDocumentV2(
	document: AuthoringDocument,
	profiles: ReadonlyMap<string, string>,
): string {
	const lines: string[] = [];
	const sections = document.definition.sections;
	const simple =
		sections.length === 1 &&
		sections[0]?.id === "context.text" &&
		sections[0]?.kind === "instruction" &&
		sections[0]?.severity === "must" &&
		sections[0]?.enforcement === "prompt" &&
		sections[0]?.optimizable === false;
	if (simple) {
		const section = sections[0]!;
		lines.push(`text = ${literalText(section.locales[document.definition.sourceLocale]!)}`);
		for (const [locale, text] of Object.entries(section.locales).sort(([left], [right]) =>
			compareCodeUnits(left, right),
		)) {
			if (locale === document.definition.sourceLocale) continue;
			lines.push("", `[translations.${quoted(locale)}]`, `text = ${literalText(text)}`);
		}
	} else {
		for (const section of sections) {
			lines.push(
				...(lines.length === 0 ? [] : [""]),
				"[[sections]]",
				`id = ${quoted(section.id)}`,
				`kind = ${quoted(section.kind)}`,
				`severity = ${quoted(section.severity)}`,
				`enforcement = ${quoted(section.enforcement)}`,
				`optimizable = ${String(section.optimizable)}`,
				`text = ${literalText(section.locales[document.definition.sourceLocale]!)}`,
			);
			for (const [locale, text] of Object.entries(section.locales).sort(
				([left], [right]) => compareCodeUnits(left, right),
			)) {
				if (locale === document.definition.sourceLocale) continue;
				lines.push("", `[sections.translations.${quoted(locale)}]`, `text = ${literalText(text)}`);
			}
		}
	}
	for (const [name, variable] of Object.entries(document.definition.variables).sort(
		([left], [right]) => compareCodeUnits(left, right),
	)) {
		const profile = profiles.get(variableSignature(variable));
		if (profile === undefined) throw new Error(`Missing variable profile for ${name}`);
		lines.push("", `[variables.${name}]`, `profile = ${quoted(profile)}`);
	}
	return `${lines.join("\n")}\n`;
}
