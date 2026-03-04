<script setup lang="ts">
import SingleMode from '../components/SingleMode.vue';
import { hanziList } from '../utils/hanzi'
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

interface CharTiming {
  hanzi: string
  pinyin: string
  duration: number
}

const showMistakes = ref(false)
const mistakes = ref<MistakeItem[]>([])
const panelRef = ref<HTMLDivElement | null>(null)
const panelTop = ref<number>(30)

// 每个字的耗时追踪
let charStartTime = performance.now()
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
    charTimings.value.push({
      hanzi: payload.hanzi,
      pinyin: payload.pinyin,
      duration: now - charStartTime,
    })
    charStartTime = now
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

// ── 强化训练 ──

function getSlowChars(wrongSet: Set<string>): string[] {
  const nonWrongTimings = charTimings.value.filter((t: CharTiming) => !wrongSet.has(t.hanzi))
  if (nonWrongTimings.length === 0) return []
  const sorted = [...nonWrongTimings].sort((a, b) => b.duration - a.duration)
  const cutoff = Math.max(1, Math.ceil(sorted.length * 0.2))
  return Array.from(new Set<string>(sorted.slice(0, cutoff).map((t: CharTiming) => t.hanzi)))
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function spreadEvenly(chars: string[], count: number): string[] {
  if (chars.length === 0 || count <= 0) return []
  const result: string[] = []
  for (let i = 0; i < count; i++) {
    result.push(chars[i % chars.length])
  }
  return result
}

function arrangeNoAdjacent(arr: string[]): string[] {
  const counts = new Map<string, number>()
  for (const ch of arr) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }

  const result: string[] = []
  let last = ''
  while (result.length < arr.length) {
    const entries = Array.from(counts.entries()).filter(([, n]) => n > 0)
    if (entries.length === 0) break

    const allowed = entries.filter(([ch]) => ch !== last)
    const candidatePool = allowed.length > 0 ? allowed : entries
    const maxCount = Math.max(...candidatePool.map(([, n]) => n))
    const topCandidates = candidatePool.filter(([, n]) => n === maxCount)
    const [picked] = topCandidates[Math.floor(Math.random() * topCandidates.length)]

    result.push(picked)
    counts.set(picked, (counts.get(picked) ?? 1) - 1)
    last = picked
  }

  return result
}

function createReinforcementNextChar(
  wrongChars: string[],
  slowChars: string[],
  recentChars: string[]
): () => string {
  const wrongSet = new Set(wrongChars)
  const uniqueSlowChars = Array.from(new Set(slowChars))

  // 优先使用慢字中的非错字；若为空则回退到本轮练习的其他字，避免退化为“全错字池”
  let nonWrongChars = uniqueSlowChars.filter(ch => !wrongSet.has(ch))
  if (nonWrongChars.length === 0) {
    nonWrongChars = recentChars.filter(ch => !wrongSet.has(ch))
  }
  if (nonWrongChars.length === 0) {
    nonWrongChars = shuffle(hanziList.hanzi.filter(ch => !wrongSet.has(ch))).slice(0, 40)
  }

  function buildPool(): string[] {
    const sourceChars = wrongChars.length > 0
      ? [...wrongChars, ...nonWrongChars]
      : uniqueSlowChars
    if (sourceChars.length === 0) return []

    const poolSize = Math.max(30, sourceChars.length * 3)

    let pool: string[]
    if (wrongChars.length > 0 && nonWrongChars.length > 0) {
      // 错字固定约 30%，避免体感“错字占比过高”
      const wrongSlots = Math.max(wrongChars.length, Math.round(poolSize * 0.3))
      const otherSlots = poolSize - wrongSlots
      pool = [
        ...spreadEvenly(wrongChars, wrongSlots),
        ...spreadEvenly(nonWrongChars, otherSlots),
      ]
    } else {
      pool = spreadEvenly(sourceChars, poolSize)
    }

    return arrangeNoAdjacent(pool)
  }

  let sequence = buildPool()
  let idx = 0

  return () => {
    if (sequence.length === 0) return defaultNextChar()
    if (idx >= sequence.length) {
      sequence = buildPool()
      idx = 0
    }
    return sequence[idx++]
  }
}

function startReinforcement() {
  const wrongChars = Array.from(new Set<string>(mistakes.value.map((m: MistakeItem) => m.hanzi)))
  const slowChars: string[] = getSlowChars(new Set(wrongChars))
  const recentChars = Array.from(new Set<string>(charTimings.value.map((t: CharTiming) => t.hanzi)))

  activeNextChar.value = createReinforcementNextChar(wrongChars, slowChars, recentChars)
  showMistakes.value = false
  mistakes.value = []
  charTimings.value = []
  charStartTime = performance.now()
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
    <single-mode :key="singleModeKey" :next-char="activeNextChar" @full-input="onFullInput" />

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