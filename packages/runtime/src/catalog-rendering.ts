import {
	deepFreeze,
	renderSection,
	valuesRecord,
} from "./catalog-shared.js";
import type {
	CatalogBinding,
	PromptInvocation,
} from "./catalog-types.js";
import { S11tnextError } from "./diagnostics.js";
import { encodeValue } from "./encoding.js";
import { hashPromptMessage, hashRendered } from "./hash.js";
import type { S11tnextCatalogArtifact } from "./types.js";

const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

export function validateBinding(
	binding: CatalogBinding,
): Required<CatalogBinding> {
	if (binding === null || typeof binding !== "object" || Array.isArray(binding)) {
		throw new S11tnextError("S11TNEXT_VALUE_INVALID", "Binding must be an object", [
			"binding",
		]);
	}
	const source = binding as unknown as Record<string, unknown>;
	for (const key of Reflect.ownKeys(source)) {
		if (
			typeof key !== "string" ||
			!["instructionLocale", "fallbackLocales", "trailingNewline"].includes(key)
		) {
			throw new S11tnextError(
				"S11TNEXT_VALUE_INVALID",
				"Binding contains an unsupported field",
				[typeof key === "string" ? key : "binding"],
			);
		}
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (
			descriptor === undefined ||
			!descriptor.enumerable ||
			!("value" in descriptor)
		) {
			throw new S11tnextError(
				"S11TNEXT_VALUE_INVALID",
				"Binding must use data properties",
				[key],
			);
		}
	}
	const instructionDescriptor = Object.getOwnPropertyDescriptor(
		source,
		"instructionLocale",
	);
	const instructionLocale =
		instructionDescriptor !== undefined && "value" in instructionDescriptor
			? instructionDescriptor.value
			: undefined;
	if (
		typeof instructionLocale !== "string" ||
		!LOCALE_PATTERN.test(instructionLocale)
	) {
		throw new S11tnextError(
			"S11TNEXT_VALUE_INVALID",
			"instructionLocale is invalid",
			["instructionLocale"],
		);
	}
	const fallbackDescriptor = Object.getOwnPropertyDescriptor(
		source,
		"fallbackLocales",
	);
	const fallbackInput =
		fallbackDescriptor !== undefined && "value" in fallbackDescriptor
			? fallbackDescriptor.value
			: [];
	if (!Array.isArray(fallbackInput)) {
		throw new S11tnextError(
			"S11TNEXT_VALUE_INVALID",
			"fallbackLocales must be an array",
			["fallbackLocales"],
		);
	}
	const fallbackLocales: unknown[] = [];
	for (const key of Reflect.ownKeys(fallbackInput)) {
		if (key === "length") continue;
		if (
			typeof key !== "string" ||
			!/^(?:0|[1-9]\d*)$/.test(key) ||
			Number(key) >= fallbackInput.length
		) {
			throw new S11tnextError(
				"S11TNEXT_VALUE_INVALID",
				"fallbackLocales contains an unsupported field",
				["fallbackLocales"],
			);
		}
		const descriptor = Object.getOwnPropertyDescriptor(fallbackInput, key);
		if (
			descriptor === undefined ||
			!descriptor.enumerable ||
			!("value" in descriptor)
		) {
			throw new S11tnextError(
				"S11TNEXT_VALUE_INVALID",
				"fallbackLocales must use data properties",
				["fallbackLocales", Number(key)],
			);
		}
	}
	for (let index = 0; index < fallbackInput.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(
			fallbackInput,
			String(index),
		);
		if (descriptor === undefined || !("value" in descriptor)) {
			throw new S11tnextError(
				"S11TNEXT_VALUE_INVALID",
				"fallbackLocales cannot be sparse",
				["fallbackLocales", index],
			);
		}
		fallbackLocales.push(descriptor.value);
	}
	if (
		fallbackLocales.some(
			(locale) =>
				typeof locale !== "string" || !LOCALE_PATTERN.test(locale),
		) ||
		fallbackLocales.includes(instructionLocale) ||
		new Set(fallbackLocales).size !== fallbackLocales.length
	) {
		throw new S11tnextError(
			"S11TNEXT_VALUE_INVALID",
			"fallbackLocales must be unique valid locales",
			["fallbackLocales"],
		);
	}
	const trailingNewlineDescriptor = Object.getOwnPropertyDescriptor(
		source,
		"trailingNewline",
	);
	const trailingNewline =
		trailingNewlineDescriptor !== undefined && "value" in trailingNewlineDescriptor
			? trailingNewlineDescriptor.value
			: true;
	if (typeof trailingNewline !== "boolean") {
		throw new S11tnextError(
			"S11TNEXT_VALUE_INVALID",
			"trailingNewline must be a boolean",
			["trailingNewline"],
		);
	}
	return {
		instructionLocale,
		fallbackLocales: fallbackLocales as string[],
		trailingNewline,
	};
}

