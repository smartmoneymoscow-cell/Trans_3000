import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/Trans_3000/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: false
  }
})
