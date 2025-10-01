import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc'; // If you installed '@vitejs/plugin-react', change this import accordingly.

export default defineConfig({
  plugins: [react()],
  // IMPORTANT: this must match your repo name exactly for GitHub Pages
  base: '/gold-silver-visualizer/',
});
