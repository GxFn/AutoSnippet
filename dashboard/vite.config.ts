import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        timeout: 300000,      // 5 分钟（AI 扫描需要较长时间）
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('framer-motion')) return 'framer-motion';
          if (id.includes('react-syntax-highlighter')) return 'syntax-highlighter';
          if (id.includes('react-markdown')) return 'react-markdown';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('axios')) return 'axios';
          if (id.includes('yaml')) return 'yaml';
          return 'vendor';
        }
      }
    }
  }
})
