import type { Annotation } from "../types";

type Props = {
  text: string;
  annotations: Annotation[];
  interactive?: boolean;
  onWordClick?: (surface: string, start: number, end: number, ann?: Annotation) => void;
  className?: string;
  /** 已划但尚未保存的词（录入页临时状态） */
  pending?: { start: number; end: number }[];
};

const WORD_RE = /[A-Za-z][A-Za-z'’\-]*/g;

/**
 * 句子渲染：英文单词逐个可点，已划词的单词带茶金色下划线。
 * 用字符偏移量对齐后端 annotations，避免富文本编辑器带来的同步问题。
 */
export default function SentenceText({
  text,
  annotations,
  interactive = false,
  onWordClick,
  className = "",
  pending = [],
}: Props) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  const findAnn = (start: number, end: number) =>
    annotations.find((a) => a.char_start === start && a.char_end === end) ||
    annotations.find((a) => a.char_start <= start && a.char_end >= end);
  const isPending = (start: number, end: number) =>
    pending.some((p) => p.start === start && p.end === end);

  for (const match of text.matchAll(WORD_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > cursor) parts.push(text.slice(cursor, start));
    const ann = findAnn(start, end);
    const marked = Boolean(ann) || isPending(start, end);
    parts.push(
      <span
        key={`${start}-${end}`}
        data-word={match[0]}
        className={
          interactive
            ? `${marked ? "marked-word" : "clickable-word"}`
            : marked
              ? "marked-word"
              : ""
        }
        onClick={
          onWordClick
            ? (e) => {
                e.stopPropagation();
                onWordClick(match[0], start, end, ann);
              }
            : undefined
        }
        role={onWordClick ? "button" : undefined}
        title={ann?.phonetic_us || ann?.phonetic_uk || undefined}
      >
        {match[0]}
      </span>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <p className={className}>{parts}</p>;
}
