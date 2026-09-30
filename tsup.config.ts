import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", pricing: "src/pricing.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: [],
});
