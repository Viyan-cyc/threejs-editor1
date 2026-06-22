import type { AssistantMessage, ChatMessage } from '@/types'
import type { ChatMessage as LlmChatMessage } from '@/types/llm'
import { uid } from '@/utils/id'
import { callLlm, getLlmConfig, isLlmConfigured } from '@/llm/config'
import {
  buildDeveloperMessage,
  buildSystemMessage,
  buildUserMessage,
} from '@/llm/prompts'
import { parseAndValidate } from '@/llm/validate'
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

export async function handleLlmUserInput(
  userInput: string,
  history: ChatMessage[],
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

  // 组装三层消息
  const messages: LlmChatMessage[] = [
    buildSystemMessage(),
    buildDeveloperMessage({ components: [], externalModels: [] }),
    buildUserMessage({
      userInput,
      currentSceneCode: currentSceneCode.value,
      currentExtractedDSL: currentExtractedDSL.value,
      conversationSummary: summarizeHistory(history),
    }),
  ]

  // 调用 LLM
  let rawContent: string
  try {
    const response = await callLlm({ messages })
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

  // 解析 + 校验
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

  // 追问优先：需求不明确时不应用 sceneCode
  if (output.clarificationQuestion) {
    return infoMessage(
      `需要澄清：${output.clarificationQuestion}`,
      output.reasoningSummary,
      output.plan,
      '无改动（等待澄清）。',
      { warnings: notes.length ? notes : undefined },
    )
  }

  // 沙箱运行 sceneCode（成功才提交，失败保留上一版）
  const result = await runSceneCode(output.sceneCode)
  if (!result.ok) {
    return infoMessage(
      '运行 LLM 生成的场景代码失败，已保留上一版。',
      output.reasoningSummary,
      output.plan,
      `未应用：${result.error}`,
      { error: result.error, warnings: output.warnings },
    )
  }

  // 运行成功：expectedObjects 与实际 DSL 比对（只读校验）
  const warnings: string[] = [...notes]
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

  return infoMessage(
    output.responseText,
    output.reasoningSummary,
    output.plan,
    output.modificationSummary,
    { warnings: warnings.length > 0 ? warnings : undefined },
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
