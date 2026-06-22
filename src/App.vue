<script setup lang="ts">
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ResultPanel from '@/components/result/ResultPanel.vue'
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1 class="app-title">Three.js Editor</h1>
      <span class="app-subtitle">自然语言 → 3D 场景</span>
    </header>

    <main class="app-main">
      <ChatPanel class="app-chat" />
      <ResultPanel class="app-result" />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-header {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 0 20px;
  height: 52px;
  background: var(--color-panel);
  border-bottom: 1px solid var(--color-border);
}

.app-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.app-subtitle {
  font-size: 13px;
  color: var(--color-text-soft);
}

.app-main {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}

.app-chat {
  flex: 0 0 var(--split-left);
  min-width: 0;
}

.app-result {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
