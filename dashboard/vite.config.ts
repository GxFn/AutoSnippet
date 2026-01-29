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
  }
})
