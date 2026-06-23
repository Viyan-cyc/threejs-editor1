<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'

defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ send: [content: string, images?: File[]] }>()

const text = ref('')
const images = ref<File[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

const MAX_IMAGES = 3
const MAX_BYTES = 5 * 1024 * 1024 // 5MB

function pickFiles(): void {
  fileInput.value?.click()
}

function addFiles(files: File[]): void {
  for (const f of files) {
    if (images.value.length >= MAX_IMAGES) break
    if (!f.type.startsWith('image/')) continue
    if (f.size > MAX_BYTES) {
      const name = f.name ? `「${f.name}」` : ''
      alert(`图片${name}超过 5MB，已跳过`)
      continue
    }
    images.value.push(f)
  }
}

function onFilesPicked(e: Event): void {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = '' // 重置，允许重复选同一文件
  addFiles(files)
}

/** 粘贴图片（Ctrl/Cmd+V）：剪贴板里的图片直接进预览，无需点 📎 */
function onPaste(e: ClipboardEvent): void {
  if (!e.clipboardData) return
  const files: File[] = []
  const items = e.clipboardData.items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length > 0) {
    e.preventDefault() // 阻止默认粘贴（避免把图片当乱码文本插入 textarea）
    addFiles(files)
  }
}

function removeImage(i: number): void {
  images.value.splice(i, 1)
}

// 预览 object URL：images 变化时 revoke 旧的、建新的
const previewUrls = ref<string[]>([])
watch(
  images,
  (next) => {
    previewUrls.value.forEach((u) => URL.revokeObjectURL(u))
    previewUrls.value = next.map((f) => URL.createObjectURL(f))
  },
  { deep: true },
)
onUnmounted(() => previewUrls.value.forEach((u) => URL.revokeObjectURL(u)))

function submit(): void {
  const value = text.value.trim()
  if (!value && images.value.length === 0) return
  emit('send', value, images.value.length > 0 ? [...images.value] : undefined)
  text.value = ''
  images.value = []
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
    <div v-if="images.length" class="image-previews">
      <div v-for="(url, i) in previewUrls" :key="i" class="image-preview">
        <img :src="url" alt="参考图" />
        <button class="remove-btn" :disabled="disabled" title="移除" @click="removeImage(i)">×</button>
      </div>
    </div>
    <div class="input-row">
      <button
        class="attach-btn"
        :disabled="disabled"
        title="添加参考图（最多 3 张，每张 ≤5MB）"
        @click="pickFiles"
      >📎</button>
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFilesPicked" />
      <textarea
        v-model="text"
        class="message-textarea"
        rows="2"
        :disabled="disabled"
        :placeholder="disabled ? '正在生成场景…' : '描述你想要的 3D 场景…（Enter 发送，Shift+Enter 换行，可粘贴/📎 附参考图）'"
        @keydown.enter="onEnter"
        @paste="onPaste"
      />
      <button class="send-btn" :disabled="(!text.trim() && images.length === 0) || disabled" @click="submit">
        {{ disabled ? '生成中…' : '发送' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.message-input {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  padding: var(--gap);
  border-top: 1px solid var(--color-border);
  background: var(--color-panel);
}

.image-previews {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.image-preview {
  position: relative;
  width: 56px;
  height: 56px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.remove-btn {
  position: absolute;
  top: 0;
  right: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border: 0;
  border-radius: 0 0 0 4px;
  cursor: pointer;
}

.input-row {
  display: flex;
  gap: var(--gap);
}

.attach-btn {
  flex: 0 0 auto;
  align-self: stretch;
  padding: 0 10px;
  font-size: 16px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
}

.attach-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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
