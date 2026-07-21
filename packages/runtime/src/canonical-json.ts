import type { JsonValue } from "./types.js";

function isPlainObject(value: object): value is Record<string, unknown> {
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function serialize(value: unknown, ancestors: Set<object>): string {
	if (value === null || typeof value === "boolean" || typeof value === "string") {
		return JSON.stringify(value);
	}

	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError("Canonical JSON does not support non-finite numbers");
		}
		return JSON.stringify(value);
	}

	if (typeof value !== "object") {
		throw new TypeError(`Canonical JSON does not support ${typeof value}`);
	}

	if (ancestors.has(value)) {
		throw new TypeError("Canonical JSON does not support cyclic values");
	}
	ancestors.add(value);

	try {
		if (Array.isArray(value)) {
			const items: string[] = [];
			for (let index = 0; index < value.length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(value, index);
				if (descriptor === undefined) {
					throw new TypeError("Canonical JSON does not support sparse arrays");
				}
				if (!("value" in descriptor)) {
					throw new TypeError("Canonical JSON does not support accessors");
				}
				items.push(serialize(descriptor.value, ancestors));
			}
			return `[${items.join(",")}]`;
		}

		if (!isPlainObject(value)) {
			throw new TypeError("Canonical JSON only supports plain objects");
		}

		const properties = Object.keys(value)
			.sort()
			.map((key) => {
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (descriptor === undefined || !("value" in descriptor)) {
					throw new TypeError("Canonical JSON does not support accessors");
				}
				return `${JSON.stringify(key)}:${serialize(descriptor.value, ancestors)}`;
			});
		return `{${properties.join(",")}}`;
	} finally {
		ancestors.delete(value);
	}
}

export function canonicalJson(value: JsonValue): string {
	return serialize(value, new Set<object>());
}
