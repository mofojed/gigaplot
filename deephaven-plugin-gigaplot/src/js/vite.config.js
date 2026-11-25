import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    minify: false,
    lib: {
      entry: "./src/index.ts",
      fileName: () => "index.js",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "redux",
        "react-redux",
        // Externalize all Deephaven dependencies to reduce bundle size and maintain proper context for themes, etc.
        // @deephaven/redux is bundled instead, since the web UI does not provide it to plugins. Only its
        // selectors are used, which read the web UI's store through the external react-redux.
        "@deephaven/components",
        "@deephaven/dashboard",
        "@deephaven/icons",
        "@deephaven/jsapi-bootstrap",
        "@deephaven/jsapi-types",
        "@deephaven/jsapi-utils",
        "@deephaven/log",
        "@deephaven/plugin",
      ],
    },
  },
  define:
    mode === "production" ? { "process.env.NODE_ENV": '"production"' } : {},
  plugins: [react()],
  resolve: {
    // Bundle gigaplot from source so a separate build step is not required
    alias: {
      gigaplot: path.resolve(__dirname, "../../../packages/gigaplot/src"),
    },
  },
}));
