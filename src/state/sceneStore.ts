import { ref } from 'vue'
import type { DslSnapshot } from '@/types'
import { extractDslFromSnapshot } from '@/dsl/extractor'
import { checkSceneCode } from '@/sandbox/protocol'
import { SceneSandboxHost } from '@/sandbox/SceneSandboxHost'
import { findUnknownComponentReferences } from '@/scene-components/registry'

/**
 * Code-first 执行引擎（sceneStore）—— 沙箱版。
 *
 * 因果方向（不可逆）：
 *   currentSceneCode（源）→ sandbox iframe 执行 createScene → 运行后场景快照
 *     → 3D 预览（iframe 内渲染）
 *     → DSL（extractDslFromSnapshot，currentExtractedDSL）
 *
 * runSceneCode 管线：
 *   1) 静态检查（命中禁用能力 → 不执行，返回 error）
 *   2) 沙箱执行（iframe 内 new Function 跑 createScene，隔离由 sandbox 保证）
 *   3) 成功：提交 currentSceneCode + 提取 DSL（联动）；失败：**保留上一版**，返回 error。
 *
 * DSL 是衍生数据，只读、不回流；本引擎无 buildSceneFromDsl。
 */

export type SceneStatus = 'idle' | 'running' | 'ready' | 'error'
export type ApplyResult = { ok: true } | { ok: false; error: string }

// ===== 源数据（唯一真相）=====
export const currentSceneCode = ref<string>('')

// ===== 运行状态 / 错误 =====
export const sceneStatus = ref<SceneStatus>('idle')
export const currentError = ref<string>('')

// ===== 衍生数据：从运行后场景提取的 DSL（只读、不回流）=====
export const currentExtractedDSL = ref<DslSnapshot | null>(null)

// ===== 沙箱宿主（懒创建单例；iframe 元素由 Preview3DTab 挂载）=====
let host: SceneSandboxHost | null = null

function ensureHost(): SceneSandboxHost {
  if (!host) host = new SceneSandboxHost()
  return host
}

/** 供 Preview3DTab 挂载的 iframe 元素 */
export function getSandboxIframe(): HTMLIFrameElement {
  return ensureHost().el
}

/**
 * 执行一段 createScene 代码：静态检查 → 沙箱执行 → 提取 DSL → 提交（失败回滚）。
 *
 * opts.models：本轮预生成的混元 GLB（key → ArrayBuffer），run 前注入 iframe，
 * 供 createScene 内 ctx.getModel(key) 加载。无则空场景代码照常运行。
 */
export async function runSceneCode(
  code: string,
  opts?: { models?: Record<string, ArrayBuffer> },
): Promise<ApplyResult> {
  // 1) 静态检查
  const violations = checkSceneCode(code)
  if (violations.length > 0) {
    const error = `代码含禁用能力：${violations.join('、')}`
    sceneStatus.value = 'error'
    currentError.value = error
    return { ok: false, error }
  }

  // 1b) 组件引用预检：sceneCode 引用了未注册的组件 → 不运行、保留上一版
  const unknownComponents = findUnknownComponentReferences(code)
  if (unknownComponents.length > 0) {
    const error = `sceneCode 引用了未注册的组件：${unknownComponents.join('、')}`
    sceneStatus.value = 'error'
    currentError.value = error
    return { ok: false, error }
  }

  // 2) 沙箱执行（先注入 GLB，再 run）
  sceneStatus.value = 'running'
  currentError.value = ''
  const host = ensureHost()
  if (opts?.models && Object.keys(opts.models).length > 0) {
    await host.setModels(opts.models)
  }
  const result = await host.run(code)

  if (!result.ok) {
    sceneStatus.value = 'error'
    currentError.value = result.error
    return { ok: false, error: result.error }
  }

  // 3) 成功：提交源 + 衍生 DSL（联动）
  currentSceneCode.value = code
  currentExtractedDSL.value = extractDslFromSnapshot(result.snapshot)
  sceneStatus.value = 'ready'
  return { ok: true }
}
