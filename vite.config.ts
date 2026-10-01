import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: process.env.VITE_BASE || '/samgtu-schedule/',
  server: {
    port: 3000,
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/docx')) {
            return 'vendor-docx';
          }
          if (id.includes('node_modules/lucide-react') || id.includes('node_modules/sonner')) {
            return 'vendor-ui';
          }
        }
      }
    }
  }
});
