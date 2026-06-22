import type { CallLlmOptions, LlmRawResponse } from '@/types/llm'

/**
 * LLM 调用配置（OpenAI 兼容 chat/completions）。
 *
 * ⚠️ 浏览器不能直连 LLM API（CORS + key 暴露）。因此：
 * - 浏览器只 POST 到同源 `/api/llm/chat/completions`；
 * - dev：由 Vite dev server 代理转发（vite.config.ts），key 放服务端变量 LLM_API_KEY（不进 bundle）；
 * - prod：由真实后端接管 `/api/llm`，key 放后端。
 *
 * 客户端仅需 VITE_LLM_MODEL（模型名，非敏感）。
 *
 * 注意 Vite 规则：只有 VITE_ 前缀的变量才会进浏览器；LLM_BASE_URL/LLM_API_KEY
 * 不带 VITE_（仅在 vite.config 代理/后端用，不暴露）。模型名非敏感，故用 VITE_ 前缀。
 */

export interface LlmConfig {
  /** 模型名（非敏感，客户端可见） */
  model: string
}

function env(key: string): string {
  const record = import.meta.env as unknown as Record<string, string | undefined>
  return (record[key] ?? '').trim()
}

export function getLlmConfig(): LlmConfig {
  return { model: env('VITE_LLM_MODEL') }
}

/** 是否已配置（客户端视角：仅需模型名） */
export function isLlmConfigured(): boolean {
  return getLlmConfig().model.length > 0
}

/**
 * 调用 LLM。始终走同源 `/api/llm/chat/completions`（由 Vite 代理 / 后端转发）。
 *
 * 注意：未设超时（按需等待慢响应）。若上游长时间不返回，界面会停在"生成中…"，
 * 需刷新页面。建议先用 curl 确认端点会正常返回。
 */
export async function callLlm(options: CallLlmOptions): Promise<LlmRawResponse> {
  const { model } = getLlmConfig()
  const endpoint = '/api/llm/chat/completions'

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? model,
        messages: options.messages,
        response_format: { type: 'json_object' },
      }),
    })
  } catch {
    throw new Error('无法连接 LLM 代理（/api/llm）。请确认：dev 已启动、.env.local 配置了 LLM_BASE_URL，且 LLM_BASE_URL 可达。')
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 404) {
      throw new Error('LLM 代理未就绪（404）：未配置 LLM_BASE_URL，或代理路径不匹配。检查 .env.local 与 vite.config.ts。')
    }
    throw new Error(`LLM 请求失败（${response.status}）：${detail.slice(0, 300)}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('LLM 返回格式异常：缺少 choices[0].message.content')
  }
  return { content }
}
