import type { Annotation } from "../types";

type Props = {
  text: string;
  annotations: Annotation[];
  interactive?: boolean;
  onWordClick?: (surface: string, start: number, end: number, ann?: Annotation) => void;
  className?: string;
};

const WORD_RE = /[A-Za-z][A-Za-z'’\-]*/g;

type Block =
  | { kind: "ann"; ann: Annotation; start: number; end: number }
  | { kind: "plainWord"; text: string; start: number }
  | { kind: "plainText"; text: string };

function buildBlocks(text: string, annotations: Annotation[]): Block[] {
  const sorted = [...annotations]
    .filter((a) => a.char_start >= 0 && a.char_end > a.char_start && a.char_end <= text.length)
    .sort((a, b) => a.char_start - b.char_start);

  const blocks: Block[] = [];
  let cursor = 0;
  const pushPlain = (from: number, to: number) => {
    if (to <= from) return;
    const chunk = text.slice(from, to);
    let last = 0;
    for (const m of chunk.matchAll(WORD_RE)) {
      const at = m.index ?? 0;
      if (at > last) blocks.push({ kind: "plainText", text: chunk.slice(last, at) });
      blocks.push({ kind: "plainWord", text: m[0], start: from + at });
      last = at + m[0].length;
    }
    if (last < chunk.length) blocks.push({ kind: "plainText", text: chunk.slice(last) });
  };

  for (const ann of sorted) {
    if (ann.char_start < cursor) continue; // 重叠的旧标注跳过
    pushPlain(cursor, ann.char_start);
    blocks.push({ kind: "ann", ann, start: ann.char_start, end: ann.char_end });
    cursor = ann.char_end;
  }
  pushPlain(cursor, text.length);
  return blocks;
}

/**
 * 句子渲染：单词可点；已划线的词（含 free up 这类短语）作为**一个整体**渲染，
 * 这样多词短语的下划线是连续的，点击也按整条短语处理。
 */
export default function SentenceText({
  text,
  annotations,
  interactive = false,
  onWordClick,
  className = "",
}: Props) {
  const blocks = buildBlocks(text, annotations);

  return (
    <p className={className} data-sentence-root>
      {blocks.map((block, i) => {
        if (block.kind === "plainText") return <span key={i}>{block.text}</span>;

        if (block.kind === "ann") {
          const surface = text.slice(block.start, block.end);
          return (
            <span
              key={i}
              data-word={surface}
              className="marked-word"
              onClick={
                onWordClick
                  ? (e) => {
                      e.stopPropagation();
                      onWordClick(surface, block.start, block.end, block.ann);
                    }
                  : undefined
              }
              title={block.ann.phonetic_us || block.ann.phonetic_uk || undefined}
            >
              {surface}
            </span>
          );
        }

        const start = block.start;
        const end = start + block.text.length;
        return (
          <span
            key={i}
            data-word={block.text}
            className={interactive ? "clickable-word" : ""}
            onClick={
              onWordClick
                ? (e) => {
                    e.stopPropagation();
                    onWordClick(block.text, start, end);
                  }
                : undefined
            }
            role={onWordClick ? "button" : undefined}
          >
            {block.text}
          </span>
        );
      })}
    </p>
  );
}
