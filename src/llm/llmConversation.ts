import type { AssistantMessage, ChatMessage } from '@/types'
import type { ChatMessage as LlmChatMessage } from '@/types/llm'
import { uid } from '@/utils/id'
import { callLlmStream, getLlmConfig, isLlmConfigured, callVisionModel } from '@/llm/config'
import {
  buildDeveloperMessage,
  buildSystemMessage,
  buildUserMessage,
} from '@/llm/prompts'
import { parseAndValidate } from '@/llm/validate'
import { generateHunyuanModels } from '@/llm/hunyuanGenerate'
import { getComponentSummary } from '@/scene-components/registry'
import { currentExtractedDSL, currentSceneCode, runSceneCode } from '@/state/sceneStore'

/**
 * 真实 LLM 对话编排（Code-first，docs/05 协议）。
 *
 * 流程：组装三层消息 → callLlm → 解析校验（含丢 nextDSL + 静态检查）
 * → runSceneCode（沙箱执行 + 提取 DSL + 提交/回滚）→ 产出 AssistantMessage。
 *
 * - 运行成功：联动更新 currentSceneCode/currentExtractedDSL/预览/DSL。
 * - 运行/校验失败：不更新场景，message.error 提示原因（保留上一版）。
 * - expectedObjects 与运行后 DSL 比对，差异记入 warnings（只读校验）。
 * - 无原始 chain-of-thought。
 */

/** 简单的对话历史摘要（最近 N 轮 modificationSummary） */
function summarizeHistory(history: ChatMessage[]): string {
  const assistants = history.filter((m) => m.role === 'assistant')
  const recent = assistants.slice(-3)
  if (recent.length === 0) return ''
  return recent
    .map((m, i) => `${i + 1}. ${(m as { modificationSummary?: string }).modificationSummary ?? ''}`)
    .join('\n')
}

/**
 * 生成进度事件（驱动左栏"思考中"面板）。
 * - stage/label：当前处理阶段（调用 LLM / 校验 / 沙箱运行 / 修复…）。
 * - reasoningDelta：模型思考链的增量文字（仅 stage='llm' 时多次出现），前端累加展示。
 */
export type LlmGenStage = 'llm' | 'validate' | 'vision' | 'generate' | 'sandbox' | 'repair'

export interface LlmProgressEvent {
  stage: LlmGenStage
  label: string
  reasoningDelta?: string
}

export type LlmProgressCb = (event: LlmProgressEvent) => void

function createMessage(partial: Omit<AssistantMessage, 'id' | 'role' | 'createdAt'>): AssistantMessage {
  return { id: uid('assistant'), role: 'assistant', createdAt: Date.now(), ...partial }
}

function infoMessage(
  responseText: string,
  reasoningSummary: string,
  plan: string,
  modificationSummary: string,
  extra: Pick<AssistantMessage, 'warnings' | 'error'> = {},
): AssistantMessage {
  return createMessage({ responseText, reasoningSummary, plan, modificationSummary, ...extra })
}

/** 错误回灌自修复的最大重试次数（含首次共调用 MAX_REPAIR+1 次 LLM） */
const MAX_REPAIR = 2

/** 构造"回灌错误 + 失败代码"的修复请求消息 */
function buildRepairUserMessage(failedCode: string, error: string, attempt: number): LlmChatMessage {
  return {
    role: 'user',
    content:
      `你上一轮返回的 sceneCode 在沙箱运行时报错（第 ${attempt} 次尝试）：\n` +
      `错误：${error}\n\n` +
      `常见原因：变量未声明、Three.js API 误用、括号/引号不匹配、引用了未定义的名字、组件未通过 ctx.components 调用、几何参数非法等。\n` +
      `请定位并修复该错误，返回【完整的、修正后的】 createScene(THREE, ctx) 代码。保持原有场景意图与对象 id。按输出协议返回严格 JSON。\n\n` +
      `出错的代码：\n"""\n${failedCode}\n"""`,
  }
}

