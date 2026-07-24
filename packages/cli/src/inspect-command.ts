import { S11tnextDiagnosticError, type S11tnextDiagnostic } from "./diagnostics.js";
import { compileProject } from "./compile-source.js";
import { loadProject } from "./discover.js";

const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

export type CoverageStatus = "direct" | "fallback" | "missing";

export type LocaleCoverageResult = {
	releaseProfile: string;
	sourceLocale: string;
	requestedLocale: string;
	fallbackLocales: string[];
	requiredLocales: string[];
	requiredCoverageSatisfied: boolean;
	totals: {
		contexts: number;
		direct: number;
		fallback: number;
		missing: number;
	};
	direct: { keys: string[] };
	fallback: {
		keys: string[];
		resolvedByLocale: Record<string, string[]>;
	};
	missing: { keys: string[] };
};

function coverageDiagnostic(
	code: string,
	message: string,
	file: string,
	path: Array<string | number>,
): never {
	throw new S11tnextDiagnosticError([{ code, severity: "error", message, file, path }]);
}

function hasLocale(
	sections: readonly { locales: Record<string, string> }[],
	locale: string,
): boolean {
	return sections.every((section) => Object.hasOwn(section.locales, locale));
}

export function inspectCoverage(options: {
	config?: string;
	locale: string;
	fallbackLocales?: readonly string[];
	cwd?: string;
	releaseProfile: string;
}): LocaleCoverageResult {
	const fallbackLocales = [...(options.fallbackLocales ?? [])];
	if (!LOCALE_PATTERN.test(options.locale)) {
		coverageDiagnostic(
			"S11TNEXT_LOCALE_INVALID",
			`Invalid requested locale: ${options.locale}`,
			options.config ?? "s11tnext.config.toml",
			["locale"],
		);
	}
	if (
		fallbackLocales.some((locale) => !LOCALE_PATTERN.test(locale)) ||
		fallbackLocales.includes(options.locale) ||
		new Set(fallbackLocales).size !== fallbackLocales.length
	) {
		coverageDiagnostic(
			"S11TNEXT_LOCALE_INVALID",
			"Fallback locales must be unique valid locales and differ from the requested locale",
			options.config ?? "s11tnext.config.toml",
			["fallbackLocales"],
		);
	}
	const project = loadProject(
		options.config,
		options.cwd,
		options.releaseProfile,
		{ validateRequiredCoverage: false },
	);
	const direct: string[] = [];
	const fallback: string[] = [];
	const missing: string[] = [];
	const resolvedByLocale = Object.fromEntries(
		fallbackLocales.map((locale) => [locale, [] as string[]]),
	);
	let requiredCoverageSatisfied = true;
	for (const document of project.documents) {
		const { key, requiredLocales, sections } = document.definition;
		if (requiredLocales.some((locale) => !hasLocale(sections, locale))) {
			requiredCoverageSatisfied = false;
		}
		if (hasLocale(sections, options.locale)) {
			direct.push(key);
			continue;
		}
		const resolvedFallback = fallbackLocales.find((locale) => hasLocale(sections, locale));
		if (resolvedFallback === undefined) {
			missing.push(key);
			continue;
		}
		fallback.push(key);
		resolvedByLocale[resolvedFallback]!.push(key);
	}
	const requiredLocales = [...(project.documents[0]?.definition.requiredLocales ?? [])];
	direct.sort();
	fallback.sort();
	missing.sort();
	for (const keys of Object.values(resolvedByLocale)) keys.sort();
	return {
		releaseProfile: project.releaseProfile,
		sourceLocale: project.config.authoring.sourceLocale,
		requestedLocale: options.locale,
		fallbackLocales,
		requiredLocales,
		requiredCoverageSatisfied,
		totals: {
			contexts: project.documents.length,
			direct: direct.length,
			fallback: fallback.length,
			missing: missing.length,
		},
		direct: { keys: direct },
		fallback: { keys: fallback, resolvedByLocale },
		missing: { keys: missing },
	};
}

export function inspectContext(
	key: string,
	options: { config?: string; locale?: string; cwd?: string; releaseProfile?: string; resolved?: boolean } = {},
): unknown {
	const project = compileProject(options.config, options.cwd, options.releaseProfile);
	if (!Object.hasOwn(project.artifact.contexts, key)) {
		const diagnostic: S11tnextDiagnostic = {
			code: "S11TNEXT_CONTEXT_NOT_FOUND",
			severity: "error",
			message: `Context not found: ${key}`,
			file: project.configPath,
			path: [key],
		};
		throw new S11tnextDiagnosticError([diagnostic]);
	}
	const context = project.artifact.contexts[key];
	if (context === undefined) throw new Error(`Context is missing: ${key}`);
	if (options.resolved === true) {
		const document = project.documents.find((candidate) => candidate.definition.key === key)!;
		return {
			key: context.key,
			owner: context.owner,
			contentKind: context.contentKind,
			sourceLocale: context.sourceLocale,
			requiredLocales: context.requiredLocales,
			availableLocales: Object.keys(context.locales).sort(),
			variables: context.variables,
			definitionHash: context.definitionHash,
			releaseProfile: project.releaseProfile,
			policyDigest: project.artifact.policyDigest,
			origins: document.origins,
		};
	}
	const locale = options.locale ?? context.sourceLocale;
	const compiledLocale = context.locales[locale];
	if (compiledLocale === undefined) {
		const diagnostic: S11tnextDiagnostic = {
			code: "S11TNEXT_LOCALE_NOT_FOUND",
			severity: "error",
			message: `Locale not found: ${locale}`,
			file: project.configPath,
			path: [key, locale],
		};
		throw new S11tnextDiagnosticError([diagnostic]);
	}
	return {
		key: context.key,
		owner: context.owner,
		locale,
		definitionHash: context.definitionHash,
		artifactHash: compiledLocale.artifactHash,
		releaseDigest: context.releaseDigest,
		variables: context.variables,
		sections: compiledLocale.sections,
	};
}
