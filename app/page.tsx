"use client";

import { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";
import type { BlockAnnotation, FormatMode } from "../lib/contracts";
import {
  blocksFromRichHtml,
  blocksToPlainText,
  clipboardHtml,
  htmlToMarkdown,
  markdownToBlocks,
  plainTextToBlocks,
  renderReadingDocument,
  type ClientReadingBlock,
  type WordFocusOptions,
} from "../lib/client-document";

type Surface = "paste" | "reader";
type Provider = { id: string; label: string; model: string };

const latinFontOptions = [
  { id: "literary", label: "Georgia 衬线", stack: 'Georgia, "Times New Roman", serif' },
  { id: "system", label: "系统无衬线", stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif' },
  { id: "humanist", label: "清晰人文", stack: '"Atkinson Hyperlegible", "Trebuchet MS", Arial, sans-serif' },
  { id: "mono", label: "等宽", stack: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace' },
];

const cjkFontOptions = [
  { id: "song", label: "宋体", stack: '"Noto Serif SC", "Songti SC", SimSun, serif' },
  { id: "pingfang", label: "苹方 / 微软雅黑", stack: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
  { id: "hei", label: "黑体", stack: '"Hiragino Sans GB", "Heiti SC", SimHei, sans-serif' },
  { id: "kai", label: "楷体", stack: '"Kaiti SC", STKaiti, KaiTi, serif' },
];

const minimumSplitPercent = 28;
const maximumSplitPercent = 72;

function clampSplitPercent(value: number) {
  return Math.min(maximumSplitPercent, Math.max(minimumSplitPercent, Math.round(value)));
}

const exampleText = `<p>长文本并不一定要一次读完。把内容拆成清楚的段落、先抓住每段的重点，再决定是否继续深入，通常会更轻松。</p><p>这个工具不会改写你的原文。它只重新组织阅读节奏，并用词首聚焦帮助你更快找到每个词的视觉落点。</p><p>你可以先使用本地模式；如果部署者配置了 AI 服务，也可以切换到 AI 模式获得更语义化的提示。</p>`;

function batchesOf(blocks: ClientReadingBlock[], maxCharacters = 11_000) {
  const batches: ClientReadingBlock[][] = [];
  let current: ClientReadingBlock[] = [];
  let length = 0;
  for (const block of blocks) {
    if (current.length > 0 && length + block.text.length > maxCharacters) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(block);
    length += block.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function downloadMarkdown(filename: string, html: string) {
  const blob = new Blob([htmlToMarkdown(html)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function inputCharacterCount(html: string) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39);/g, "x")
    .trim().length;
}

export default function Home() {
  const inputRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const readerOutputRef = useRef<HTMLDivElement>(null);
  const pasteWorkspaceRef = useRef<HTMLFormElement>(null);
  const fileSplitRef = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<Surface>("paste");
  const [preserveFormatting, setPreserveFormatting] = useState(true);
  const [inputHtml, setInputHtml] = useState(exampleText);
  const [formatMode, setFormatMode] = useState<FormatMode>("local");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [outputHtml, setOutputHtml] = useState("");
  const [readerBlocks, setReaderBlocks] = useState<ClientReadingBlock[]>([]);
  const [readerSourceHtml, setReaderSourceHtml] = useState("");
  const [readerOutputHtml, setReaderOutputHtml] = useState("");
  const [readerFileName, setReaderFileName] = useState("");
  const [readerKind, setReaderKind] = useState<"markdown" | "pdf" | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [splitView, setSplitView] = useState(true);
  const [splitPercent, setSplitPercent] = useState(50);
  const [activePage, setActivePage] = useState(1);
  const [status, setStatus] = useState("本地模式已准备好，不会上传或保存你的内容。");
  const [isFormatting, setIsFormatting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fontSize, setFontSize] = useState(19);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [contentWidth, setContentWidth] = useState(740);
  const [wordFocusEnabled, setWordFocusEnabled] = useState(true);
  const [wordFocusFixation, setWordFocusFixation] = useState(42);
  const [latinFont, setLatinFont] = useState("literary");
  const [cjkFont, setCjkFont] = useState("song");

  useEffect(() => {
    if (inputRef.current) inputRef.current.innerHTML = exampleText;
  }, []);

  useEffect(() => {
    fetch("/api/providers")
      .then((response) => response.json())
      .then((data: { providers?: Provider[] }) => {
        const nextProviders = data.providers ?? [];
        setProviders(nextProviders);
        setProviderId(nextProviders[0]?.id ?? "");
      })
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const selectedLatinFont = latinFontOptions.find((font) => font.id === latinFont) ?? latinFontOptions[0];
  const selectedCjkFont = cjkFontOptions.find((font) => font.id === cjkFont) ?? cjkFontOptions[0];

  const readerStyle = {
    "--reader-size": `${fontSize}px`,
    "--reader-line-height": String(lineHeight),
    "--reader-width": `${contentWidth}px`,
    "--latin-font": selectedLatinFont.stack,
    "--cjk-font": selectedCjkFont.stack,
  } as React.CSSProperties;

  const splitStyle = {
    "--split-left": `${splitPercent}fr`,
    "--split-right": `${100 - splitPercent}fr`,
  } as React.CSSProperties;

  const wordFocusOptions: WordFocusOptions = {
    enabled: wordFocusEnabled,
    fixation: wordFocusFixation / 100,
  };

  function setSplitFromPointer(clientX: number, container: HTMLElement) {
    const bounds = container.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(container);
    const leftPadding = Number.parseFloat(computedStyle.paddingLeft) || 0;
    const rightPadding = Number.parseFloat(computedStyle.paddingRight) || 0;
    const availableWidth = bounds.width - leftPadding - rightPadding;
    if (availableWidth <= 0) return;
    setSplitPercent(clampSplitPercent(((clientX - bounds.left - leftPadding) / availableWidth) * 100));
  }

  function startSplitResize(event: PointerEvent<HTMLElement>, container: HTMLElement | null) {
    if (!container || window.matchMedia("(max-width: 980px)").matches) return;
    event.preventDefault();
    document.body.classList.add("is-resizing-columns");
    setSplitFromPointer(event.clientX, container);

    const onPointerMove = (moveEvent: globalThis.PointerEvent) => setSplitFromPointer(moveEvent.clientX, container);
    const stopResizing = () => {
      document.body.classList.remove("is-resizing-columns");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
  }

  function handleSplitKeyboard(event: KeyboardEvent<HTMLElement>) {
    const adjustments: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };
    if (event.key === "Home") {
      event.preventDefault();
      setSplitPercent(minimumSplitPercent);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setSplitPercent(maximumSplitPercent);
      return;
    }
    if (adjustments[event.key]) {
      event.preventDefault();
      setSplitPercent((current) => clampSplitPercent(current + adjustments[event.key]));
    }
  }

  function setEditorContent(nextHtml: string) {
    setInputHtml(nextHtml);
    if (inputRef.current) inputRef.current.innerHTML = nextHtml;
  }

  function getInputBlocks() {
    return blocksFromRichHtml(inputRef.current?.innerHTML ?? inputHtml, preserveFormatting);
  }

  async function requestAnnotations(blocks: ClientReadingBlock[], selectedMode = formatMode) {
    const requestBatches = batchesOf(blocks);
    const annotations: BlockAnnotation[] = [];
    for (let index = 0; index < requestBatches.length; index += 1) {
      const response = await fetch("/api/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: selectedMode,
          providerId,
          blocks: requestBatches[index].map(({ id, text, kind, page }) => ({ id, text, kind, page })),
        }),
      });
      const payload = (await response.json()) as { annotations?: BlockAnnotation[]; error?: string };
      if (!response.ok || !payload.annotations) {
        throw new Error(payload.error ?? "当前内容无法处理。");
      }
      annotations.push(...payload.annotations);
      setProgress(Math.round(((index + 1) / requestBatches.length) * 100));
    }
    return annotations;
  }

  async function formatBlocks(blocks: ClientReadingBlock[]) {
    if (!blocks.length) throw new Error("请先粘贴或打开一段包含文字的内容。");
    setIsFormatting(true);
    setProgress(0);
    try {
      const annotations = await requestAnnotations(blocks);
      setProgress(100);
      return { html: renderReadingDocument(blocks, annotations, wordFocusOptions) };
    } catch (error) {
      if (formatMode === "ai") {
        setFormatMode("local");
        const fallbackMessage = `${error instanceof Error ? error.message : "AI 服务不可用。"} 已自动改用本地模式。`;
        const annotations = await requestAnnotations(blocks, "local");
        setProgress(100);
        return { html: renderReadingDocument(blocks, annotations, wordFocusOptions), fallbackMessage };
      }
      throw error;
    } finally {
      setIsFormatting(false);
    }
  }

  async function handleFormat(event?: FormEvent) {
    event?.preventDefault();
    try {
      setStatus(formatMode === "ai" ? "正在识别重点；原文会经过完整性校验。" : "正在按本地规则整理阅读节奏。");
      const result = await formatBlocks(getInputBlocks());
      setOutputHtml(result.html);
      setStatus(result.fallbackMessage ?? "已生成便利阅读版。你可以直接编辑、复制或下载 Markdown。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "生成失败，请再试一次。");
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const clipboard = event.clipboardData;
    const html = clipboard.getData("text/html");
    const text = clipboard.getData("text/plain");
    const nextHtml = preserveFormatting && html
      ? clipboardHtml(html)
      : plainTextToBlocks(text).map((block) => block.html).join("");
    setEditorContent(nextHtml || "<p></p>");
  }

  function resetToPlainText() {
    const blocks = blocksFromRichHtml(inputRef.current?.innerHTML ?? inputHtml, true);
    setPreserveFormatting(false);
    setEditorContent(plainTextToBlocks(blocksToPlainText(blocks)).map((block) => block.html).join(""));
    setStatus("之后粘贴的内容将清洗为纯文本，再统一排版。");
  }

  async function copyResult(ref: React.RefObject<HTMLDivElement | null>) {
    const html = ref.current?.innerHTML ?? "";
    const plain = ref.current?.innerText ?? "";
    if (!html.trim()) {
      setStatus("请先生成便利阅读版。");
      return;
    }
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      setStatus("已复制为富文本；粘贴到 Word、Notion 等工具时可保留重点格式。");
    } catch {
      await navigator.clipboard.writeText(plain);
      setStatus("已复制纯文本；当前浏览器未开放富文本剪贴板权限。");
    }
  }

  async function processReaderBlocks(blocks: ClientReadingBlock[], filename: string) {
    try {
      setStatus(`正在处理 ${filename}…`);
      const result = await formatBlocks(blocks);
      setReaderOutputHtml(result.html);
      setStatus(result.fallbackMessage ?? "文件便利阅读版已准备好。内容只保留在当前会话中。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "文件处理失败，请重新尝试。");
    }
  }

  async function extractPdfBlocks(file: File) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const document = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
    const blocks: ClientReadingBlock[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) blocks.push(...plainTextToBlocks(text, pageNumber, "pdf"));
    }
    return { blocks, pageCount: document.numPages };
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    setReaderFileName(file.name);
    setReaderOutputHtml("");
    setActivePage(1);
    setProgress(0);

    try {
      if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
        const blocks = markdownToBlocks(await file.text());
        if (!blocks.length) throw new Error("该 Markdown 文件没有可阅读的文字。");
        setReaderKind("markdown");
        setReaderBlocks(blocks);
        setReaderSourceHtml(renderReadingDocument(blocks, [], { enabled: false, fixation: 0.42 }));
        if (pdfUrl) setPdfUrl("");
        await processReaderBlocks(blocks, file.name);
        return;
      }

      if (lowerName.endsWith(".pdf") || file.type === "application/pdf") {
        setStatus("正在提取 PDF 中可选择的文字…");
        const { blocks, pageCount } = await extractPdfBlocks(file);
        if (!blocks.length) {
          throw new Error("没有找到可选择的 PDF 文字。这看起来像扫描件或图片型 PDF，目前不支持 OCR。");
        }
        if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        setPdfUrl(URL.createObjectURL(file));
        setReaderKind("pdf");
        setReaderBlocks(blocks);
        setReaderSourceHtml("");
        setStatus(`已提取 ${pageCount} 页文字，正在生成便利阅读版…`);
        await processReaderBlocks(blocks, file.name);
        return;
      }

      throw new Error("目前支持 Markdown（.md）和含可选文字层的 PDF 文件。");
    } catch (error) {
      setReaderBlocks([]);
      setReaderKind(null);
      setStatus(error instanceof Error ? error.message : "无法打开这个文件。");
    }
  }

  function syncActivePage(event: React.UIEvent<HTMLDivElement>) {
    const reader = event.currentTarget;
    const blocks = Array.from(reader.querySelectorAll<HTMLElement>("[data-page]"));
    if (!blocks.length) return;
    const readerTop = reader.getBoundingClientRect().top;
    const nearest = blocks.reduce((best, block) => {
      return Math.abs(block.getBoundingClientRect().top - readerTop) <
        Math.abs(best.getBoundingClientRect().top - readerTop)
        ? block
        : best;
    });
    setActivePage(Number(nearest.dataset.page ?? 1));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Focus Reader 首页">
          <span className="wordmark-mark" aria-hidden="true">F</span>
          <span>Focus Reader</span>
        </a>
        <nav className="mode-tabs" aria-label="工作区">
          <button className={surface === "paste" ? "active" : ""} onClick={() => setSurface("paste")}>粘贴阅读</button>
          <button className={surface === "reader" ? "active" : ""} onClick={() => setSurface("reader")}>文件阅读</button>
        </nav>
        <span className="privacy-badge">不保存内容</span>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">ADHD 便利阅读器</p>
        <h1>让一段文字，变得更容易开始。</h1>
        <p>保持原文和语言不变，只重新安排阅读节奏、层级与重点。</p>
      </section>

      <section className="control-strip" aria-label="阅读设置">
        <div className="mode-selector">
          <span>处理方式</span>
          <button className={formatMode === "local" ? "selected" : ""} onClick={() => setFormatMode("local")}>本地规则</button>
          <button className={formatMode === "ai" ? "selected" : ""} onClick={() => setFormatMode("ai")}>AI 语义提示</button>
          {formatMode === "ai" && (
            <select aria-label="AI 服务商" value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={!providers.length}>
              {providers.length ? providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label} · {provider.model}</option>) : <option>未配置服务商</option>}
            </select>
          )}
        </div>
        <div className="reading-controls">
          <label>字号 <input aria-label="字号" type="range" min="16" max="26" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label>
          <label>行距 <input aria-label="行距" type="range" min="1.45" max="2.2" step="0.05" value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} /></label>
          <label>宽度 <input aria-label="内容宽度" type="range" min="560" max="900" step="20" value={contentWidth} onChange={(event) => setContentWidth(Number(event.target.value))} /></label>
          <button type="button" className={wordFocusEnabled ? "selected" : ""} onClick={() => setWordFocusEnabled((enabled) => !enabled)}>{wordFocusEnabled ? "词首聚焦开启" : "词首聚焦关闭"}</button>
          <label>词首长度 <input aria-label="词首聚焦长度" type="range" min="30" max="60" value={wordFocusFixation} disabled={!wordFocusEnabled} onChange={(event) => setWordFocusFixation(Number(event.target.value))} /></label>
          <label>西文 <select aria-label="西文字体" value={latinFont} onChange={(event) => setLatinFont(event.target.value)}>{latinFontOptions.map((font) => <option value={font.id} key={font.id}>{font.label}</option>)}</select></label>
          <label>中文 <select aria-label="中文字体" value={cjkFont} onChange={(event) => setCjkFont(event.target.value)}>{cjkFontOptions.map((font) => <option value={font.id} key={font.id}>{font.label}</option>)}</select></label>
        </div>
      </section>

      <p className="status" aria-live="polite">{isFormatting ? `正在处理 · ${progress}%` : status}</p>

      {surface === "paste" ? (
        <form className="workspace paste-workspace" ref={pasteWorkspaceRef} style={splitStyle} onSubmit={handleFormat}>
          <section className="panel source-panel">
            <div className="panel-heading">
              <div><p className="step">01 原文</p><h2>粘贴你想读的内容</h2></div>
              <div className="format-toggle" role="group" aria-label="粘贴格式方式">
                <button type="button" className={preserveFormatting ? "active" : ""} onClick={() => setPreserveFormatting(true)}>保留格式</button>
                <button type="button" className={!preserveFormatting ? "active" : ""} onClick={resetToPlainText}>清洗文本</button>
              </div>
            </div>
            <p className="panel-note">保留格式会留下粗体、斜体、链接和列表；直接复制 PDF 时会自动合并视觉换行、断词连字符和丢失的句间空格。</p>
            <div
              className="editor source-editor"
              ref={inputRef}
              contentEditable
              role="textbox"
              aria-multiline="true"
              aria-label="原文输入区"
              suppressContentEditableWarning
              onInput={(event) => setInputHtml(event.currentTarget.innerHTML)}
              onPaste={handlePaste}
            />
            <div className="panel-actions">
              <button type="button" className="text-button" onClick={() => setEditorContent("<p></p>")}>清空</button>
              <span>{inputCharacterCount(inputHtml)} 字</span>
            </div>
          </section>

          <div
            className="workspace-divider split-handle"
            role="separator"
            tabIndex={0}
            aria-label="调整原文与便利阅读版的宽度"
            aria-orientation="vertical"
            aria-valuemin={minimumSplitPercent}
            aria-valuemax={maximumSplitPercent}
            aria-valuenow={splitPercent}
            aria-valuetext={`原文 ${splitPercent}% ，便利阅读版 ${100 - splitPercent}%`}
            onPointerDown={(event) => startSplitResize(event, pasteWorkspaceRef.current)}
            onKeyDown={handleSplitKeyboard}
          ><span aria-hidden="true"><i /><i /><i /></span></div>

          <section className="panel result-panel" style={readerStyle}>
            <div className="panel-heading">
              <div><p className="step">02 便利阅读版</p><h2>先看重点，再决定深入</h2></div>
              {outputHtml && <span className="editable-hint">可直接编辑</span>}
            </div>
            {outputHtml ? (
              <div ref={outputRef} className="editor reading-document" contentEditable role="textbox" aria-multiline="true" aria-label="可编辑的便利阅读结果" suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: outputHtml }} />
            ) : (
              <div className="empty-reader"><span className="empty-number">02</span><p>生成后会在这里呈现更清楚的阅读版本。</p></div>
            )}
            <div className="result-actions">
              <button type="button" className="primary-button" disabled={isFormatting} onClick={handleFormat}>{isFormatting ? "正在整理…" : "生成便利阅读版"}</button>
              <button type="button" className="secondary-button" disabled={!outputHtml} onClick={() => copyResult(outputRef)}>复制富文本</button>
              <button type="button" className="secondary-button" disabled={!outputHtml} onClick={() => outputHtml && downloadMarkdown("focus-reader.md", outputRef.current?.innerHTML ?? outputHtml)}>下载 .md</button>
            </div>
          </section>
        </form>
      ) : (
        <section className="file-workspace" style={readerStyle}>
          <div className="file-toolbar">
            <div><p className="step">文件阅读</p><h2>打开 Markdown 或 PDF</h2><p>文件仅在本次浏览器会话中处理，不会被保存。</p></div>
            <label className="file-button">选择文件<input type="file" accept=".md,.markdown,.pdf,text/markdown,application/pdf" onChange={handleFileChange} /></label>
          </div>
          {readerBlocks.length ? (
            <>
              <div className="reader-actions">
                <span>{readerFileName} · {readerKind === "pdf" ? `第 ${activePage} 页` : "Markdown"}</span>
                <div>
                  <button type="button" className="secondary-button" onClick={() => setSplitView((value) => !value)}>{splitView ? "只看便利版" : "显示分屏"}</button>
                  <button type="button" className="secondary-button" disabled={isFormatting} onClick={() => processReaderBlocks(readerBlocks, readerFileName)}>重新处理</button>
                  <button type="button" className="secondary-button" disabled={!readerOutputHtml} onClick={() => copyResult(readerOutputRef)}>复制富文本</button>
                  <button type="button" className="secondary-button" disabled={!readerOutputHtml} onClick={() => readerOutputHtml && downloadMarkdown("focus-reader-file.md", readerOutputRef.current?.innerHTML ?? readerOutputHtml)}>下载 .md</button>
                </div>
              </div>
              <div className={splitView ? "split-reader" : "single-reader"} ref={fileSplitRef} style={splitView ? splitStyle : undefined}>
                {splitView && <section className="reader-pane source-file-pane" aria-label="原始文件">{readerKind === "pdf" && pdfUrl ? <object className="pdf-viewer" key={`${pdfUrl}-${activePage}`} data={`${pdfUrl}#page=${activePage}`} type="application/pdf"><p>浏览器无法显示 PDF。你仍可在右侧阅读已提取的文字。</p></object> : <div className="reading-document source-document" dangerouslySetInnerHTML={{ __html: readerSourceHtml }} />}</section>}
                {splitView && <div
                  className="file-split-handle split-handle"
                  role="separator"
                  tabIndex={0}
                  aria-label="调整原始文件与便利阅读版的宽度"
                  aria-orientation="vertical"
                  aria-valuemin={minimumSplitPercent}
                  aria-valuemax={maximumSplitPercent}
                  aria-valuenow={splitPercent}
                  aria-valuetext={`原始文件 ${splitPercent}% ，便利阅读版 ${100 - splitPercent}%`}
                  onPointerDown={(event) => startSplitResize(event, fileSplitRef.current)}
                  onKeyDown={handleSplitKeyboard}
                ><span aria-hidden="true"><i /><i /><i /></span></div>}
                <section className="reader-pane convenience-pane" aria-label="便利阅读版">
                  {readerOutputHtml ? <div ref={readerOutputRef} className="editor reading-document" contentEditable role="textbox" aria-multiline="true" aria-label="可编辑的文件便利阅读结果" suppressContentEditableWarning onScroll={syncActivePage} dangerouslySetInnerHTML={{ __html: readerOutputHtml }} /> : <div className="empty-reader"><span className="empty-number">↗</span><p>文件正在处理。大文件会按段落或页面分块生成。</p></div>}
                </section>
              </div>
            </>
          ) : (
            <div className="drop-zone"><span>↗</span><h3>选择一个文件开始</h3><p>支持 Markdown，以及含可选择文字的 PDF。扫描件会提示暂不支持 OCR。</p></div>
          )}
        </section>
      )}

      <footer>Focus Reader 改善的是阅读呈现，不用于 ADHD 诊断或医疗建议。</footer>
    </main>
  );
}
