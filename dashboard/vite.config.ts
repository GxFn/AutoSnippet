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
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          // 单独分割优先级高的大型库，避免循环依赖
          if (id.includes('framer-motion')) return 'framer-motion'
          if (id.includes('react-syntax-highlighter')) return 'syntax-highlighter'
          if (id.includes('react-markdown')) return 'react-markdown'
          if (id.includes('axios')) return 'axios'
          if (id.includes('yaml')) return 'yaml'
          if (id.includes('undici')) return 'undici'

          // 其他库都打到 vendor，让 Rollup 自己处理分割
          return 'vendor'
        }
      }
    }
  }
})
