import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["packages/runtime/src/**/*.ts", "packages/cli/src/**/*.ts"],
			reporter: ["text", "json-summary"],
			thresholds: {
				statements: 80,
				branches: 68,
				functions: 88,
				lines: 84,
			},
		},
	},
});
