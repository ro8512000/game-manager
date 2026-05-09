import { resolve } from 'path'
import { loadEnv } from 'vite'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    main: {
      define: {
        'process.env.GAME_DATA_ROOT': JSON.stringify(env.GAME_DATA_ROOT || '')
      }
    },
    preload: {},
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [react()]
    }
  }
})
