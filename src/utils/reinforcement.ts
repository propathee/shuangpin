export interface CharTiming {
  hanzi: string;
  pinyin: string;
  duration: number;
}

export interface ReinforcementOptions {
  wrongWeights: Map<string, number>;
  slowWeights: Map<string, number>;
  minPoolSize?: number;
  random?: () => number;
  lastChar?: string;
}

export const ACTIVE_DURATION_LIMIT_MS = 5000;

function sumWeights(weights: Map<string, number>) {
  let total = 0;
  for (const value of weights.values()) {
    total += value;
  }
  return total;
}

function cloneWeights(weights: Map<string, number>) {
  return new Map<string, number>(weights.entries());
}

function hasValidArrangement(counts: Map<string, number>, lastChar: string) {
  const entries = Array.from(counts.entries()).filter(([, count]) => count > 0);
  if (entries.length === 0) {
    return true;
  }

  for (const [startChar, startCount] of entries) {
    if (startChar === lastChar) {
      continue;
    }
    const remaining = new Map(counts);
    if (startCount === 1) {
      remaining.delete(startChar);
    } else {
      remaining.set(startChar, startCount - 1);
    }

    const restEntries = Array.from(remaining.entries()).filter(([, count]) => count > 0);
    const restTotal = restEntries.reduce((sum, [, count]) => sum + count, 0);
    const maxCount = Math.max(0, ...restEntries.map(([, count]) => count));
    if (maxCount <= Math.ceil(restTotal / 2)) {
      return true;
    }
  }

  return false;
}

function trimCountsForAdjacency(counts: Map<string, number>, lastChar: string) {
  const trimmed = cloneWeights(counts);
  while (!hasValidArrangement(trimmed, lastChar)) {
    const entries = Array.from(trimmed.entries()).filter(([, count]) => count > 0);
    if (entries.length === 0) {
      break;
    }
    entries.sort((a, b) => b[1] - a[1]);
    const [hanzi, count] = entries[0];
    if (count <= 1) {
      trimmed.delete(hanzi);
    } else {
      trimmed.set(hanzi, count - 1);
    }
  }
  return trimmed;
}

function pickByLargestRemainder(
  weights: Map<string, number>,
  slots: number,
  random: () => number
) {
  const entries = Array.from(weights.entries()).filter(([, weight]) => weight > 0);
  if (entries.length === 0 || slots <= 0) {
    return new Map<string, number>();
  }

  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const allocated = new Map<string, number>();
  const remainders = entries.map(([hanzi, weight]) => {
    const exact = (weight / totalWeight) * slots;
    const base = Math.floor(exact);
    allocated.set(hanzi, base);
    return {
      hanzi,
      remainder: exact - base,
    };
  });

  let remaining = slots - Array.from(allocated.values()).reduce((sum, count) => sum + count, 0);
  while (remaining > 0 && remainders.length > 0) {
    remainders.sort((a, b) => {
      if (b.remainder !== a.remainder) {
        return b.remainder - a.remainder;
      }
      if (a.hanzi === b.hanzi) {
        return 0;
      }
      return random() < 0.5 ? -1 : 1;
    });
    const picked = remainders.shift();
    if (!picked) {
      break;
    }
    allocated.set(picked.hanzi, (allocated.get(picked.hanzi) ?? 0) + 1);
    remaining -= 1;
  }

  return allocated;
}

function pickNextChar(
  counts: Map<string, number>,
  last: string,
  random: () => number
) {
  const candidates = Array.from(counts.entries()).filter(
    ([hanzi, count]) => count > 0 && hanzi !== last
  );
  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    if (a[0] === b[0]) {
      return 0;
    }
    return random() < 0.5 ? -1 : 1;
  });

  return candidates[0][0];
}

export function normalizeDuration(
  startedAt: number | null,
  finishedAt: number,
  limitMs = ACTIVE_DURATION_LIMIT_MS
) {
  if (startedAt === null) {
    return null;
  }
  const duration = finishedAt - startedAt;
  if (duration <= 0 || duration >= limitMs) {
    return null;
  }
  return duration;
}

export function buildWrongWeights(hanziList: string[]) {
  const weights = new Map<string, number>();
  for (const hanzi of hanziList) {
    weights.set(hanzi, (weights.get(hanzi) ?? 0) + 1);
  }
  return weights;
}

export function getSlowCharWeights(
  timings: CharTiming[],
  wrongSet: Set<string>
) {
  const candidates = timings.filter((timing) => !wrongSet.has(timing.hanzi));
  if (candidates.length === 0) {
    return new Map<string, number>();
  }

  const sorted = [...candidates].sort((a, b) => b.duration - a.duration);
  const cutoff = Math.max(1, Math.ceil(sorted.length * 0.2));
  const weights = new Map<string, number>();
  for (const timing of sorted.slice(0, cutoff)) {
    weights.set(timing.hanzi, (weights.get(timing.hanzi) ?? 0) + 1);
  }
  return weights;
}

export function buildReinforcementSequence({
  wrongWeights,
  slowWeights,
  minPoolSize = 30,
  random = Math.random,
  lastChar = "",
}: ReinforcementOptions) {
  const wrongTotal = sumWeights(wrongWeights);
  const slowTotal = sumWeights(slowWeights);
  const totalWeight = wrongTotal + slowTotal;

  if (totalWeight === 0) {
    return [];
  }

  const poolSize = Math.max(minPoolSize, totalWeight);
  const counts = new Map<string, number>();

  if (wrongTotal > 0 && slowTotal > 0) {
    const wrongSlots = Math.round(poolSize * 0.3);
    const slowSlots = poolSize - wrongSlots;
    for (const [hanzi, count] of pickByLargestRemainder(
      wrongWeights,
      wrongSlots,
      random
    )) {
      if (count > 0) {
        counts.set(hanzi, count);
      }
    }
    for (const [hanzi, count] of pickByLargestRemainder(
      slowWeights,
      slowSlots,
      random
    )) {
      if (count > 0) {
        counts.set(hanzi, (counts.get(hanzi) ?? 0) + count);
      }
    }
  } else {
    const singleWeights = wrongTotal > 0 ? wrongWeights : slowWeights;
    const singleTotal = wrongTotal > 0 ? wrongTotal : slowTotal;
    const scale = poolSize / singleTotal;
    for (const [hanzi, weight] of singleWeights) {
      counts.set(hanzi, Math.max(1, Math.round(weight * scale)));
    }
  }

  const sequence: string[] = [];
  let last = lastChar;
  const remaining = trimCountsForAdjacency(counts, lastChar);
  while (true) {
    const picked = pickNextChar(remaining, last, random);
    if (!picked) {
      break;
    }
    sequence.push(picked);
    remaining.set(picked, (remaining.get(picked) ?? 1) - 1);
    last = picked;
  }

  return sequence;
}

export function createReinforcementGenerator(
  options: Omit<ReinforcementOptions, "lastChar">
) {
  let lastChar = "";
  let sequence = buildReinforcementSequence({ ...options, lastChar });
  let idx = 0;

  return () => {
    if (sequence.length === 0) {
      return undefined;
    }
    if (idx >= sequence.length) {
      sequence = buildReinforcementSequence({ ...options, lastChar });
      idx = 0;
      if (sequence.length === 0) {
        return undefined;
      }
    }

    const next = sequence[idx++];
    lastChar = next;
    return next;
  };
}
