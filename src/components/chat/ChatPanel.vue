<script setup lang="ts">
import { ref } from 'vue'
import type { ChatMessage } from '@/types'
import { uid } from '@/utils/id'
import { createWelcomeMessage, initMockScene } from '@/mock/mockConversation'
import { handleLlmUserInput } from '@/llm/llmConversation'
import MessageList from './MessageList.vue'
import MessageInput from './MessageInput.vue'

const messages = ref<ChatMessage[]>([createWelcomeMessage()])
const isPending = ref(false)

// 首次进入也确保有空场景（与 App.vue 的 initMockScene 互为兜底，幂等）
initMockScene()

async function handleSend(content: string): Promise<void> {
  const trimmed = content.trim()
  if (!trimmed || isPending.value) return

  messages.value.push({
    id: uid('user'),
    role: 'user',
    content: trimmed,
    createdAt: Date.now(),
  })

  isPending.value = true
  try {
    // 真实 LLM 编排（异步）：组装请求 → 调用 → 解析校验 → 沙箱运行 → 联动更新
    const assistant = await handleLlmUserInput(trimmed, messages.value)
    messages.value.push(assistant)
  } finally {
    isPending.value = false
  }
}
</script>

<template>
  <section class="chat-panel">
    <MessageList class="chat-list" :messages="messages" />
    <div v-if="isPending" class="pending-hint">正在调用 LLM 生成场景…（生成较慢，请稍候；若长时间无响应可刷新页面）</div>
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

.pending-hint {
  flex: 0 0 auto;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--color-text-soft);
  background: var(--color-assistant-bg);
  border-top: 1px solid var(--color-border);
}

.chat-input {
  flex: 0 0 auto;
}
</style>

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
</style>
