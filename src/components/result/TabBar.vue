<script setup lang="ts">
import type { ResultTab } from '@/types'

defineProps<{ modelValue: ResultTab }>()
const emit = defineEmits<{ 'update:modelValue': [tab: ResultTab] }>()

interface TabItem {
  key: ResultTab
  label: string
}

const tabs: TabItem[] = [
  { key: 'preview', label: '3D 预览' },
  { key: 'html', label: 'HTML 代码' },
  { key: 'dsl', label: 'DSL' },
]
</script>

<template>
  <nav class="tab-bar">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      class="tab"
      :class="{ active: modelValue === tab.key }"
      @click="emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>

<style scoped>
.tab-bar {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
}

.tab {
  position: relative;
  padding: 12px 14px;
  font-size: 14px;
  color: var(--color-text-soft);
}

.tab:hover {
  color: var(--color-text);
}

.tab.active {
  color: var(--color-primary);
  font-weight: 600;
}

.tab.active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2px;
  background: var(--color-primary);
  border-radius: 2px;
}
</style>
