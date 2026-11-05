import { useNavigate } from "react-router-dom";
import { Bookmark, CalendarDays, Trash2 } from "lucide-react";
import type { Sentence } from "../types";
import SentenceText from "./SentenceText";
import { PlayButton } from "./ui";

const fmt = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });

export default function SentenceCard({
  sentence,
  compact = false,
  onDelete,
}: {
  sentence: Sentence;
  compact?: boolean;
  onDelete?: () => void;
}) {
  const navigate = useNavigate();
  const open = () => navigate(`/sentences/${sentence.id}`);
  const words = sentence.annotations?.filter((a) => a.headword) ?? [];

  return (
    <article
      onClick={open}
      className="panel panel-hover group cursor-pointer px-5 py-4 sm:px-6 sm:py-5"
    >
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-paper-600">
        {sentence.source && (
          <span className="inline-flex items-center gap-1">
            <Bookmark size={11} /> {sentence.source}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <CalendarDays size={11} /> {fmt(sentence.created_at)}
        </span>
        {sentence.tags?.map((t) => (
          <span key={t} className="chip px-2 py-0 text-[10px]">
            #{t}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5">
          {onDelete && (
            <button
              className="grid h-7 w-7 place-items-center rounded-full text-paper-600 opacity-100 transition hover:bg-rose-500/15 hover:text-rose-300 sm:opacity-0 sm:group-hover:opacity-100"
              title="删除这句摘抄"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
          <PlayButton text={sentence.text} size="sm" />
        </span>
      </div>

      <SentenceText
        text={sentence.text}
        annotations={sentence.annotations}
        onWordClick={() => open()}
        className={`serif ${compact ? "text-[19px] leading-[1.65]" : "text-[21px] leading-[1.7]"} text-paper-50`}
      />

      {sentence.translation && (
        <p className="mt-3 line-clamp-2 border-l-2 hairline pl-3 text-[13px] leading-relaxed text-paper-500">
          {sentence.translation}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        {words.slice(0, 6).map((w) => (
          <span key={w.id} className="chip">
            {w.headword}
            {w.phonetic_us ? <span className="text-paper-600">{w.phonetic_us}</span> : null}
          </span>
        ))}
        {words.length > 6 && <span className="text-[11px] text-paper-600">+{words.length - 6}</span>}
        {!words.length && <span className="text-[11px] text-paper-600">还没有划线词</span>}
        <span className="ml-auto text-[11px] text-paper-600 opacity-0 transition group-hover:opacity-100">
          打开 →
        </span>
      </div>
    </article>
  );
}
