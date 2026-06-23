<script setup lang="ts">
import type { ChatMessage } from '@/types'
import { formatDuration } from '@/utils/duration'

defineProps<{ message: ChatMessage }>()
</script>

<template>
  <!-- 用户消息 -->
  <div v-if="message.role === 'user'" class="message message--user">
    <div v-if="message.images?.length" class="user-images">
      <img v-for="(src, i) in message.images" :key="i" :src="src" class="user-image" alt="参考图" />
    </div>
    <div v-if="message.content" class="bubble">{{ message.content }}</div>
  </div>

  <!-- 系统消息：responseText + 思考摘要/执行计划/修改说明 + 可选 warnings/error（不含原始思考） -->
  <article v-else class="message message--assistant">
    <p class="response">{{ message.responseText }}</p>

    <section class="block">
      <h4 class="block-title">思考摘要</h4>
      <p class="block-text">{{ message.reasoningSummary }}</p>
    </section>

    <section class="block">
      <h4 class="block-title">执行计划</h4>
      <pre class="block-pre">{{ message.plan }}</pre>
    </section>

    <section class="block">
      <h4 class="block-title">修改说明</h4>
      <p class="block-text">{{ message.modificationSummary }}</p>
    </section>

    <ul v-if="message.warnings?.length" class="alerts alerts--warn">
      <li v-for="(w, i) in message.warnings" :key="i">⚠ {{ w }}</li>
    </ul>

    <div v-if="message.error" class="alerts alerts--error">
      ✕ 运行失败：{{ message.error }}（已保留上一版场景）
    </div>

    <div v-if="message.generationMs != null" class="meta">
      ⏱ 思考总时长 {{ formatDuration(message.generationMs) }}
    </div>
  </article>
</template>

<style scoped>
.message--user {
  align-self: flex-end;
  max-width: 85%;
}

.user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  margin-bottom: 4px;
}

.user-image {
  width: 120px;
  height: 120px;
  object-fit: cover;
  border-radius: var(--radius);
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.bubble {
  padding: 8px 12px;
  background: var(--color-user-bubble);
  color: #fff;
  border-radius: var(--radius);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.message--assistant {
  align-self: stretch;
  background: var(--color-assistant-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.response {
  margin: 0;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.block-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-soft);
}

.block-text {
  margin: 0;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.block-pre {
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.alerts {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
  border-radius: var(--radius);
}

.alerts--warn {
  list-style: none;
  background: #fff7e6;
  color: #8a6d1b;
  border: 1px solid #ffe3a8;
}

.alerts--error {
  background: #fff1f0;
  color: #b3261e;
  border: 1px solid #ffccc7;
}

.meta {
  font-size: 12px;
  color: var(--color-text-soft);
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
}
</style>
