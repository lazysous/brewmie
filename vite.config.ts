import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Brewmie deploys to brewmie.app at root, with the same build also serving
// Capacitor's file:// scheme on iOS/Android. './' (relative) works for both
// root domain web and Capacitor — keep it relative for portability.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    manifest: true,
  },
})
