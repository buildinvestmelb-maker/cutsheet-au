import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
  build: {
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('maplibre-gl')) return 'vendor-maplibre';
          if (id.includes('three')) return 'vendor-three';
          if (id.includes('@turf')) return 'vendor-turf';
          if (id.includes('jspdf')) return 'vendor-jspdf';
          if (id.includes('geotiff')) return 'vendor-geotiff';
          if (id.includes('proj4')) return 'vendor-proj4';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
