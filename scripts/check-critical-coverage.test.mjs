import { describe, expect, it } from "vitest";

import { checkCriticalCoverage } from "./check-critical-coverage.mjs";

const metrics = (percentage) => ({
	statements: { pct: percentage },
	branches: { pct: percentage },
	functions: { pct: percentage },
	lines: { pct: percentage },
});

describe("critical coverage gate", () => {
	it("accepts files at or above every configured threshold", () => {
		const summary = {
			"/workspace/project/critical.ts": metrics(90),
		};
		expect(
			checkCriticalCoverage(
				summary,
				{
					"critical.ts": {
						statements: 90,
						branches: 80,
						functions: 85,
						lines: 90,
					},
				},
				"/workspace/project",
			),
		).toBe(1);
	});

	it("reports missing files and metrics below their threshold", () => {
		expect(() =>
			checkCriticalCoverage(
				{ "/workspace/project/low.ts": metrics(50) },
				{
					"low.ts": { statements: 60 },
					"missing.ts": { lines: 80 },
				},
				"/workspace/project",
			),
		).toThrowError(/low\.ts statements[\s\S]*missing\.ts/);
	});
});
