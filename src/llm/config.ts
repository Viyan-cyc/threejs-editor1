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
  /** 主模型名（coding，非敏感，客户端可见） */
  model: string
  /** 视觉模型名（图生描述，非敏感）；未配置则 undefined */
  visionModel?: string
}

function env(key: string): string {
  const record = import.meta.env as unknown as Record<string, string | undefined>
  return (record[key] ?? '').trim()
}

export function getLlmConfig(): LlmConfig {
  const visionModel = env('VITE_LLM_VISION_MODEL')
  return { model: env('VITE_LLM_MODEL'), visionModel: visionModel || undefined }
}

/** 是否已配置（客户端视角：仅需模型名） */
export function isLlmConfigured(): boolean {
  return getLlmConfig().model.length > 0
}

/**
 * fetch 包装：对 429（限流，如智谱 1305「该模型当前访问量过大」）按指数退避自动重试。
 * 其他状态码原样返回由调用方处理；网络层错误抛出由调用方 catch。
 * 自动修复循环会在短时间连发多次主模型请求，易撞速率上限，重试可吸收大部分瞬时 429。
 */
async function fetchWithRetry(input: RequestInfo, init: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(input, init)
    if (resp.status !== 429 || attempt >= maxRetries) return resp
    const wait = 1500 * Math.pow(2, attempt) // 1.5s → 3s → 6s
    await new Promise((r) => setTimeout(r, wait))
  }
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
    response = await fetchWithRetry(endpoint, {
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
    response = await fetchWithRetry(endpoint, {
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

// ===================== 视觉模型（双模型：图 → 文字描述）=====================

/** 视觉提示词：让视觉模型输出便于主模型用 Three.js 重建的客观描述 */
const VISION_PROMPT =
  '你是 3D 场景重建助手。客观描述这张/这些图片，重点：有哪些物体、各自的位置与布局、颜色、材质、风格、大致尺寸关系，以便另一个 AI 据此用 Three.js 重建 3D 场景。只描述可见内容，不要臆测，不要复述本指令。'

/** File → base64 data URL（视觉模型 image_url 接受 data URI） */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取图片失败：${file.name}`))
    reader.readAsDataURL(file)
  })
}

/**
 * 调视觉模型把图片转成文字描述（双模型预处理）。
 *
 * 走同源 `/api/vision/chat/completions`（由 Vite 代理转发到 LLM_VISION_BASE_URL=paas/v4，
 * key 由代理服务端注入，不进浏览器）。非流式（描述作为一次性中间结果）。
 *
 * 失败抛错——由上层（llmConversation）捕获后降级为纯文字继续走主模型，不阻塞场景生成。
 */
export async function callVisionModel(images: File[]): Promise<string> {
  const { visionModel } = getLlmConfig()
  if (!visionModel) {
    throw new Error('未配置视觉模型（VITE_LLM_VISION_MODEL）')
  }
  if (images.length === 0) {
    throw new Error('无图片可解析')
  }

  const dataUrls = await Promise.all(images.map(fileToDataUrl))
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [
    { type: 'text', text: VISION_PROMPT },
    ...dataUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ]

  let response: Response
  try {
    response = await fetchWithRetry('/api/vision/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: visionModel,
        messages: [{ role: 'user', content }],
      }),
    })
  } catch {
    throw new Error('无法连接视觉模型代理（/api/vision）。请确认已配置 LLM_VISION_BASE_URL 且 dev 已重启。')
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const e = (await response.json()) as { error?: { message?: string }; message?: string }
      detail = e.error?.message ?? e.message ?? detail
    } catch {
      /* 响应非 JSON，保留 status */
    }
    throw new Error(`视觉模型调用失败：${detail}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const desc = data.choices?.[0]?.message?.content
  if (typeof desc !== 'string' || desc.trim() === '') {
    throw new Error('视觉模型返回为空')
  }
  return desc.trim()
}
