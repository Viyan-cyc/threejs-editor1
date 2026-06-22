<script setup lang="ts">
import { computed } from 'vue'
import { currentExtractedDSL } from '@/state/sceneStore'

/**
 * DSL 页：展示从运行后场景提取的衍生数据 currentExtractedDSL。
 * 只读，不反向控制场景（Code-first）。
 * 若提取存在告警，顶部展示一行提示。
 */
const json = computed(() =>
  currentExtractedDSL.value ? JSON.stringify(currentExtractedDSL.value, null, 2) : '',
)

const warningCount = computed(() => currentExtractedDSL.value?.warnings?.length ?? 0)
</script>

<template>
  <div class="dsl-tab">
    <div v-if="warningCount > 0" class="warning-bar">
      ⚠ 提取到 {{ warningCount }} 个告警（缺 id / 缺 type / 未识别几何或材质等），详见 JSON 中各节点 warnings。
    </div>
    <pre v-if="json" class="code-block">{{ json }}</pre>
    <pre v-else class="code-block code-block--empty">（尚未提取 DSL）</pre>
  </div>
</template>

<style scoped>
.dsl-tab {
  height: 100%;
  overflow: auto;
  background: #1f2329;
}

.warning-bar {
  position: sticky;
  top: 0;
  padding: 8px 16px;
  background: #3a2e16;
  color: #ffd591;
  font-size: 13px;
  line-height: 1.5;
  border-bottom: 1px solid #5a4519;
}

.code-block {
  padding: 16px;
  color: #e6e8eb;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre;
}

.code-block--empty {
  color: #8a8f96;
}
</style>
