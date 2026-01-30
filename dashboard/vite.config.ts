import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite 开发服务器默认会对非文件请求回退到 index.html，直接打开 /snippets 等路径即可
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('framer-motion')) return 'framer-motion'
            // lucide-react 与 React 打在同一 bundle，避免拆包后 React.forwardRef 为 undefined 导致白屏
            if (id.includes('react-syntax-highlighter') || id.includes('react-markdown')) return 'markdown'
            return 'vendor'
          }
        }
      }
    }
  }
})
