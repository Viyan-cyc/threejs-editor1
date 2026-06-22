<script setup lang="ts">
import type { ChatMessage } from '@/types'
import ChatMessageItem from './ChatMessageItem.vue'

defineProps<{ messages: ChatMessage[] }>()
</script>

<template>
  <div class="message-list">
    <ChatMessageItem v-for="message in messages" :key="message.id" :message="message" />
  </div>
</template>

<style scoped>
.message-list {
  height: 100%;
  overflow-y: auto;
  padding: var(--gap);
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}
</style>