function delimitEncodedValue(name: string, value: string): string {
	return `<S11TNEXT_DELIMITED_CONTEXT variable="${name}">\n${value}\n</S11TNEXT_DELIMITED_CONTEXT>`;
}

function shouldOmitSection(
	section: S11tnextCatalogArtifact["contexts"][string]["locales"][string]["sections"][number],
	values: Record<string, unknown>,
): boolean {
	if (!section.omitIfEmpty) return false;
	const variableNames = [
		...new Set(
			section.segments.flatMap((segment) =>
				segment.type === "variable" ? [segment.name] : [],
			),
		),
	];
	return (
		variableNames.length > 0 &&
		variableNames.every(
			(name) => !Object.hasOwn(values, name) || values[name] === "",
		)
	);
}

export function invokeContext(
	artifact: S11tnextCatalogArtifact,
	key: string,
	valuesInput: unknown,
	binding: CatalogBinding,
): PromptInvocation {
	if (!Object.hasOwn(artifact.contexts, key)) {
		throw new S11tnextError("S11TNEXT_CONTEXT_NOT_FOUND", `Context not found: ${key}`, [
			key,
		]);
	}
	const context = artifact.contexts[key]!;
	const candidates = [
		binding.instructionLocale,
		...(binding.fallbackLocales ?? []),
	];
	const resolvedLocale = candidates.find((locale) =>
		Object.hasOwn(context.locales, locale),
	);
	if (resolvedLocale === undefined) {
		throw new S11tnextError(
			"S11TNEXT_LOCALE_NOT_FOUND",
			`Locale not found: ${binding.instructionLocale}`,
			[key, binding.instructionLocale],
		);
	}
	const values = valuesRecord(valuesInput);
	for (const [name, definition] of Object.entries(context.variables)) {
		if (definition.required && !Object.hasOwn(values, name)) {
			throw new S11tnextError("S11TNEXT_VALUE_MISSING", `Missing value: ${name}`, [
				name,
			]);
		}
	}
	for (const name of Object.keys(values)) {
		if (!Object.hasOwn(context.variables, name)) {
			throw new S11tnextError("S11TNEXT_VALUE_EXTRA", `Unexpected value: ${name}`, [
				name,
			]);
		}
	}
	const encodedValues: Record<string, string> = {};
	const runtimeValues: Record<string, unknown> = {};
	for (const [name, definition] of Object.entries(context.variables)) {
		if (!Object.hasOwn(values, name)) {
			encodedValues[name] = "";
			continue;
		}
		const value = values[name];
		runtimeValues[name] = value;
		const encoded = encodeValue(value, definition, [name], {
			escapeBoundaryCharacters: definition.trust === "untrusted",
		});
		encodedValues[name] =
			definition.placement === "delimited-context"
				? delimitEncodedValue(name, encoded)
				: encoded;
	}
	const locale = context.locales[resolvedLocale]!;
	const includedSections = locale.sections.filter(
		(section) => !shouldOmitSection(section, runtimeValues),
	);
	const renderedSections = includedSections.map((section) =>
		renderSection(section, encodedValues),
	);
	const text =
		renderedSections.length === 0
			? ""
			: `${renderedSections.join("\n")}${binding.trailingNewline === false ? "" : "\n"}`;
	return deepFreeze({
		key,
		role: context.messageRole,
		content: { kind: "text", text },
		manifest: {
			key,
			messageRole: context.messageRole,
			messageHash: hashPromptMessage({
				role: context.messageRole,
				text,
			}),
			catalogDigest: artifact.catalogDigest,
			releaseDigest: context.releaseDigest,
			definitionHash: context.definitionHash,
			artifactHash: locale.artifactHash,
			renderedHash: hashRendered(text),
			requestedLocale: binding.instructionLocale,
			fallbackLocales: [...(binding.fallbackLocales ?? [])],
			resolvedLocale,
			sourceLocale: context.sourceLocale,
			fallbackUsed: resolvedLocale !== binding.instructionLocale,
			trailingNewline: binding.trailingNewline !== false,
			sectionIds: includedSections.map((section) => section.id),
			compilerVersion: artifact.compilerVersion,
			releaseProfile: artifact.releaseProfile,
			policyDigest: artifact.policyDigest,
		},
	});
}
