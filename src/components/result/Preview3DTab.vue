<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getSandboxIframe } from '@/state/sceneStore'

/**
 * 3D 预览：托管 sandbox iframe。
 *
 * 因果：currentSceneCode → runSceneCode → sandbox iframe 执行 createScene → iframe 内渲染。
 * DSL 由 iframe 内"运行后"快照回传提取。本组件只负责把 iframe 元素挂到容器。
 */
const containerRef = ref<HTMLDivElement | null>(null)

onMounted(() => {
  if (!containerRef.value) return
  // 复用 sceneStore 的单例沙箱 iframe（重新挂载会移动元素，触发其 load/runtime-ready）
  containerRef.value.appendChild(getSandboxIframe())
})
</script>

<template>
  <div ref="containerRef" class="preview-3d" />
</template>

<style scoped>
.preview-3d {
  width: 100%;
  height: 100%;
}
</style>
