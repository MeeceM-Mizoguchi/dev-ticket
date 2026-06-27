import { defineConfig } from 'vite'
import path from 'path'
import { exec } from 'child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

function buildInfoPlugin(): Plugin {
  return {
    name: 'build-info',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: JSON.stringify({ buildTime: Date.now().toString() }),
      });
    },
  };
}

function openChromePlugin() {
  return {
    name: 'open-chrome',
    configureServer(server: any) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        const port = typeof address === 'object' && address ? address.port : 5173
        const url = `http://localhost:${port}`
        // OS ごとに Chrome を開くコマンドを切り替える
        const command =
          process.platform === 'darwin'
            ? `open -a "Google Chrome" ${url}`
            : process.platform === 'win32'
              ? `start chrome ${url}`
              : `google-chrome ${url}`
        exec(command)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    buildInfoPlugin(),
    openChromePlugin(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // PDF出力で動的import するライブラリを事前バンドルしておく
  // （未指定だと dev サーバーが初回 import 時に再最適化→リロードが走り、
  //  「Failed to fetch dynamically imported module」エラーになるため）
  optimizeDeps: {
    include: ['@react-pdf/renderer'],
  },
})