export async function handleLlmUserInput(
  userInput: string,
  history: ChatMessage[],
  onProgress?: LlmProgressCb,
  images?: File[],
): Promise<AssistantMessage> {
  // 临时诊断：浏览器 Console 可见客户端实际读到的配置
  console.log('[llm] 发送时检测：isLlmConfigured =', isLlmConfigured(), '| model =', getLlmConfig().model)

  if (!isLlmConfigured()) {
    return infoMessage(
      '未配置 LLM：缺少 VITE_LLM_MODEL（客户端，.env.local 中须带 VITE_ 前缀）。另需 LLM_BASE_URL / LLM_API_KEY（不带 VITE_，供 vite 代理），配置后重启 dev。',
      '检测到未配置 LLM，按约定直接报错，不回退 mock。',
      '-',
      '无改动。',
      { error: 'LLM 未配置' },
    )
  }

  // 【视觉模型预处理】用户带了图片时，先用视觉模型把图转成文字描述，再喂给主模型。
  // 失败（未配置/余额不足/超时）→ 不阻塞，降级为纯文字继续走主模型。
  let imageDescription: string | undefined
  const visionWarnings: string[] = []
  if (images && images.length > 0) {
    onProgress?.({ stage: 'vision', label: `正在理解图片（${images.length} 张）…` })
    try {
      imageDescription = await callVisionModel(images)
    } catch (err) {
      visionWarnings.push(`图片理解失败：${err instanceof Error ? err.message : String(err)}，已按纯文字处理`)
    }
  }

  // 组装三层基础消息（每轮修复都基于它 + 一条修复消息）
  const baseMessages: LlmChatMessage[] = [
    buildSystemMessage(),
    buildDeveloperMessage({ components: getComponentSummary(), externalModels: [] }),
    buildUserMessage({
      userInput,
      imageDescription,
      currentSceneCode: currentSceneCode.value,
      currentExtractedDSL: currentExtractedDSL.value,
      conversationSummary: summarizeHistory(history),
    }),
  ]

  let lastError = ''
  let lastFailedCode = ''

  // 本轮混元模型缓存（key → ArrayBuffer）：同 key 只生成一次，自动修复轮复用，不重复调混元。
  // 注入用结构化克隆（非 Transferable），buffer 在主进程保留，可供多轮注入复用。
  const roundModels: Record<string, ArrayBuffer> = {}

  for (let attempt = 0; attempt <= MAX_REPAIR; attempt += 1) {
    const messages = attempt === 0
      ? baseMessages
      : [...baseMessages, buildRepairUserMessage(lastFailedCode, lastError, attempt)]

    // 1) 调用 LLM（流式：逐段上报推理增量 + 阶段）
    const llmStage: LlmProgressEvent =
      attempt === 0
        ? { stage: 'llm', label: '调用 LLM 生成中…' }
        : { stage: 'repair', label: `第 ${attempt} 次自动修复中…` }
    onProgress?.(llmStage)
    let rawContent: string
    try {
      const response = await callLlmStream({
        messages,
        onChunk: (chunk) => {
          if (chunk.reasoning) {
            onProgress?.({ ...llmStage, reasoningDelta: chunk.reasoning })
          }
        },
      })
      rawContent = response.content
    } catch (error) {
      return infoMessage(
        'LLM 调用失败。',
        '请求 LLM 接口时出错。',
        '-',
        '无改动。',
        { error: error instanceof Error ? error.message : String(error) },
      )
    }

    // 2) 解析 + 校验
    onProgress?.({ stage: 'validate', label: '校验返回…' })
    const validated = parseAndValidate(rawContent)
    if (!validated.ok) {
      console.log('[llm] 校验失败，原始返回（前 1000 字符）：\n', rawContent.slice(0, 1000))
      return infoMessage(
        'LLM 返回未通过校验，未运行代码（原始返回已打印到浏览器 Console，可查看）。',
        '解析或校验 LLM 返回失败。',
        '-',
        '无改动。',
        { error: validated.error },
      )
    }

    const { output, notes } = validated

    // 3) 追问优先：需求不明确时不应用 sceneCode（不进入修复循环）
    if (output.clarificationQuestion) {
      return infoMessage(
        `需要澄清：${output.clarificationQuestion}`,
        output.reasoningSummary,
        output.plan,
        '无改动（等待澄清）。',
        { warnings: notes.length ? notes : undefined },
      )
    }

    // 3b) 预生成混元模型（仅用户显式要求时 output.hunyuanRequests 非空）：
    //     只对「本轮尚未生成」的 key 调混元；已生成的复用 roundModels（修复轮不重复调混元）。
    //     失败的 key 不注入 → createScene 走几何兜底分支。
    const hunyuanRequests = output.hunyuanRequests ?? []
    const newRequests = hunyuanRequests.filter((r) => !(r.key in roundModels))
    if (newRequests.length > 0) {
      const gen = await generateHunyuanModels(newRequests, (label) => {
        onProgress?.({ stage: 'generate', label })
      })
      for (const key of Object.keys(gen.models)) roundModels[key] = gen.models[key]
      for (const f of gen.failures) notes.push(`混元生成失败（${f.key}）：${f.reason}，已用几何兜底`)
    }
    // 本轮注入：LLM 本次声明的 key 中，已成功生成的子集（复用 roundModels 缓存）
    const preloadedModels: Record<string, ArrayBuffer> = {}
    for (const r of hunyuanRequests) {
      if (r.key in roundModels) preloadedModels[r.key] = roundModels[r.key]
    }

    // 4) 沙箱运行 sceneCode（成功才提交，失败保留上一版画面）
    onProgress?.({ stage: 'sandbox', label: '沙箱运行并提取场景…' })
    const result = await runSceneCode(output.sceneCode, { models: preloadedModels })
    if (result.ok) {
      const warnings: string[] = [...notes, ...visionWarnings]
      if (attempt > 0) warnings.push(`已自动修复（第 ${attempt} 次重试后运行成功）`)
      if (output.warnings) warnings.push(...output.warnings)

      const expectedIds = output.expectedObjects
        .filter((o) => o.action !== 'delete')
        .map((o) => o.id)
      if (expectedIds.length > 0) {
        const actualIds = collectDslIds(currentExtractedDSL.value)
        const missing = expectedIds.filter((id) => !actualIds.has(id))
        if (missing.length > 0) {
          warnings.push(`expectedObjects 与提取结果不符（未出现）：${missing.join('、')}`)
        }
      }

      const responseText = attempt > 0
        ? `${output.responseText}\n（注：经第 ${attempt} 次自动修复后运行成功）`
        : output.responseText

      return infoMessage(
        responseText,
        output.reasoningSummary,
        output.plan,
        output.modificationSummary,
        { warnings: warnings.length > 0 ? warnings : undefined },
      )
    }

    // 5) 运行失败：记录错误与失败代码，进入下一轮修复
    console.log(`[llm] 第 ${attempt + 1} 次运行失败：${result.error}`)
    console.log('[llm] 失败的 sceneCode（前 2000 字符）：\n', output.sceneCode.slice(0, 2000))
    lastError = result.error
    lastFailedCode = output.sceneCode
  }

  // 6) 自修复仍失败：放弃，保留上一版
  console.log(`[llm] 已尝试 ${MAX_REPAIR} 次自修复仍失败，保留上一版`)
  return infoMessage(
    `运行 LLM 生成的场景代码失败，已尝试 ${MAX_REPAIR} 次自动修复仍未通过，保留上一版。（失败的 sceneCode 见浏览器 Console）`,
    '代码多次运行报错。',
    '-',
    `未应用：${lastError}`,
    { error: lastError },
  )
}

/** 收集 DSL 中所有对象 id（用于与 expectedObjects 比对） */
function collectDslIds(dsl: unknown): Set<string> {
  const ids = new Set<string>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (typeof obj.id === 'string') ids.add(obj.id)
    if (Array.isArray(obj.children)) obj.children.forEach(visit)
  }
  const dslObj = dsl as { objects?: unknown[] } | null
  if (dslObj && Array.isArray(dslObj.objects)) dslObj.objects.forEach(visit)
  return ids
}
