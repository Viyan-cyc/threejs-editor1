import type { DslSnapshot } from '@/types/scene'

/** 本轮期望的对象动作（与运行后 DSL 比对，仅校验） */
export interface ExpectedObject {
  id: string
  name?: string
  type?: string
  action: 'create' | 'update' | 'delete' | 'move'
}

/** 使用的资产 */
export interface UsedAssets {
  components?: Array<{ name: string; props?: Record<string, unknown> }>
  externalModels?: Array<{ name?: string; url: string; format?: string }>
}

/**
 * LLM 结构化输出（与 docs/05 协议对齐）。
 *
 * 铁律：sceneCode 是唯一动作产物；不存在 nextDSL/驱动型 DSL 字段；
 * optionalExpectedDSL 仅校验参考。reasoningSummary 为精简摘要，非原始 chain-of-thought。
 */
export interface LlmStructuredOutput {
  /** 给用户的自然语言回复 */
  responseText: string
  /** 思考摘要（精简，非完整推理堆） */
  reasoningSummary: string
  /** 执行计划 */
  plan: string
  /** 本轮修改摘要 */
  modificationSummary: string
  /** 新的完整 createScene(THREE, ctx) 代码 */
  sceneCode: string
  /** 本轮预计生成/修改的对象 */
  expectedObjects: ExpectedObject[]
  /** 使用了哪些组件 / 外部模型 */
  usedAssets?: UsedAssets
  /** 风险 / 无法满足 / 降级说明 */
  warnings?: string[]
  /** 需求不明确时的追问；非空时前端应追问、暂不应用 sceneCode */
  clarificationQuestion?: string
  /** 可选：期望提取出的 DSL（仅校验参考，不作渲染源） */
  optionalExpectedDSL?: DslSnapshot
}

/** 校验结果 */
export type ValidateResult =
  | { ok: true; output: LlmStructuredOutput; notes: string[] }
  | { ok: false; error: string }

/** 调用 LLM 的消息（OpenAI 兼容 chat/completions） */
export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant'
  content: string
}

export interface CallLlmOptions {
  messages: ChatMessage[]
  /** 可选：覆盖默认 model */
  model?: string
}

/** LLM 客户端返回的原始内容（已提取 message.content） */
export interface LlmRawResponse {
  content: string
}
