export type ReadingBlockKind = "paragraph" | "heading" | "list" | "quote";

export type ReadingBlock = {
  id: string;
  text: string;
  kind: ReadingBlockKind;
  page?: number;
};

export type Highlight = {
  start: number;
  end: number;
};

export type BlockAnnotation = {
  id: string;
  highlights: Highlight[];
};

export type FormatMode = "local" | "ai";

const MAX_BLOCKS = 500;
const MAX_TOTAL_CHARACTERS = 120_000;

export function isReadingBlock(value: unknown): value is ReadingBlock {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReadingBlock>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.text === "string" &&
    ["paragraph", "heading", "list", "quote"].includes(
      candidate.kind ?? "paragraph",
    ) &&
    (candidate.page === undefined ||
      (typeof candidate.page === "number" && Number.isInteger(candidate.page)))
  );
}

export function validateBlocks(value: unknown): ReadingBlock[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("请先提供至少一个有文字的段落。");
  }

  if (value.length > MAX_BLOCKS) {
    throw new Error("一次最多处理 500 个段落；请将文件分段后再试。");
  }

  const blocks = value.filter(isReadingBlock).map((block) => ({
    id: block.id.trim(),
    text: block.text,
    kind: block.kind,
    ...(block.page ? { page: block.page } : {}),
  }));

  if (blocks.length !== value.length || blocks.some((block) => !block.id || !block.text.trim())) {
    throw new Error("文档段落格式无效，或其中包含空段落。");
  }

  const ids = new Set(blocks.map((block) => block.id));
  if (ids.size !== blocks.length) {
    throw new Error("文档段落 ID 不能重复。");
  }

  const totalCharacters = blocks.reduce((total, block) => total + block.text.length, 0);
  if (totalCharacters > MAX_TOTAL_CHARACTERS) {
    throw new Error("当前内容超过 120,000 个字符；请分段处理。");
  }

  return blocks;
}

export function normalizeHighlights(
  highlights: unknown,
  textLength: number,
): Highlight[] {
  if (!Array.isArray(highlights)) return [];

  const ranges = highlights
    .filter((range): range is Highlight => {
      if (!range || typeof range !== "object") return false;
      const candidate = range as Partial<Highlight>;
      return (
        Number.isInteger(candidate.start) &&
        Number.isInteger(candidate.end) &&
        (candidate.start ?? -1) >= 0 &&
        (candidate.end ?? -1) <= textLength &&
        (candidate.end ?? 0) > (candidate.start ?? 0)
      );
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const normalized: Highlight[] = [];
  for (const range of ranges) {
    const previous = normalized.at(-1);
    if (!previous || range.start > previous.end) {
      normalized.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }

  return normalized.slice(0, 3);
}

function sentenceEnd(text: string, from: number) {
  const match = /[。！？.!?；;：:]/u.exec(text.slice(from));
  return match ? from + match.index + 1 : text.length;
}

/** A deliberately conservative, deterministic emphasis strategy for offline use. */
export function buildLocalAnnotations(blocks: ReadingBlock[]): BlockAnnotation[] {
  return blocks.map((block) => {
    const text = block.text.trim();
    if (block.kind === "heading" || text.length < 12) {
      return { id: block.id, highlights: [] };
    }

    const firstEnd = sentenceEnd(text, 0);
    const firstClause = text.slice(0, Math.min(firstEnd, 110));
    const words = Array.from(
      firstClause.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu),
    );

    if (words.length === 0) return { id: block.id, highlights: [] };
    const take = Math.min(words.length, text.length > 180 ? 8 : 5);
    const end = (words[take - 1].index ?? 0) + words[take - 1][0].length;
    const start = words[0].index ?? 0;

    return {
      id: block.id,
      highlights: normalizeHighlights([{ start, end }], block.text.length),
    };
  });
}

export function validateAnnotations(
  blocks: ReadingBlock[],
  candidate: unknown,
): BlockAnnotation[] {
  if (!Array.isArray(candidate)) {
    throw new Error("模型没有返回可验证的重点标注。");
  }

  const byId = new Map<string, unknown>();
  for (const item of candidate) {
    if (!item || typeof item !== "object") continue;
    const annotation = item as Partial<BlockAnnotation>;
    if (typeof annotation.id !== "string" || byId.has(annotation.id)) {
      throw new Error("模型返回了重复或无效的段落标识。");
    }
    byId.set(annotation.id, annotation.highlights);
  }

  if (byId.size !== blocks.length || blocks.some((block) => !byId.has(block.id))) {
    throw new Error("模型返回的段落集合与原文不一致，已拒绝该结果。");
  }

  return blocks.map((block) => ({
    id: block.id,
    highlights: normalizeHighlights(byId.get(block.id), block.text.length),
  }));
}
