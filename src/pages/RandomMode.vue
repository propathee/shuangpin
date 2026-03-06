<script setup lang="ts">
import SingleMode from '../components/SingleMode.vue';
import { hanziList } from '../utils/hanzi'
import {
  buildWrongWeights,
  createReinforcementGenerator,
  getSlowCharWeights,
  normalizeDuration,
  type CharTiming,
} from '../utils/reinforcement'
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

function defaultNextChar() {
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
const panelTop = ref<number>(30)

// 每个字的耗时追踪
let charStartTime: number | null = null
const charTimings = ref<CharTiming[]>([])

// 动态 nextChar 与 key（用于强化训练模式切换）
const activeNextChar = ref<() => string>(defaultNextChar)
const singleModeKey = ref(0)

const canReinforce = computed(() =>
  mistakes.value.length > 0 || charTimings.value.length > 0
)

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function repositionPanel() {
  const keyboardEl = document.getElementById('keyboard')
  const panelEl = panelRef.value
  if (!keyboardEl || !panelEl) return

  const kbRect = keyboardEl.getBoundingClientRect()
  const panelRect = panelEl.getBoundingClientRect()

  const targetCenterY = kbRect.top + kbRect.height / 2
  const desiredTop = targetCenterY - panelRect.height / 2

  const padding = 30
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
  } else {
    const now = performance.now()
    const duration = normalizeDuration(charStartTime, now)
    if (duration !== null) {
      charTimings.value.push({
        hanzi: payload.hanzi,
        pinyin: payload.pinyin,
        duration,
      })
    }
  }
}

function onCharReady() {
  charStartTime = performance.now()
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

// ── 强化训练 ──

function createReinforcementNextChar(
  wrongWeights: Map<string, number>,
  slowWeights: Map<string, number>
): () => string {
  const nextChar = createReinforcementGenerator({ wrongWeights, slowWeights })

  return () => {
    return nextChar() ?? defaultNextChar()
  }
}

function startReinforcement() {
  const wrongWeights = buildWrongWeights(mistakes.value.map((m: MistakeItem) => m.hanzi))
  const slowWeights = getSlowCharWeights(charTimings.value, new Set(wrongWeights.keys()))

  activeNextChar.value = createReinforcementNextChar(wrongWeights, slowWeights)
  showMistakes.value = false
  mistakes.value = []
  charTimings.value = []
  charStartTime = null
  singleModeKey.value++
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
    <single-mode
      :key="singleModeKey"
      :next-char="activeNextChar"
      @char-ready="onCharReady"
      @full-input="onFullInput"
    />

    <div class="mistake-toggle">
      <a href="javascript:void(0)" @click="toggleMistakes">
        {{ showMistakes ? '隐藏错字' : '查看错字' }}
      </a>
      <a v-if="showMistakes" href="javascript:void(0)" style="margin-left: 12px;" @click="clearMistakes">清空</a>
      <a
        v-if="showMistakes && canReinforce"
        href="javascript:void(0)"
        style="margin-left: 12px;"
        @click="startReinforcement"
      >强化训练</a>
      <span v-if="showMistakes && canReinforce" class="reinforce-hint">
        <span class="hint-icon">?</span>
        <span class="hint-text">针对本次练习中的错字和反应较慢的字，生成一组强化训练</span>
      </span>
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
  height: 100%;
}

.mistake-toggle {
  position: absolute;
  left: var(--app-padding);
  // 与 SingleMode.vue 中的 `.summary` 一致，保持水平对齐
  bottom: var(--app-padding);

  a {
    color: var(--primary-color);
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

.reinforce-hint {
  position: relative;
  margin-left: 6px;
  cursor: default;

  .hint-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 1px solid var(--gray-6);
    color: var(--gray-6);
    font-size: 9px;
    line-height: 1;
    vertical-align: text-top;
  }

  .hint-text {
    display: none;
    position: absolute;
    left: calc(100% + 6px);
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;
    font-size: 12px;
    color: var(--gray-6);
    background: var(--white);
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid var(--gray-010);
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }

  &:hover .hint-text {
    display: block;
  }
}
</style>
