import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/config/**/*.ts",
        "src/lib/wagers/**/*.ts",
        "src/lib/external-wagers/**/*.ts",
        "src/lib/analytics/**/*.ts",
        "src/lib/parlays/**/*.ts",
        "src/lib/settlement/grading.ts",
        "src/lib/scores/{normalize,request,service}.ts",
      ],
    },
  },
});
