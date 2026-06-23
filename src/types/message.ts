/** 消息角色 */
export type MessageRole = 'user' | 'assistant'

/** 用户输入的消息 */
export interface UserMessage {
  /** 全局唯一 id */
  id: string
  role: 'user'
  /** 用户输入的自然语言内容 */
  content: string
  /** 用户上传的参考图（data URL 数组，仅用于 UI 历史展示；不回灌模型） */
  images?: string[]
  /** 创建时间戳（ms） */
  createdAt: number
}

/**
 * 系统返回的消息（与 docs/05 LLM 接入协议对齐）。
 *
 * 注意：不包含、也不展示原始 chain-of-thought。
 * 字段为可读结构化内容 + 可选告警/错误。
 */
export interface AssistantMessage {
  id: string
  role: 'assistant'
  /** 给用户看的自然语言回复 */
  responseText: string
  /** 思考摘要（精简，非完整推理堆） */
  reasoningSummary: string
  /** 执行计划 */
  plan: string
  /** 本轮修改摘要（按 id 描述增/改/删/移） */
  modificationSummary: string
  /** 风险/警告（如 DSL 提取告警、前置条件、降级说明） */
  warnings?: string[]
  /** 运行/修改失败提示（出现时表示未应用、已保留上一版） */
  error?: string
  /** 本轮生成总耗时（ms，含调用/校验/沙箱运行/自修复）；用于持久展示"思考总时长" */
  generationMs?: number
  createdAt: number
}

/** 对话消息：判别联合，按 role 区分用户消息与系统消息 */
export type ChatMessage = UserMessage | AssistantMessage
