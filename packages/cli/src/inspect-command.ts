import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";
import { compileProject, isCompiledProjectV2 } from "./compile-source.js";

export function inspectContext(
	key: string,
	options: { config?: string; locale?: string; cwd?: string; releaseProfile?: string; resolved?: boolean } = {},
): unknown {
	const project = compileProject(options.config, options.cwd, options.releaseProfile);
	if (isCompiledProjectV2(project)) {
		const resolvedKey = Object.hasOwn(project.artifact.contexts, key)
			? key
			: Object.hasOwn(project.artifact.aliases, key)
				? project.artifact.aliases[key]
				: undefined;
		if (resolvedKey === undefined) {
			const diagnostic: S11tDiagnostic = {
				code: "S11T_CONTEXT_NOT_FOUND",
				severity: "error",
				message: `Context not found: ${key}`,
				file: project.configPath,
				path: [key],
			};
			throw new S11tDiagnosticError([diagnostic]);
		}
		const context = project.artifact.contexts[resolvedKey];
		if (context === undefined) throw new Error(`Resolved context is missing: ${resolvedKey}`);
		if (options.resolved === true) {
			const document = project.documents.find((candidate) => candidate.definition.key === resolvedKey)!;
			return {
				key: context.key,
				requestedKey: key,
				aliasUsed: key !== resolvedKey,
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
			const diagnostic: S11tDiagnostic = {
				code: "S11T_LOCALE_NOT_FOUND",
				severity: "error",
				message: `Locale not found: ${locale}`,
				file: project.configPath,
				path: [resolvedKey, locale],
			};
			throw new S11tDiagnosticError([diagnostic]);
		}
		return {
			key: context.key,
			requestedKey: key,
			owner: context.owner,
			locale,
			definitionHash: context.definitionHash,
			artifactHash: compiledLocale.artifactHash,
			releaseDigest: context.releaseDigest,
			variables: context.variables,
			sections: compiledLocale.sections,
		};
	}
	const context = project.artifact.contexts[key];
	if (context === undefined) {
		const diagnostic: S11tDiagnostic = {
			code: "S11T_CONTEXT_NOT_FOUND",
			severity: "error",
			message: `Context not found: ${key}`,
			file: project.configPath,
			path: [key],
		};
		throw new S11tDiagnosticError([diagnostic]);
	}
	const locale = options.locale ?? project.config.defaultLocale;
	const compiledLocale = context.locales[locale];
	if (compiledLocale === undefined) {
		const diagnostic: S11tDiagnostic = {
			code: "S11T_LOCALE_NOT_FOUND",
			severity: "error",
			message: `Locale not found: ${locale}`,
			file: project.configPath,
			path: [key, locale],
		};
		throw new S11tDiagnosticError([diagnostic]);
	}
	return {
		id: context.id,
		version: context.version,
		owner: context.owner,
		locale,
		definitionHash: context.definitionHash,
		artifactHash: compiledLocale.artifactHash,
		releaseDigest: context.releaseDigest,
		variables: context.variables,
		sections: compiledLocale.sections,
	};
}
