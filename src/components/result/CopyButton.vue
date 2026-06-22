<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { copyText } from '@/utils/clipboard'

/**
 * 一键复制按钮：固定在所在定位容器右上角，点击复制 props.text 到剪贴板，
 * 成功后短暂显示"已复制"反馈（1.5s）。
 * 父容器需 position: relative。
 */
const props = defineProps<{ text: string }>()

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

async function onCopy(): Promise<void> {
  const ok = await copyText(props.text)
  if (!ok) return
  copied.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    copied.value = false
  }, 1500)
}

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <button class="copy-btn" :class="{ 'is-copied': copied }" @click="onCopy">
    {{ copied ? '已复制' : '复制' }}
  </button>
</template>

<style scoped>
.copy-btn {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 5;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: #e6e8eb;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}

.copy-btn:active {
  transform: translateY(1px);
}

.copy-btn.is-copied {
  color: #6ee7a8;
  background: rgba(110, 231, 168, 0.12);
  border-color: rgba(110, 231, 168, 0.5);
}
</style>
