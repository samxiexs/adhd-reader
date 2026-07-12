"use client";

import type { BlockAnnotation, ReadingBlock, ReadingBlockKind } from "./contracts";

export type ClientReadingBlock = ReadingBlock & {
  html: string;
};

export type WordFocusOptions = {
  enabled: boolean;
  fixation: number;
};

const allowedTags = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "A",
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "BLOCKQUOTE",
]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizedHref(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function sanitizeRichHtml(value: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const elements: Element[] = [];
  while (walker.nextNode()) elements.push(walker.currentNode as Element);

  for (const element of elements.reverse()) {
    const tag = element.tagName;
    if (!allowedTags.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    if (tag === "B") {
      const strong = doc.createElement("strong");
      strong.innerHTML = element.innerHTML;
      element.replaceWith(strong);
      continue;
    }
    if (tag === "I") {
      const em = doc.createElement("em");
      em.innerHTML = element.innerHTML;
      element.replaceWith(em);
      continue;
    }
    if (tag === "A") {
      const href = sanitizedHref(element.getAttribute("href"));
      if (href) {
        element.setAttribute("href", href);
        element.setAttribute("rel", "noreferrer noopener");
      } else {
        element.replaceWith(...Array.from(element.childNodes));
      }
    }
    for (const attribute of Array.from(element.attributes)) {
      if (tag === "A" && ["href", "rel"].includes(attribute.name)) continue;
      element.removeAttribute(attribute.name);
    }
  }

  return doc.body.innerHTML;
}

function classifyElement(element: Element): ReadingBlockKind {
  if (/^H[1-4]$/.test(element.tagName)) return "heading";
  if (["UL", "OL"].includes(element.tagName)) return "list";
  if (element.tagName === "BLOCKQUOTE") return "quote";
  return "paragraph";
}

function createBlock(
  id: string,
  text: string,
  kind: ReadingBlockKind,
  html: string,
  page?: number,
): ClientReadingBlock {
  return { id, text, kind, html, ...(page ? { page } : {}) };
}

function cleanBlockHtml(element: Element, kind: ReadingBlockKind) {
  if (kind === "paragraph") return `<p>${element.innerHTML}</p>`;
  return element.outerHTML;
}

export function plainTextToBlocks(text: string, page?: number, prefix = "block") {
  const normalized = text.replaceAll("\r\n", "\n").trim();
  if (!normalized) return [] as ClientReadingBlock[];

  return normalized
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => {
      const looksLikeHeading =
        paragraph.length < 95 &&
        !/[。！？.!?]$/u.test(paragraph) &&
        !paragraph.includes("\n");
      const kind: ReadingBlockKind = looksLikeHeading ? "heading" : "paragraph";
      const html = looksLikeHeading
        ? `<h2>${escapeHtml(paragraph)}</h2>`
        : `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`;
      return createBlock(`${prefix}-${page ?? "text"}-${index}`, paragraph, kind, html, page);
    });
}

export function blocksFromRichHtml(html: string, preserveFormatting: boolean) {
  if (!preserveFormatting) {
    const parser = new DOMParser();
    return plainTextToBlocks(parser.parseFromString(html, "text/html").body.innerText);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizeRichHtml(html), "text/html");
  const blocks: ClientReadingBlock[] = [];
  let index = 0;

  for (const child of Array.from(doc.body.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim() ?? "";
      if (text) {
        blocks.push(createBlock(`rich-${index++}`, text, "paragraph", `<p>${escapeHtml(text)}</p>`));
      }
      continue;
    }
    if (!(child instanceof Element)) continue;
    const text = child.textContent?.trim() ?? "";
    if (!text) continue;
    const kind = classifyElement(child);
    blocks.push(createBlock(`rich-${index++}`, text, kind, cleanBlockHtml(child, kind)));
  }

  return blocks.length > 0 ? blocks : plainTextToBlocks(doc.body.innerText);
}

function inlineMarkdown(value: string) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToBlocks(markdown: string) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: ClientReadingBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    if (text) {
      blocks.push(createBlock(`md-${index++}`, text, "paragraph", `<p>${inlineMarkdown(text).replaceAll("\n", "<br>")}</p>`));
    }
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) {
      const text = list.join("\n");
      blocks.push(createBlock(`md-${index++}`, text, "list", `<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`));
    }
    list = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    const listItem = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(createBlock(`md-${index++}`, heading[2], "heading", `<h${level}>${inlineMarkdown(heading[2])}</h${level}>`));
    } else if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

