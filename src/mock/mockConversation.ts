import type { AssistantMessage } from '@/types'
import { uid } from '@/utils/id'
import { runSceneCode } from '@/state/sceneStore'
import { buildCreateSceneCode, describeMockScene, initialState } from '@/mock/mockSceneBuilders'
import { isLlmConfigured } from '@/llm/config'

/**
 * 初始化与欢迎消息（mock 初始空场景 + LLM 感知的欢迎语）。
 *
 * 第 11 阶段：对话处理已切到真实 LLM（src/llm/llmConversation.ts）。
 * 本文件仅保留：初始化空场景 + 欢迎消息。不再包含 mock 指令处理。
 */

export function createWelcomeMessage(): AssistantMessage {
  const configured = isLlmConfigured()
  return {
    id: uid('assistant'),
    role: 'assistant',
    createdAt: Date.now(),
    responseText: configured
      ? '你好！已接入 LLM（Code-first）。描述你想要的 3D 场景，我会生成 Three.js 代码并在沙箱中预览，右侧 HTML / 3D 预览 / DSL 三页签联动更新。'
      : '你好！当前未配置 LLM：需要 VITE_LLM_MODEL（客户端，带 VITE_ 前缀）+ LLM_BASE_URL / LLM_API_KEY（不带 VITE_，供 vite 代理）。配置后重启 dev 即可对话生成场景；当前发送指令会提示"LLM 未配置"。',
    reasoningSummary: '初始化对话。',
    plan: '等待用户输入。',
    modificationSummary: '无改动。',
  }
}

/** 初始化空场景（仅网格 + 灯光 + 相机），驱动右侧三页签 */
export function initMockScene(): void {
  const code = buildCreateSceneCode(describeMockScene(initialState))
  void runSceneCode(code)
}
