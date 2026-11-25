/* eslint-disable import/no-extraneous-dependencies */
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// The demo intentionally has no Deephaven server dependency, so there is no
// proxy configuration here.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  let port = Number.parseInt(env.PORT, 10);
  if (Number.isNaN(port) || port <= 0) {
    port = 9020;
  }

  return {
    base: env.BASE_URL ?? "./",
    envPrefix: ["VITE_", "npm_"],
    plugins: [react()],
    css: { preprocessorOptions: { scss: { api: "modern-compiler" } } },
    server: { port },
    preview: { port },
    resolve: {
      dedupe: ["react", "react-dom"],
      alias:
        mode === "development"
          ? [
              {
                find: /^gigaplot$/,
                replacement: path.resolve(__dirname, "../gigaplot/src"),
              },
            ]
          : [],
    },
    build: {
      outDir: env.VITE_BUILD_PATH ?? "./build",
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});
