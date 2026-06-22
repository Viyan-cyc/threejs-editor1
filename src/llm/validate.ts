import type { LlmStructuredOutput, ValidateResult, ExpectedObject } from '@/types/llm'
import { checkSceneCode } from '@/sandbox/protocol'

/**
 * 解析 + 校验 LLM 返回（对齐 docs/05 §6）。
 *
 * 校验策略（务实）：
 * - 硬性必需：sceneCode（非空，没它无法运行）。
 * - 软性字段：responseText / reasoningSummary / plan / modificationSummary 缺失或为空时
 *   用兜底值放行（不因展示文本缺失而丢弃一次成功生成）。
 * - expectedObjects：缺失/非数组当 []；非法项忽略。
 * - 始终丢弃 nextDSL/dsl（绝不用于渲染）；sceneCode 静态检查（黑名单）。
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asOptionalString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

function asExpectedObjects(value: unknown, notes: string[]): ExpectedObject[] {
  if (!Array.isArray(value)) return []
  const valid: ExpectedObject[] = []
  for (const item of value) {
    if (!isObject(item)) continue
    const action = item.action
    if (action !== 'create' && action !== 'update' && action !== 'delete' && action !== 'move') continue
    if (typeof item.id !== 'string' || item.id.trim() === '') continue
    valid.push({
      id: item.id,
      name: typeof item.name === 'string' ? item.name : undefined,
      type: typeof item.type === 'string' ? item.type : undefined,
      action,
    })
  }
  if (valid.length === 0 && value.length > 0) {
    notes.push('expectedObjects 存在但无合法项，已忽略')
  }
  return valid
}

export function parseAndValidate(rawContent: string): ValidateResult {
  // 1) JSON 解析
  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    return { ok: false, error: 'LLM 返回非合法 JSON' }
  }
  if (!isObject(parsed)) {
    return { ok: false, error: 'LLM 返回非 JSON 对象' }
  }

  const notes: string[] = []

  // 2) 丢弃/拒绝"驱动型 DSL"字段（绝不用于渲染）
  if ('nextDSL' in parsed || 'dsl' in parsed) {
    notes.push('已忽略返回中的 nextDSL/dsl 字段（不作为渲染源）')
  }

  // 3) sceneCode 硬性必需
  if (typeof parsed.sceneCode !== 'string' || parsed.sceneCode.trim() === '') {
    return { ok: false, error: '字段 sceneCode 缺失或为空（无法运行）' }
  }

  const output: LlmStructuredOutput = {
    responseText: asOptionalString(parsed.responseText, '（模型未提供回复）'),
    reasoningSummary: asOptionalString(parsed.reasoningSummary, '（模型未提供思考摘要）'),
    plan: asOptionalString(parsed.plan, '（模型未提供执行计划）'),
    modificationSummary: asOptionalString(parsed.modificationSummary, '（模型未提供修改说明）'),
    sceneCode: parsed.sceneCode,
    expectedObjects: asExpectedObjects(parsed.expectedObjects, notes),
  }

  if (output.responseText === '（模型未提供回复）') notes.push('responseText 缺失，已用兜底')
  if (output.plan === '（模型未提供执行计划）') notes.push('plan 缺失，已用兜底')

  // 4) 可选字段
  if (typeof parsed.clarificationQuestion === 'string' && parsed.clarificationQuestion.trim()) {
    output.clarificationQuestion = parsed.clarificationQuestion.trim()
  }
  if (Array.isArray(parsed.warnings)) {
    output.warnings = parsed.warnings.filter((w): w is string => typeof w === 'string')
  }
  if (isObject(parsed.usedAssets)) {
    output.usedAssets = parsed.usedAssets as LlmStructuredOutput['usedAssets']
  }
  if (parsed.optionalExpectedDSL !== undefined) {
    output.optionalExpectedDSL = parsed.optionalExpectedDSL as LlmStructuredOutput['optionalExpectedDSL']
    notes.push('收到 optionalExpectedDSL（仅校验参考，不作为渲染源）')
  }

  // 5) sceneCode 静态检查（黑名单）
  const violations = checkSceneCode(output.sceneCode)
  if (violations.length > 0) {
    return { ok: false, error: `sceneCode 含禁用能力：${violations.join('、')}` }
  }

  return { ok: true, output, notes }
}
