<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ send: [content: string] }>()

const text = ref('')

function submit(): void {
  const value = text.value.trim()
  if (!value) return
  emit('send', value)
  text.value = ''
}

/** Enter 发送，Shift+Enter 换行；输入法组合中不触发 */
function onEnter(event: KeyboardEvent): void {
  if (event.isComposing || event.shiftKey) return
  event.preventDefault()
  submit()
}
</script>

<template>
  <div class="message-input">
    <textarea
      v-model="text"
      class="message-textarea"
      rows="2"
      :disabled="disabled"
      :placeholder="disabled ? '正在生成场景…' : '描述你想要的 3D 场景…（Enter 发送，Shift+Enter 换行）'"
      @keydown.enter="onEnter"
    />
    <button class="send-btn" :disabled="!text.trim() || disabled" @click="submit">
      {{ disabled ? '生成中…' : '发送' }}
    </button>
  </div>
</template>

<style scoped>
.message-input {
  display: flex;
  gap: var(--gap);
  padding: var(--gap);
  border-top: 1px solid var(--color-border);
  background: var(--color-panel);
}

.message-textarea {
  flex: 1 1 auto;
  resize: none;
  padding: 8px 10px;
  font: inherit;
  line-height: 1.5;
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  outline: none;
}

.message-textarea:focus {
  border-color: var(--color-primary);
}

.send-btn {
  flex: 0 0 auto;
  align-self: stretch;
  padding: 0 18px;
  color: #fff;
  background: var(--color-primary);
  border-radius: var(--radius);
}

.send-btn:disabled {
  background: var(--color-primary-disabled);
  cursor: not-allowed;
}
</style>
