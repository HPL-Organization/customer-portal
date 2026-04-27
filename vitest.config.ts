import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/autopay/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
