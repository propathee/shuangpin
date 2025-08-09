<script setup lang="ts">
import Keyboard from "../components/Keyboard.vue";
import Hanzi from "../components/Hanzi.vue";
import Pinyin from "../components/Pinyin.vue";
import TypeSummary from "../components/TypeSummary.vue";
import MenuList from "../components/MenuList.vue";

import { onActivated, onDeactivated, ref, watchPostEffect } from "vue";
import { matchSpToPinyin } from "../utils/keyboard";
import { useStore } from "../store";
import { computed } from "vue";
import { getPinyinOf } from "../utils/hanzi";
import { TypingSummary } from "../utils/summary";
import { followKeys, leadKeys } from "../utils/pinyin";
import { randInt, randomChoice } from "../utils/number";

export interface SingleModeProps {
  nextChar?: () => string;
  hanziList?: string[];
  onValidInput?: (result: boolean) => void;
  mode?: "Lead" | "Follow";
}

// 新增：对外暴露一次完整输入事件，便于上层页面（如随机模式）记录错字详情
const emit = defineEmits<{
  (
    e: "full-input",
    payload: {
      hanzi: string;
      pinyin: string;
      leadKey?: string;
      followKey?: string;
      valid: boolean;
      resolvedLead: string;
      resolvedFollow: string;
      correctLeadKey?: string;
      correctFollowKey?: string;
    }
  ): void;
}>();

function nextChar() {
  if (!props.mode) {
    return props.nextChar?.() ?? "";
  }
  return props.hanziList?.[randInt(props.hanziList?.length)] ?? "";
}

const pinyin = ref<string[]>([]);

const store = useStore();
const props = defineProps<SingleModeProps>();
const hanziSeq = ref(new Array(4).fill(0).map(() => nextChar()));
const isValid = ref(false);

const summary = ref(new TypingSummary());

// 明确键位列表映射的类型，避免隐式 any
const modeKeyToKeysMap: Record<"Lead" | "Follow" | "", string[]> = {
  Lead: leadKeys,
  Follow: followKeys,
  "": [] as string[],
};
const keys = modeKeyToKeysMap[(props.mode ?? "") as "Lead" | "Follow" | ""];

const progresses = computed(() =>
  keys.map((v: string) => {
    return {
      key: v,
      progress: store.getProgress(v),
    };
  })
);

const listMenuItems = computed(() => {
  return progresses.value.map((v: { key: string }) =>
    `${v.key.toUpperCase()} ${(store.getAccuracy(v.key) * 100).toFixed(2)}%`
  );
});

const menuIndex = computed(() => {
  if (props.mode === "Lead") {
    return store.currentLeadIndex;
  } else if (props.mode === "Follow") {
    return store.currentFollowIndex;
  }
  return -1;
});

function onMenuChange(i: number) {
  if (props.mode === "Lead") {
    store.currentLeadIndex = i;
  } else if (props.mode === "Follow") {
    store.currentFollowIndex = i;
  }
}

watchPostEffect(() => {
  for (let i = 0; i < 4; ++i) {
    hanziSeq.value.unshift(nextChar());
    hanziSeq.value.pop();
  }
});

function onKeyPressed() {
  summary.value.onKeyPressed();
}

onActivated(() => {
  document.addEventListener("keypress", onKeyPressed);
});

onDeactivated(() => {
  document.removeEventListener("keypress", onKeyPressed);
});

const answer = computed(() => {
  const pys = getPinyinOf(hanziSeq.value.at(-1) ?? "");
  return pys.at(0) ?? "";
});

const hints = computed(() => {
  return (store.mode().py2sp.get(answer.value) ?? "").split("");
});

function onSeq([lead, follow]: [string?, string?]) {
  const res = matchSpToPinyin(
    store.mode(),
    lead as Char,
    follow as Char,
    answer.value
  );

  if (!!lead && !!follow) {
    props.onValidInput?.(res.valid);
    store.updateProgressOnValid(res.lead, res.follow, res.valid);
  }

  const fullInput = !!lead && !!follow;
  if (fullInput) {
    summary.value.onValid(res.valid);

    // 新增：发出一次完整输入事件，包含当前汉字、目标拼音、实际按键与解析后的拼音片段
    const sp = store.mode().py2sp.get(answer.value) ?? "";
    const correctLeadKey = sp.length >= 1 ? sp[0] : undefined;
    const correctFollowKey = sp.length >= 2 ? sp[1] : undefined;
    emit("full-input", {
      hanzi: (hanziSeq.value.at(-1) ?? ""),
      pinyin: answer.value,
      leadKey: lead,
      followKey: follow,
      valid: res.valid,
      resolvedLead: res.lead,
      resolvedFollow: res.follow,
      correctLeadKey,
      correctFollowKey,
    });
  }

  pinyin.value = [res.lead, res.follow].filter((v) => !!v) as string[];

  isValid.value = res.valid;

  return res.valid;
}

watchPostEffect(() => {
  if (isValid.value) {
    setTimeout(() => {
      hanziSeq.value.unshift(nextChar());
      hanziSeq.value.pop();
      pinyin.value = [];
      isValid.value = false;
    }, 100);
  }
});
</script>

<template>
  <div class="home-page">
    <div class="single-menu">
      <menu-list
        :items="listMenuItems"
        :index="menuIndex"
        @menu-change="onMenuChange"
      />
    </div>

    <div class="input-area">
      <Pinyin :chars="pinyin" />
    </div>

    <div class="hanzi-list">
      <Hanzi :hanzi-seq="[...hanziSeq]" />
    </div>

    <div class="single-keyboard">
      <Keyboard :valid-seq="onSeq" :hints="hints" />
    </div>

    <div class="summary">
      <TypeSummary
        :speed="summary.hanziPerMinutes"
        :accuracy="summary.accuracy"
        :avgpress="summary.pressPerHanzi"
      />
    </div>
  </div>
</template>

<style lang="less">
@import "../styles/color.less";
@import "../styles/var.less";

.home-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;

  .single-menu {
    position: absolute;
    top: 0;
    left: 100px;
  }

  .input-area {
    margin-bottom: 32px;
    height: 160px;
    display: flex;
    align-items: center;

    @media (max-width: 576px) {
      margin-top: 30vh;
    }
  }

  .summary {
    position: absolute;
    right: var(--app-padding);
    bottom: var(--app-padding);

    @media (max-width: 576px) {
      top: 36px;
    }
  }

  .hanzi-list {
    position: absolute;
    top: var(--app-padding);
    right: var(--app-padding);

    @media (max-width: 576px) {
      top: 120px;
    }
  }

  @media (max-width: 576px) {
    .single-keyboard {
      position: absolute;
      bottom: 1em;
    }
  }
}
</style>
