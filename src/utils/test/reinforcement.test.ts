import { describe, expect, test } from "vitest";
import {
  buildReinforcementSequence,
  buildWrongWeights,
  createReinforcementGenerator,
  getSlowCharWeights,
  normalizeDuration,
} from "../reinforcement";

describe("强化训练逻辑", () => {
  test("长停顿不会被记录为慢字耗时", () => {
    expect(normalizeDuration(1000, 5900)).toBe(4900);
    expect(normalizeDuration(1000, 6000)).toBeNull();
    expect(normalizeDuration(null, 6000)).toBeNull();
  });

  test("错字按出现次数计权", () => {
    const weights = buildWrongWeights(["错", "错", "慢", "错", "慢"]);
    expect(weights.get("错")).toBe(3);
    expect(weights.get("慢")).toBe(2);
  });

  test("慢字按进入最慢集合的次数计权，且排除错字", () => {
    const weights = getSlowCharWeights(
      [
        { hanzi: "甲", pinyin: "jia", duration: 600 },
        { hanzi: "甲", pinyin: "jia", duration: 580 },
        { hanzi: "乙", pinyin: "yi", duration: 570 },
        { hanzi: "丙", pinyin: "bing", duration: 300 },
        { hanzi: "丁", pinyin: "ding", duration: 200 },
      ],
      new Set(["乙"])
    );

    expect(weights.get("甲")).toBe(1);
    expect(weights.has("乙")).toBe(false);
  });

  test("候选序列遵循权重且没有相邻重复", () => {
    const sequence = buildReinforcementSequence({
      wrongWeights: new Map([
        ["错", 4],
        ["难", 1],
      ]),
      slowWeights: new Map([
        ["慢", 3],
        ["稳", 1],
      ]),
      minPoolSize: 20,
      random: () => 0,
    });

    expect(sequence.length).toBeGreaterThan(0);
    for (let i = 1; i < sequence.length; i += 1) {
      expect(sequence[i]).not.toBe(sequence[i - 1]);
    }

    const counts = sequence.reduce<Record<string, number>>((acc, hanzi) => {
      acc[hanzi] = (acc[hanzi] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts["错"]).toBeGreaterThan(counts["难"]);
    expect(counts["慢"]).toBeGreaterThan(counts["稳"]);
  });

  test("候选种类过少时会缩短序列来避免相邻重复", () => {
    const sequence = buildReinforcementSequence({
      wrongWeights: new Map([["错", 1]]),
      slowWeights: new Map([["慢", 1]]),
      minPoolSize: 30,
      random: () => 0,
    });

    expect(sequence.length).toBeLessThan(30);
    for (let i = 1; i < sequence.length; i += 1) {
      expect(sequence[i]).not.toBe(sequence[i - 1]);
    }
  });

  test("跨轮次重建时也不会和上一轮尾字重复", () => {
    const nextChar = createReinforcementGenerator({
      wrongWeights: new Map([["错", 1]]),
      slowWeights: new Map([["慢", 1]]),
      minPoolSize: 30,
      random: () => 0,
    });

    const picked = Array.from({ length: 25 }, () => nextChar()).filter(
      (char): char is string => !!char
    );
    for (let i = 1; i < picked.length; i += 1) {
      expect(picked[i]).not.toBe(picked[i - 1]);
    }
  });
});
