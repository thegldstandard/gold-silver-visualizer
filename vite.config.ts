import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// IMPORTANT for GitHub Pages: must match https://thegldstandard.github.io/gold-silver-visualizer/
export default defineConfig({
  plugins: [react()],
  base: "/gold-silver-visualizer/",
});
