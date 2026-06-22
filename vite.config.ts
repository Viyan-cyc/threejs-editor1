import { fileURLToPath, URL } from 'node:url'
import { loadEnv, defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 读取全部环境变量（不带 VITE_ 前缀 → 不进客户端 bundle，key 不暴露给浏览器）
  const envVars = loadEnv(mode, process.cwd(), '')
  const llmBaseUrl = envVars.LLM_BASE_URL ?? ''
  const llmApiKey = envVars.LLM_API_KEY ?? ''
  const clientModel = envVars.VITE_LLM_MODEL ?? ''

  // 启动诊断（不打印 key 明文）
  console.log('[llm] 启动配置：')
  console.log(`[llm]   LLM_BASE_URL  = ${llmBaseUrl || '(空) ← 404/405 多半因为它没配或拼错'}`)
  console.log(`[llm]   LLM_API_KEY   = ${llmApiKey ? `已设置(${llmApiKey.length} 字符)` : '(空)'}`)
  console.log(`[llm]   VITE_LLM_MODEL= ${clientModel || '(空)'}`)

  const proxyHeaders: Record<string, string> = llmApiKey ? { Authorization: `Bearer ${llmApiKey}` } : {}

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // LLM 代理：浏览器 POST /api/llm/* → dev server 转发到 LLM_BASE_URL（服务端注入 key）
      proxy:
        llmBaseUrl.length > 0
          ? {
              '/api/llm': {
                target: llmBaseUrl,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/llm/, ''),
                headers: proxyHeaders,
                configure: (proxy) => {
                  // 请求/响应诊断日志（dev 终端可见），便于排查 405/路径错误
                  let targetHost = ''
                  try {
                    targetHost = new URL(llmBaseUrl).host
                  } catch {
                    targetHost = ''
                  }
                  const emitter = proxy as { on: (event: string, cb: (...args: unknown[]) => void) => void }
                  emitter.on('proxyReq', (...args: unknown[]) => {
                    const proxyReq = args[0] as { method?: string; path?: string }
                    console.log(`[llm-proxy] -> ${proxyReq.method ?? ''} https://${targetHost}${proxyReq.path ?? ''}`)
                  })
                  emitter.on('proxyRes', (...args: unknown[]) => {
                    const proxyRes = args[0] as { statusCode?: number; headers?: Record<string, string> }
                    const req = args[1] as { url?: string }
                    const ct = proxyRes.headers?.['content-type'] ?? ''
                    console.log(`[llm-proxy] <- ${proxyRes.statusCode ?? '?'} content-type=${ct || '?'} (${req.url ?? ''})`)
                  })
                  emitter.on('error', (...args: unknown[]) => {
                    const err = args[0] as { message?: string }
                    console.error('[llm-proxy] 代理错误:', err?.message ?? err)
                  })
                },
              },
            }
          : undefined,
    },
  }
})
