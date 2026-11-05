import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Eye, RotateCcw, Sparkles, Trash2, Trophy } from "lucide-react";
import { api } from "../api";
import type { ReviewItem } from "../types";
import SentenceText from "../components/SentenceText";
import Senses from "../components/Senses";
import { PageTitle, PlayButton, Skeleton, Spinner, useToast } from "../components/ui";
import { useVoice } from "../auth";

const GRADES = [
  { q: 0, label: "忘了", hint: "<10 分钟", cls: "hover:!border-rose-400/50 hover:!bg-rose-500/10" },
  { q: 3, label: "吃力", hint: "~1 天", cls: "hover:!border-amber-400/50 hover:!bg-amber-500/10" },
  { q: 4, label: "一般", hint: "~3 天", cls: "hover:!border-emerald-400/40 hover:!bg-emerald-500/10" },
  { q: 5, label: "轻松", hint: "~7 天", cls: "hover:!border-sky-400/40 hover:!bg-sky-500/10" },
];

export default function Review() {
  const navigate = useNavigate();
  const { push } = useToast();
  const [voice] = useVoice();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [due, setDue] = useState({ words: 0, sentences: 0, total: 0 });

  const load = useCallback(async () => {
    setItems(null);
    try {
      const r = await api.review.queue("all", 24);
      setItems(r.items);
      setDue(r.due);
    } catch (e) {
      push(e instanceof Error ? e.message : "加载失败", "err");
      setItems([]);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = items?.[idx];

  const grade = useCallback(
    async (q: number) => {
      if (!current || busy) return;
      setBusy(true);
      try {
        await api.review.grade(current.kind, current.id!, q);
        setDone((d) => d + 1);
        setRevealed(false);
        if (items && idx + 1 < items.length) setIdx(idx + 1);
        else setItems([]);
      } catch (e) {
        push(e instanceof Error ? e.message : "记录失败", "err");
      } finally {
        setBusy(false);
      }
    },
    [current, busy, items, idx, push],
  );

  const dismiss = async () => {
    if (!current) return;
    const label = current.kind === "word" ? `把「${current.headword}」从单词本移出？` : "删除这句摘抄（划线一起删）？";
    if (!confirm(label)) return;
    setBusy(true);
    try {
      if (current.kind === "word") await api.words.remove(current.id!);
      else await api.sentences.remove(current.id!);
      push(current.kind === "word" ? "已移出单词本" : "已删除摘抄", "ok");
      setRevealed(false);
      setItems((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
    } catch (e) {
      push(e instanceof Error ? e.message : "删除失败", "err");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.code === "Space") {
        e.preventDefault();
        setRevealed(true);
      }
      if (["1", "2", "3", "4"].includes(e.key)) void grade(GRADES[Number(e.key) - 1].q);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, grade]);

  if (items === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!current) {
    return (
      <>
        <PageTitle eyebrow="REVIEW" title="复习" />
        <div className="panel mx-auto max-w-lg px-6 py-12 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-amber-glow/25 bg-amber-glow/10 text-amber-glow">
            <Trophy size={22} />
          </div>
          <h2 className="serif text-xl text-paper-50">{done > 0 ? "这一轮过完了" : "今天没有到期内容"}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-paper-500">
            {done > 0 ? `刚才复习了 ${done} 条，下次到期会自动出现。` : `到期：单词 ${due.words} · 句子 ${due.sentences}`}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button className="btn" onClick={() => load()}>
              <RotateCcw size={13} /> 再查一次
            </button>
            <button className="btn btn-primary" onClick={() => navigate("/words")}>
              <Sparkles size={13} /> 逛逛单词本
            </button>
          </div>
        </div>
      </>
    );
  }

  const total = items.length;
  const progress = total ? ((idx + (revealed ? 0.4 : 0)) / total) * 100 : 0;
  const isWord = current.kind === "word";

  return (
    <>
      <PageTitle
        eyebrow="REVIEW"
        title="复习"
        desc="先在心里过一遍，再翻面；诚实评一下难度，间隔由算法排。"
        right={
          <div className="flex items-center gap-1 text-[11px] text-paper-600">
            <kbd className="rounded border hairline px-1.5 py-0.5">空格</kbd> 翻面
            <kbd className="ml-1 rounded border hairline px-1.5 py-0.5">1–4</kbd> 评分
          </div>
        }
      />

      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="text-[11px] text-paper-600">
            {idx + 1} / {total}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full veil-2">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-amber-deep to-amber-glow"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <span className="chip text-[10px]">{isWord ? "单词" : "句子"}</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={`${current.kind}-${current.id}`}
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.99 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="panel px-6 py-7 sm:px-8 sm:py-9"
          >
            {isWord ? (
              <div>
                <div className="flex flex-wrap items-end gap-3">
                  <h2 className="serif text-[36px] leading-none text-paper-50">{current.headword}</h2>
                  <PlayButton text={current.headword!} voice={voice} size="md" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-paper-500">
                  {(current.phonetic_us || current.phonetic_uk) && (
                    <span>/{String(current.phonetic_us || current.phonetic_uk).replace(/^\/|\/$/g, "")}/</span>
                  )}
                  {current.pos && <span className="chip py-0 text-[10px]">{current.pos}</span>}
                  {current.base_form && current.base_form !== current.headword && (
                    <span className="chip py-0 text-[10px]">原形 {current.base_form}</span>
                  )}
                </div>

                {!revealed ? (
                  <button className="btn mt-8 w-full py-3" onClick={() => setRevealed(true)}>
                    <Eye size={14} /> 翻面看释义（空格）
                  </button>
                ) : (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 space-y-4">
                    <Senses text={current.meaning_zh || ""} pos={current.pos} />
                    {Object.keys(current.forms || {}).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(current.forms || {}).map(([k, v]) => (
                          <span key={k} className="chip">
                            {k} <span className="text-paper-100">{v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {current.example?.en && (
                      <div className="rounded-xl border hairline sunken px-4 py-3">
                        <div className="flex items-start gap-2">
                          <p className="serif flex-1 text-[14px] leading-relaxed text-paper-200">{current.example.en}</p>
                          <PlayButton text={current.example.en} voice={voice} size="sm" />
                        </div>
                        {current.example.zh && <p className="mt-1 text-[12px] text-paper-500">{current.example.zh}</p>}
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            ) : (
              <div>
                <SentenceText
                  text={current.text!}
                  annotations={current.annotations ?? []}
                  className="serif text-[21px] leading-[1.8] text-paper-50"
                />
                <div className="mt-3 flex items-center gap-2">
                  <PlayButton text={current.text!} voice={voice} />
                  <span className="text-[11px] text-paper-600">{current.annotations?.length ?? 0} 个划线词</span>
                </div>
                {!revealed ? (
                  <button className="btn mt-6 w-full py-3" onClick={() => setRevealed(true)}>
                    <Eye size={14} /> 翻面看译文（空格）
                  </button>
                ) : (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 rounded-xl border hairline sunken px-4 py-3">
                    <p className="text-[13.5px] leading-[1.9] text-paper-300">{current.translation || "（这句没有译文）"}</p>
                  </motion.div>
                )}
              </div>
            )}

            <div className="mt-7 grid grid-cols-4 gap-1.5 border-t hairline pt-4">
              {GRADES.map((g) => (
                <button key={g.q} className={`btn flex-col gap-0 px-1 py-2 ${g.cls}`} onClick={() => grade(g.q)} disabled={busy}>
                  <span className="text-[12.5px]">{g.label}</span>
                  <span className="text-[9.5px] text-paper-600">{g.hint}</span>
                </button>
              ))}
            </div>
            <div className="mt-1 flex justify-end">
              <button
                className="btn btn-ghost px-2 py-1 text-[11px] text-paper-600 hover:text-rose-300"
                onClick={dismiss}
                disabled={busy}
                title="已经学会了，不想再复习"
              >
                <Trash2 size={11} /> 已掌握，移出{isWord ? "单词本" : "摘抄"}
              </button>
            </div>
            {busy && (
              <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-paper-600">
                <Spinner size={11} /> 记录中…
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-4 flex items-center justify-between text-[11px] text-paper-600">
          <button className="btn btn-ghost px-2 py-1 text-[11px]" onClick={() => navigate(-1)}>
            <ArrowLeft size={11} /> 返回
          </button>
          <span>
            到期：单词 {due.words} · 句子 {due.sentences} · 本轮已过 {done}
          </span>
        </div>
      </div>
    </>
  );
}
