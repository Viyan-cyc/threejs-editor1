<script setup lang="ts">
import { ref } from 'vue'
import type { ResultTab } from '@/types'
import TabBar from './TabBar.vue'
import Preview3DTab from './Preview3DTab.vue'
import HtmlCodeTab from './HtmlCodeTab.vue'
import DslTab from './DslTab.vue'

const activeTab = ref<ResultTab>('preview')
</script>

<template>
  <section class="result-panel">
    <TabBar v-model="activeTab" />

    <div class="result-content">
      <!-- 用 v-show 保持 3D 场景常驻，避免反复销毁重建 -->
      <Preview3DTab v-show="activeTab === 'preview'" />
      <HtmlCodeTab v-show="activeTab === 'html'" />
      <DslTab v-show="activeTab === 'dsl'" />
    </div>
  </section>
</template>

<style scoped>
.result-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-panel);
}

.result-content {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