function decorateHtml(html: string, highlights: { start: number; end: number }[]) {
  if (!highlights.length) return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  let cursor = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    textNodes.push({ node, start: cursor, end: cursor + node.data.length });
    cursor += node.data.length;
  }

  for (const { node, start, end } of textNodes) {
    const intersects = highlights.filter((range) => range.start < end && range.end > start);
    if (!intersects.length || !node.parentNode) continue;
    const cuts = new Set<number>([0, node.data.length]);
    for (const range of intersects) {
      cuts.add(Math.max(0, range.start - start));
      cuts.add(Math.min(node.data.length, range.end - start));
    }
    const orderedCuts = Array.from(cuts).sort((a, b) => a - b);
    const fragment = doc.createDocumentFragment();
    for (let i = 0; i < orderedCuts.length - 1; i += 1) {
      const from = orderedCuts[i];
      const to = orderedCuts[i + 1];
      const segment = node.data.slice(from, to);
      const highlighted = intersects.some(
        (range) => start + from >= range.start && start + to <= range.end,
      );
      if (highlighted && segment.trim()) {
        const mark = doc.createElement("span");
        mark.dataset.semanticFocus = "true";
        mark.textContent = segment;
        fragment.append(mark);
      } else {
        fragment.append(doc.createTextNode(segment));
      }
    }
    node.parentNode.replaceChild(fragment, node);
  }

  return root.innerHTML;
}

type SegmentLike = {
  segment: string;
  index: number;
  isWordLike?: boolean;
};

function fallbackWordSegments(text: string): SegmentLike[] {
  const segments: SegmentLike[] = [];
  const matcher = /[\p{L}\p{M}\p{N}]+(?:[’'-][\p{L}\p{M}\p{N}]+)*/gu;
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ segment: text.slice(cursor, index), index: cursor });
    segments.push({ segment: match[0], index, isWordLike: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ segment: text.slice(cursor), index: cursor });
  return segments;
}

function wordSegments(text: string): SegmentLike[] {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale?: string | string[], options?: { granularity: "word" }) => {
      segment(input: string): Iterable<SegmentLike>;
    };
  }).Segmenter;

  if (!Segmenter) return fallbackWordSegments(text);
  return Array.from(new Segmenter(undefined, { granularity: "word" }).segment(text));
}

function focusPrefixLength(word: string, fixation: number) {
  const characters = Array.from(word);
  if (characters.length < 2) return 0;
  return Math.min(
    characters.length - 1,
    Math.max(1, Math.round(characters.length * fixation)),
  );
}

/** Creates Bionic-style visual fixation points while keeping all source text intact. */
function applyWordFocus(html: string, options: WordFocusOptions) {
  if (!options.enabled) return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    if (!node.parentNode || !node.data.trim()) continue;
    const fragment = doc.createDocumentFragment();
    for (const segment of wordSegments(node.data)) {
      if (!segment.isWordLike) {
        fragment.append(doc.createTextNode(segment.segment));
        continue;
      }
      const characters = Array.from(segment.segment);
      const prefixLength = focusPrefixLength(segment.segment, options.fixation);
      if (prefixLength === 0) {
        fragment.append(doc.createTextNode(segment.segment));
        continue;
      }
      const fixation = doc.createElement("strong");
      fixation.dataset.wordFocus = "true";
      fixation.textContent = characters.slice(0, prefixLength).join("");
      fragment.append(fixation, doc.createTextNode(characters.slice(prefixLength).join("")));
    }
    node.parentNode.replaceChild(fragment, node);
  }

  return root.innerHTML;
}

export function renderReadingDocument(
  blocks: ClientReadingBlock[],
  annotations: BlockAnnotation[],
  wordFocus: WordFocusOptions = { enabled: true, fixation: 0.42 },
) {
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation.highlights]));
  return blocks
    .map((block) => {
      const decorated = applyWordFocus(
        decorateHtml(block.html, byId.get(block.id) ?? []),
        wordFocus,
      );
      const page = block.page ? ` data-page="${block.page}"` : "";
      return `<section class="reading-block reading-block--${block.kind}"${page}>${decorated}</section>`;
    })
    .join("");
}

export function blocksToPlainText(blocks: ClientReadingBlock[]) {
  return blocks.map((block) => block.text).join("\n\n");
}

function markdownFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  const content = Array.from(node.childNodes).map(markdownFromNode).join("");
  switch (node.tagName) {
    case "STRONG":
    case "B":
      return `**${content}**`;
    case "EM":
    case "I":
      return `_${content}_`;
    case "A":
      return `[${content}](${node.getAttribute("href") ?? ""})`;
    case "H1":
      return `# ${content}\n\n`;
    case "H2":
      return `## ${content}\n\n`;
    case "H3":
      return `### ${content}\n\n`;
    case "H4":
      return `#### ${content}\n\n`;
    case "P":
      return `${content}\n\n`;
    case "BR":
      return "\n";
    case "LI":
      return `- ${content}\n`;
    case "UL":
    case "OL":
      return `${content}\n`;
    case "BLOCKQUOTE":
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => `> ${line}`)
        .join("\n")
        .concat("\n\n");
    default:
      return content;
  }
}

export function htmlToMarkdown(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return Array.from(doc.body.childNodes)
    .map(markdownFromNode)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}

export function clipboardHtml(html: string) {
  return sanitizeRichHtml(html);
}
