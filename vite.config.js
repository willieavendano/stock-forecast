import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // relative paths, so the build works at a domain root or a sub-path
  build: {
    outDir: "build",
  },
});
