<script setup lang="ts">
import { computed } from 'vue'
import { currentSceneCode } from '@/state/sceneStore'
import { wrapAsStandaloneHtml } from '@/sandbox/standaloneHtml'
import CopyButton from './CopyButton.vue'

/**
 * HTML 代码页：把源数据 currentSceneCode（createScene 函数文本）
 * 包装为完整可独立运行的 HTML 后展示。右上角提供一键复制。
 */
const html = computed(() => wrapAsStandaloneHtml(currentSceneCode.value))
</script>

<template>
  <div class="code-tab">
    <CopyButton :text="html" />
    <pre class="code-block">{{ html }}</pre>
  </div>
</template>

<style scoped>
.code-tab {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: #1f2329;
}

.code-block {
  height: 100%;
  margin: 0;
  padding: 16px;
  overflow: auto;
  color: #e6e8eb;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre;
}
</style>
