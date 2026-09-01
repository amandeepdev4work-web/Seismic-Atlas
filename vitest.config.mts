import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/*" alias declared in tsconfig.json (Vite does this
  // natively now — the vite-tsconfig-paths plugin is no longer needed).
  resolve: { tsconfigPaths: true },
  test: {
    // lib/csv.ts is pure — no DOM needed, and jsdom would only slow it down.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
