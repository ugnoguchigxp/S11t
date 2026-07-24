import {
	deepFreeze,
	renderSection,
	valuesRecord,
} from "./catalog-shared.js";
import type {
	CatalogBinding,
	SystemContextInvocation,
} from "./catalog-types.js";
import { S11tnextError } from "./diagnostics.js";
import { encodeValue } from "./encoding.js";
import { hashRendered } from "./hash.js";
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
			!["instructionLocale", "fallbackLocales"].includes(key)
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
	return {
		instructionLocale,
		fallbackLocales: fallbackLocales as string[],
	};
}

function delimitEncodedValue(name: string, value: string): string {
	return `<S11TNEXT_DELIMITED_CONTEXT variable="${name}">\n${value}\n</S11TNEXT_DELIMITED_CONTEXT>`;
}

export function invokeContext(
	artifact: S11tnextCatalogArtifact,
	key: string,
	valuesInput: unknown,
	binding: CatalogBinding,
): SystemContextInvocation {
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
	for (const name of Object.keys(context.variables)) {
		if (!Object.hasOwn(values, name)) {
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
	for (const [name, definition] of Object.entries(context.variables)) {
		const encoded = encodeValue(values[name], definition, [name], {
			escapeBoundaryCharacters: definition.trust === "untrusted",
		});
		encodedValues[name] =
			definition.placement === "delimited-context"
				? delimitEncodedValue(name, encoded)
				: encoded;
	}
	const locale = context.locales[resolvedLocale]!;
	const text = `${locale.sections
		.map((section) => renderSection(section, encodedValues))
		.join("\n")}\n`;
	return deepFreeze({
		key,
		content: { kind: "text", text },
		manifest: {
			key,
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
			sectionIds: locale.sections.map((section) => section.id),
			compilerVersion: artifact.compilerVersion,
			releaseProfile: artifact.releaseProfile,
			policyDigest: artifact.policyDigest,
		},
	});
}
