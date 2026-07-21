import { S11tDiagnosticError, type S11tDiagnostic } from "./diagnostics.js";
import { compileProject } from "./compile-source.js";

export function inspectContext(
	key: string,
	options: { config?: string; locale?: string; cwd?: string } = {},
): unknown {
	const project = compileProject(options.config, options.cwd);
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
