// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc'; // or '@vitejs/plugin-react' if you used that

export default defineConfig({
  plugins: [react()],
  base: '/gold-silver-visualizer/', // <-- MUST match your repo name
});
