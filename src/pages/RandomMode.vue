<script setup lang="ts">
import SingleMode from '../components/SingleMode.vue';
import { hanziList } from '../utils/hanzi'
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

function nextChar() {
  const index = Math.floor(Math.random() * hanziList.hanzi.length)

  return hanziList.hanzi[index]
}

// 本次练习错字记录（仅会话内，切换页面不保留）
interface MistakeItem {
  hanzi: string
  pinyin: string
  leadKey?: string
  followKey?: string
  resolvedLead: string
  resolvedFollow: string
  correctLeadKey?: string
  correctFollowKey?: string
  timestamp: number
}

const showMistakes = ref(false)
const mistakes = ref<MistakeItem[]>([])
const panelRef = ref<HTMLDivElement | null>(null)
const panelTop = ref<number>(30) // 垂直位置（px），默认与 --app-padding 一致

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function repositionPanel() {
  // 目标：使表格在竖直方向与键盘高度大致居中（与键盘中线平齐）
  const keyboardEl = document.getElementById('keyboard')
  const panelEl = panelRef.value
  if (!keyboardEl || !panelEl) return

  const kbRect = keyboardEl.getBoundingClientRect()
  const panelRect = panelEl.getBoundingClientRect()

  // 以键盘垂直中线为基准，将表格垂直居中到该位置
  const targetCenterY = kbRect.top + kbRect.height / 2
  const desiredTop = targetCenterY - panelRect.height / 2

  const padding = 30 // 与 --app-padding 对齐
  const viewportH = window.innerHeight
  const maxTop = viewportH - padding - panelRect.height
  panelTop.value = clamp(desiredTop, padding, Math.max(padding, maxTop))
}

function onResize() {
  if (showMistakes.value) repositionPanel()
}

function onFullInput(payload: {
  hanzi: string
  pinyin: string
  leadKey?: string
  followKey?: string
  valid: boolean
  resolvedLead: string
  resolvedFollow: string
  correctLeadKey?: string
  correctFollowKey?: string
}) {
  // 仅记录错误输入，按时间顺序追加
  if (!payload.valid) {
    mistakes.value.push({
      hanzi: payload.hanzi,
      pinyin: payload.pinyin,
      leadKey: payload.leadKey,
      followKey: payload.followKey,
      resolvedLead: payload.resolvedLead,
      resolvedFollow: payload.resolvedFollow,
      correctLeadKey: payload.correctLeadKey,
      correctFollowKey: payload.correctFollowKey,
      timestamp: Date.now(),
    })
  }
}

function toggleMistakes() {
  showMistakes.value = !showMistakes.value
  if (showMistakes.value) {
    nextTick().then(repositionPanel)
  }
}

function clearMistakes() {
  mistakes.value = []
}

onMounted(() => {
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})

watch(showMistakes, (v: boolean) => {
  if (v) nextTick().then(repositionPanel)
})
</script>

<template>
  <div class="random-mode">
    <single-mode :next-char="nextChar" @full-input="onFullInput" />

    <div class="mistake-toggle">
      <a href="javascript:void(0)" @click="toggleMistakes">
        {{ showMistakes ? '隐藏错字' : '查看错字' }}
      </a>
      <a href="javascript:void(0)" style="margin-left: 12px;" @click="clearMistakes">清空</a>
    </div>

    <div v-if="showMistakes" ref="panelRef" class="mistake-panel" :style="{ top: panelTop + 'px' }">
      <div class="mistake-header">
        <div class="col hanzi">错字</div>
        <div class="col pinyin">拼音</div>
        <div class="col keys">按键</div>
      </div>
      <div class="mistake-list">
        <div v-for="(m, i) in mistakes" :key="i" class="mistake-row">
          <div class="col hanzi">{{ m.hanzi }}</div>
          <div class="col pinyin">{{ m.pinyin }}</div>
          <div class="col keys">
            实际：{{ (m.leadKey ?? '') + (m.followKey ?? '') }}
            <span class="sep">/</span>
            正确：{{ (m.correctLeadKey ?? '') + (m.correctFollowKey ?? '') }}
          </div>
        </div>
        <div v-if="mistakes.length === 0" class="empty">本次暂无错误</div>
      </div>
    </div>
  </div>
</template>

<style lang="less">
@import "../styles/var.less";
@import "../styles/color.less";

.random-mode {
  position: relative;
  height: 100%;
}

.mistake-toggle {
  position: absolute;
  left: var(--app-padding);
  bottom: var(--app-padding);

  a {
    color: var(--link-color, #1677ff);
    cursor: pointer;
    text-decoration: none;
    font-weight: bold;
  }
}

.mistake-panel {
  // 置于顶层并居中显示
  position: fixed;
  z-index: 1000;
  left: 50%;
  transform: translateX(-50%);

  // 更宽，避免第三列被截断
  width: 560px;
  max-width: calc(100% - 2 * var(--app-padding));
  max-height: calc(100% - 2 * var(--app-padding));

  // 与整体风格一致：实色背景，轻边框
  border: 1px solid var(--gray-010);
  border-radius: 8px;
  background: var(--white);
  box-shadow: 0 6px 24px rgba(0,0,0,0.08);

  display: flex;
  flex-direction: column;

  @media (max-width: 576px) {
    width: calc(100% - 2 * var(--app-padding));
  }
}

.mistake-header {
  display: flex;
  padding: 8px 12px;
  font-weight: bold;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.mistake-list {
  overflow-y: auto;
  padding: 8px 0;
}

.mistake-row {
  display: flex;
  padding: 6px 12px;
  align-items: center;
  border-bottom: 1px dashed rgba(0,0,0,0.06);

  &:last-child {
    border-bottom: none;
  }
}

.col {
  &.hanzi { width: 56px; }
  &.pinyin { width: 110px; color: var(--gray-6); }
  // 让按键列可换行，保证内容完整展示，同时避免过多留白
  &.keys { flex: 1; white-space: normal; overflow-wrap: anywhere; }
}

.empty {
  color: #999;
  text-align: center;
  padding: 24px 0;
}

.sep { margin: 0 6px; color: #ccc; }
</style>