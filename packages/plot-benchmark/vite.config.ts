/* eslint-disable import/no-extraneous-dependencies */
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  let port = Number.parseInt(env.PORT, 10);
  if (Number.isNaN(port) || port <= 0) {
    port = 9030;
  }

  return {
    base: env.BASE_URL ?? "./",
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
      // Each library is its own lazily loaded chunk, and Plotly alone is ~5 MB
      chunkSizeWarningLimit: 5000,
    },
  };
});
