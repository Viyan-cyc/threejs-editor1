<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { ChatMessage } from '@/types'
import { uid } from '@/utils/id'
import { formatDuration } from '@/utils/duration'
import { createWelcomeMessage, initMockScene } from '@/mock/mockConversation'
import { handleLlmUserInput, type LlmProgressEvent } from '@/llm/llmConversation'
import MessageList from './MessageList.vue'
import MessageInput from './MessageInput.vue'

const messages = ref<ChatMessage[]>([createWelcomeMessage()])
const isPending = ref(false)

// ===== 生成中：计时器 + 思考链状态 =====
const elapsedSec = ref(0)
const reasoning = ref('')
const stages = ref<Array<{ label: string; status: 'active' | 'done' }>>([])
const reasoningEl = ref<HTMLElement | null>(null)

let timerId: ReturnType<typeof setInterval> | null = null
let startTime = 0

// 首次进入也确保有空场景（与 App.vue 的 initMockScene 互为兜底，幂等）
initMockScene()

/** 1s 1s 叠加：< 60s → 12s；≥ 60s → 1min3s / 2min0s（与最终徽章共用 formatDuration） */
const elapsedLabel = computed(() => formatDuration(elapsedSec.value * 1000))

function startTimer(): void {
  startTime = Date.now()
  elapsedSec.value = 0
  if (timerId) clearInterval(timerId)
  timerId = setInterval(() => {
    elapsedSec.value = Math.floor((Date.now() - startTime) / 1000)
  }, 1000)
}

function stopTimer(): void {
  if (timerId) {
    clearInterval(timerId)
    timerId = null
  }
}

// 推理流自动滚动到底部
watch(reasoning, async () => {
  await nextTick()
  const el = reasoningEl.value
  if (el) el.scrollTop = el.scrollHeight
})

function onProgress(ev: LlmProgressEvent): void {
  if (ev.reasoningDelta) reasoning.value += ev.reasoningDelta
  const last = stages.value[stages.value.length - 1]
  if (!last || last.label !== ev.label) {
    if (last) last.status = 'done'
    stages.value.push({ label: ev.label, status: 'active' })
  }
}

onUnmounted(stopTimer)

async function handleSend(content: string): Promise<void> {
  const trimmed = content.trim()
  if (!trimmed || isPending.value) return

  messages.value.push({
    id: uid('user'),
    role: 'user',
    content: trimmed,
    createdAt: Date.now(),
  })

  // 重置生成态并启动计时
  reasoning.value = ''
  stages.value = []
  isPending.value = true
  startTimer()
  const t0 = Date.now()
  try {
    // 真实 LLM 编排（异步）：组装请求 → 调用 → 解析校验 → 沙箱运行 → 联动更新
    const assistant = await handleLlmUserInput(trimmed, messages.value, onProgress)
    // 记录本轮总耗时（ms），随消息持久保留，供左栏底部徽章展示
    assistant.generationMs = Date.now() - t0
    messages.value.push(assistant)
  } finally {
    const last = stages.value[stages.value.length - 1]
    if (last) last.status = 'done'
    stopTimer()
    isPending.value = false
  }
}
</script>

<template>
  <section class="chat-panel">
    <MessageList class="chat-list" :messages="messages" />

    <div v-if="isPending" class="gen-panel">
      <div class="gen-header">
        <span class="gen-spinner" />
        <span class="gen-title">思考中</span>
        <span class="gen-timer">{{ elapsedLabel }}</span>
      </div>

      <div v-if="reasoning" ref="reasoningEl" class="gen-reasoning">{{ reasoning }}</div>
      <div v-else class="gen-reasoning gen-reasoning--idle">等待模型输出思考链…</div>

      <ul v-if="stages.length" class="gen-stages">
        <li
          v-for="(s, i) in stages"
          :key="i"
          class="stage"
          :class="`stage--${s.status}`"
        >
          <span class="stage-mark">{{ s.status === 'done' ? '✓' : '•' }}</span>
          <span class="stage-label">{{ s.label }}</span>
        </li>
      </ul>
    </div>

    <MessageInput class="chat-input" :disabled="isPending" @send="handleSend" />
  </section>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-panel);
  border-right: 1px solid var(--color-border);
}

.chat-list {
  flex: 1 1 auto;
  min-height: 0;
}

.chat-input {
  flex: 0 0 auto;
}

/* ===== 生成中面板：计时器 + 思考链 + 阶段 ===== */
.gen-panel {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--color-assistant-bg);
  border-top: 1px solid var(--color-border);
}

.gen-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-soft);
}

.gen-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-text-soft);
  animation: gen-spin 0.8s linear infinite;
}

@keyframes gen-spin {
  to {
    transform: rotate(360deg);
  }
}

.gen-title {
  font-weight: 600;
}

.gen-timer {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--color-text);
}

/* 思考链：等宽、可滚动、增量刷新 */
.gen-reasoning {
  max-height: 160px;
  overflow-y: auto;
  padding: 8px 10px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text-soft);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 4px;
}

.gen-reasoning--idle {
  font-style: italic;
  opacity: 0.7;
}

.gen-stages {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  line-height: 1.5;
}

.stage {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-soft);
}

.stage-mark {
  display: inline-flex;
  width: 14px;
  justify-content: center;
}

.stage--done {
  color: var(--color-text-soft);
  opacity: 0.7;
}

.stage--done .stage-mark {
  color: #2e8b57;
}

.stage--active {
  color: var(--color-text);
  font-weight: 600;
}

.stage--active .stage-mark {
  color: var(--color-text);
  animation: gen-blink 1s steps(2, start) infinite;
}

@keyframes gen-blink {
  50% {
    opacity: 0.3;
  }
}
</style>
