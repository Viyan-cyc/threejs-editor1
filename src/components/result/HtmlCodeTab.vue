<script setup lang="ts">
import { computed } from 'vue'
import { currentSceneCode } from '@/state/sceneStore'
import { wrapAsStandaloneHtml } from '@/sandbox/standaloneHtml'

/**
 * HTML 代码页：把源数据 currentSceneCode（createScene 函数文本）
 * 包装为完整可独立运行的 HTML 后展示。
 */
const html = computed(() => wrapAsStandaloneHtml(currentSceneCode.value))
</script>

<template>
  <div class="code-tab">
    <pre class="code-block">{{ html }}</pre>
  </div>
</template>

<style scoped>
.code-tab {
  height: 100%;
  overflow: auto;
  background: #1f2329;
}

.code-block {
  padding: 16px;
  color: #e6e8eb;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre;
}
</style>
