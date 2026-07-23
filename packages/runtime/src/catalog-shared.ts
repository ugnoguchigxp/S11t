import { S11tError } from "./diagnostics.js";
import type { JsonValue, TemplateSegment } from "./types.js";

export function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function digestMismatch(path: Array<string | number>, label: string): never {
	throw new S11tError("S11T_ARTIFACT_DIGEST_MISMATCH", `${label} digest mismatch`, path);
}

export function templateFromSegments(segments: TemplateSegment[]): string {
	return segments
		.map((segment) => (segment.type === "literal" ? segment.value : `[[${segment.name}]]`))
		.join("");
}

export function cloneJson<T extends JsonValue>(value: T): T {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, cloneJson(item)]),
	) as T;
}

export function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) deepFreeze(item);
	}
	return value;
}

export function valuesRecord(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new S11tError("S11T_VALUE_INVALID", "Values must be an object", []);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new S11tError("S11T_VALUE_INVALID", "Values must be a plain object", []);
	}
	return value as Record<string, unknown>;
}

export function renderSection(
	section: { segments: TemplateSegment[] },
	encodedValues: Record<string, string>,
): string {
	return section.segments
		.map((segment) => {
			if (segment.type === "literal") return segment.value;
			if (!Object.hasOwn(encodedValues, segment.name)) {
				throw new S11tError("S11T_ARTIFACT_INVALID", "Variable segment is undeclared", [segment.name]);
			}
			return encodedValues[segment.name]!;
		})
		.join("");
}
