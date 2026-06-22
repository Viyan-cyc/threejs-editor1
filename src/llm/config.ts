import type { CallLlmOptions, LlmRawResponse } from '@/types/llm'

/**
 * 流式增量 chunk：
 * - reasoning：模型思考链增量（reasoning_content / reasoning / thinking），
 *   通常在 content 之前逐段输出；仅用于 UI 展示，不参与最终 JSON 解析。
 * - content：正文增量，拼起来即最终 JSON 字符串（用于 parseAndValidate）。
 */
export interface LlmStreamChunk {
  reasoning?: string
  content?: string
}

export interface LlmStreamOptions extends CallLlmOptions {
  /** 每收到一段增量时回调一次（reasoning / content 各自增量上报） */
  onChunk?: (chunk: LlmStreamChunk) => void
}

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

/**
 * 流式调用 LLM（stream: true），逐段回吐推理/正文增量。
 *
 * - 走同一同源 `/api/llm/chat/completions`；Vite 代理对 SSE 流是透传的。
 * - 兼容多种推理字段名：reasoning_content（GLM/DeepSeek）/ reasoning / thinking。
 * - 若上游不支持 streaming（content-type 非 event-stream），自动退化为一次性 JSON，
 *   保持与非流式 callLlm 同样的行为（仅没有实时增量）。
 */
export async function callLlmStream(options: LlmStreamOptions): Promise<LlmRawResponse> {
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
        stream: true,
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

  // 上游不支持 streaming 时会直接返回完整 JSON（非 SSE），退化为一次性解析
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('event-stream')) {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('LLM 返回格式异常：缺少 choices[0].message.content')
    }
    options.onChunk?.({ content })
    return { content }
  }

  if (!response.body) {
    throw new Error('LLM 返回无可读流')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let content = ''

  /** 从 delta 对象中取出推理增量（兼容多种字段名） */
  const extractReasoning = (delta: Record<string, unknown>): string | undefined => {
    for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
      const v = delta[key]
      if (typeof v === 'string' && v.length > 0) return v
    }
    return undefined
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE：按行解析 `data: {...}`；跨 chunk 的不完整行留在 buffer
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line === '' || line.startsWith(':')) continue // 空行 / 心跳注释
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: Record<string, unknown> }>
        }
        const delta = json.choices?.[0]?.delta
        if (delta && typeof delta === 'object') {
          const reasoning = extractReasoning(delta)
          if (reasoning) options.onChunk?.({ reasoning })
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            content += delta.content
            options.onChunk?.({ content: delta.content })
          }
        }
      } catch {
        // 偶发半行 JSON：忽略，由下一次 read 拼接后重试
      }
    }
  }

  if (content.length === 0) {
    throw new Error('LLM 返回格式异常：未收到任何 content 增量')
  }
  return { content }
}
