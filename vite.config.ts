import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import fs from 'fs'
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

// ビルドのたびに「ビルド日時(JST)」から自動採番したバージョンを1回だけ生成する。
// この1つの値を define（バンドルへ焼込み）/ build-info.json / publish-version.mjs(DB)
// の3か所で共有することで、稼働中の画面のバージョンとDB記録が必ず一致する。
function genAppBuild(): { version: string; buildTime: string } {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC+9
  const p = (n: number) => String(n).padStart(2, '0');
  const version = `v${jst.getUTCFullYear()}.${p(jst.getUTCMonth() + 1)}.${p(jst.getUTCDate())}.${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}`;
  return { version, buildTime: now.getTime().toString() };
}
const APP_BUILD = genAppBuild();

function buildInfoPlugin(): Plugin {
  return {
    name: 'build-info',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: JSON.stringify({ buildTime: APP_BUILD.buildTime, version: APP_BUILD.version }),
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

// vite dev は api/ 配下を実行しない（Vercel のサーバーレス関数は本番のみ）ため、
// ローカルでも /api/* を叩けるようにする dev 専用ミドルウェア。
// apply:'serve' なので本番ビルドには一切影響しない。
function devApiPlugin(): Plugin {
  const API_DIR = path.resolve(__dirname, 'api')

  // /api/a/b/c を api/a/b/c.ts に解決する。
  // 見つからなければ [param].ts / [param]/ を辿り、動的セグメントを params に積む。
  function resolveHandler(
    segments: string[], dir: string, params: Record<string, string>,
  ): { file: string; params: Record<string, string> } | null {
    if (segments.length === 0 || !fs.existsSync(dir)) return null
    const [head, ...rest] = segments
    const entries = fs.readdirSync(dir)

    // [...param].ts は残りのセグメントをまとめて受けるキャッチオール
    const catchAll = entries.find(f => f.startsWith('[...') && f.endsWith('].ts'))

    if (rest.length === 0) {
      const exact = path.join(dir, `${head}.ts`)
      if (fs.existsSync(exact)) return { file: exact, params }
      const dyn = entries.find(f => f.startsWith('[') && !f.startsWith('[...') && f.endsWith('].ts'))
      if (dyn) return { file: path.join(dir, dyn), params: { ...params, [dyn.slice(1, -4)]: head } }
      return catchAll
        ? { file: path.join(dir, catchAll), params: { ...params, [catchAll.slice(4, -4)]: head } }
        : null
    }

    const sub = path.join(dir, head)
    if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) {
      const hit = resolveHandler(rest, sub, params)
      if (hit) return hit
    }
    const dynDir = entries.find(f =>
      f.startsWith('[') && f.endsWith(']') && fs.statSync(path.join(dir, f)).isDirectory())
    if (dynDir) {
      const hit = resolveHandler(rest, path.join(dir, dynDir), { ...params, [dynDir.slice(1, -1)]: head })
      if (hit) return hit
    }
    return catchAll
      ? { file: path.join(dir, catchAll), params: { ...params, [catchAll.slice(4, -4)]: segments.join('/') } }
      : null
  }

  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      // api ハンドラは process.env（SUPABASE_SERVICE_ROLE_KEY 等）を読むので .env を流し込む
      Object.assign(process.env, loadEnv('development', process.cwd(), ''))

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        const url = new URL(req.url, 'http://localhost')
        const segments = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean)
        const hit = resolveHandler(segments, API_DIR, {})
        if (!hit) return next()

        // Vercel の (req, res) インターフェースに寄せる
        const query: Record<string, string> = { ...hit.params }
        url.searchParams.forEach((v, k) => { query[k] = v })
        ;(req as any).query = query

        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const rawBuf = Buffer.concat(chunks)
        // JSON 以外は Buffer のまま渡す。文字列化すると WebDAV の PUT など
        // バイナリ本文が壊れるため。
        if ((req.headers['content-type'] ?? '').includes('application/json')) {
          try { (req as any).body = rawBuf.length ? JSON.parse(rawBuf.toString('utf8')) : {} }
          catch { (req as any).body = {} }
        } else {
          ;(req as any).body = rawBuf
        }

        const r = res as any
        r.status = (code: number) => { res.statusCode = code; return r }
        r.json = (obj: unknown) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(obj)); return r
        }
        r.send = (b: unknown) => { res.end(typeof b === 'string' ? b : JSON.stringify(b)); return r }
        r.redirect = (loc: string) => {
          res.statusCode = 302; res.setHeader('Location', loc); res.end(); return r
        }

        try {
          const mod = await server.ssrLoadModule(hit.file)
          await mod.default(req, res)
        } catch (e) {
          console.error(`[dev-api] ${url.pathname}`, e)
          if (!res.writableEnded) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    buildInfoPlugin(),
    devApiPlugin(),
    openChromePlugin(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  // 稼働中バージョンをバンドルへ焼込む（src/lib/version.ts が参照）
  define: {
    __APP_VERSION__: JSON.stringify(APP_BUILD.version),
  },

  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // 記事エクスポート(PDF/Word/Excel)で動的import するライブラリを事前バンドルしておく
  // （未指定だと dev サーバーが初回 import 時に再最適化→リロードが走り、
  //  1回目のダウンロードが空振り／「Failed to fetch dynamically imported module」になるため）
  optimizeDeps: {
    include: ['@react-pdf/renderer', 'docx', 'exceljs', 'buffer'],
  },
})
