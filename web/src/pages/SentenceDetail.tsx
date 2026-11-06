import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Languages,
  Pencil,
  ScanText,
  Sparkles,
  Trash2,
  Volume2,
} from "lucide-react";
import { api } from "../api";
import type { Annotation, Sentence } from "../types";
import SentenceText from "../components/SentenceText";
import { selectionOffsets, trimRange } from "../lib/selection";
import { Modal, PageTitle, PlayButton, Skeleton, Spinner, useToast } from "../components/ui";
import { useVoice } from "../auth";

const RATE = [
  { q: 0, label: "忘了", cls: "hover:!border-rose-400/50 hover:!bg-rose-400/10" },
  { q: 3, label: "吃力", cls: "hover:!border-amber-400/50 hover:!bg-amber-400/10" },
  { q: 4, label: "一般", cls: "hover:!border-emerald-400/40 hover:!bg-emerald-400/10" },
  { q: 5, label: "轻松", cls: "hover:!border-sky-400/40 hover:!bg-sky-400/10" },
];

export default function SentenceDetail() {
  const { id } = useParams();
  const sid = Number(id);
  const navigate = useNavigate();
  const { push } = useToast();
  const [voice] = useVoice();
  const [item, setItem] = useState<Sentence | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [marking, setMarking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState<Annotation | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [phraseSel, setPhraseSel] = useState<{ start: number; end: number; surface: string } | null>(null);
  const sentenceRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.sentences.get(sid);
      setItem(r.item);
      setDraft(r.item.translation ?? "");
      setTagDraft(r.item.tags.join(", "));
    } catch (e) {
      push(e instanceof Error ? e.message : "加载失败", "err");
    }
  }, [sid, push]);

  useEffect(() => {
    void load();
  }, [load]);

  const onWordClick = async (surface: string, start: number, end: number, ann?: Annotation) => {
    if (!item) return;
    if (ann) return setPeek(ann);
    if (!marking) return;
    setBusy(true);
    try {
      const r = await api.sentences.addAnnotation(item.id, { surface, char_start: start, char_end: end });
      setItem(r.item);
      push(`已划线：${surface}`, "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "划线失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const removeAnn = async (aid: number) => {
    if (!item) return;
    setBusy(true);
    try {
      const r = await api.sentences.removeAnnotation(item.id, aid);
      setItem(r.item);
      setPeek(null);
      push("已取消划线", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "操作失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const readSelection = () => {
    if (!marking || !item || !sentenceRef.current) return;
    const offs = selectionOffsets(sentenceRef.current);
    if (!offs) return;
    const trimmed = trimRange(item.text, offs.start, offs.end);
    if (!trimmed) {
      setPhraseSel(null);
      return;
    }
    const words = trimmed.surface.trim().split(/\s+/).filter(Boolean);
    // 只选中一个词时交给单击处理，避免和点击划词打架
    if (words.length < 2) {
      setPhraseSel(null);
      return;
    }
    setPhraseSel(trimmed);
  };

  const addPhrase = async () => {
    if (!item || !phraseSel) return;
    setBusy(true);
    try {
      const r = await api.sentences.addAnnotation(item.id, {
        surface: phraseSel.surface,
        char_start: phraseSel.start,
        char_end: phraseSel.end,
      });
      setItem(r.item);
      push(`已划线短语：${phraseSel.surface}`, "ok");
      setPhraseSel(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      push(e instanceof Error ? e.message : "短语划线失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const retranslate = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const r = await api.sentences.translate(item.id);
      setItem(r.item);
      setDraft(r.item.translation ?? "");
      push(`重新翻译完成（${r.provider}）`, "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "翻译失败，可能免费额度用完了", "err");
    } finally {
      setBusy(false);
    }
  };

  const saveTranslation = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const r = await api.sentences.patch(item.id, {
        translation: draft,
        tags: tagDraft.split(/[,，\s]+/).map((t) => t.replace(/^#/, "")).filter(Boolean),
      });
      setItem(r.item);
      setEditing(false);
      push("已保存", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "保存失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const grade = async (q: number) => {
    if (!item) return;
    try {
      const r = await api.sentences.grade(item.id, q);
      setItem(r.item);
      push(`已记录复习：${RATE.find((r0) => r0.q === q)?.label}`, "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "操作失败", "err");
    }
  };

  const remove = async () => {
    if (!item) return;
    if (!confirm("删除这句摘抄？划线记录会一起删掉（单词条目保留）。")) return;
    await api.sentences.remove(item.id);
    push("已删除", "ok");
    navigate("/");
  };

  const annWords = useMemo(() => item?.annotations.filter((a) => a.word_id) ?? [], [item]);

  if (!item) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <button className="btn btn-ghost px-2 text-[13px]" onClick={() => navigate("/")}>
          <ArrowLeft size={14} /> 返回摘抄墙
        </button>
        <div className="flex items-center gap-2">
          <button className={`btn py-1.5 text-[12px] ${marking ? "border-amber-glow/45 bg-amber-glow/10 text-amber-glow" : ""}`} onClick={() => { setMarking((m) => !m); setPhraseSel(null); }}>
            <ScanText size={13} /> {marking ? "划线模式：开" : "编辑划线"}
          </button>
          <PlayButton text={item.text} voice={voice} label="朗读整句" />
          <button className="btn py-1.5 text-[12px]" onClick={remove}>
            <Trash2 size={13} /> 删除
          </button>
        </div>
      </div>

      <article className="panel mb-5 px-6 py-6 sm:px-9 sm:py-8">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-paper-600">
          {item.source && <span className="chip">{item.source}</span>}
          {item.tags?.map((t) => (
            <span key={t} className="chip">
              #{t}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={11} />
            {new Date(item.created_at * 1000).toLocaleString("zh-CN", { hour12: false })}
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <Check size={11} /> 已复习 {item.reps} 次
          </span>
        </div>

        <div
          ref={sentenceRef}
          onMouseUp={readSelection}
          onTouchEnd={() => window.setTimeout(readSelection, 40)}
        >
          <SentenceText
            text={item.text}
            annotations={item.annotations}
            interactive={marking}
            onWordClick={onWordClick}
            className="serif text-[22px] leading-[1.8] text-paper-50 sm:text-[26px] sm:leading-[1.75]"
          />
        </div>

        {phraseSel && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-glow/35 bg-amber-glow/[0.08] px-3 py-2">
            <span className="text-[12px] text-amber-glow">已选中「{phraseSel.surface}」</span>
            <button className="btn btn-primary px-3 py-1 text-[12px]" onClick={addPhrase} disabled={busy}>
              <ScanText size={12} /> 标为短语
            </button>
            <button
              className="btn btn-ghost px-2 py-1 text-[11px]"
              onClick={() => {
                setPhraseSel(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              取消
            </button>
          </div>
        )}

        {marking && (
          <div className="mt-4 rounded-xl border border-dashed border-amber-glow/25 bg-amber-glow/[0.04] px-3 py-2 text-[12px] leading-relaxed text-amber-glow/80">
            划线模式：<b>点单个词</b>＝划这个词；<b>按住拖动选中多个词</b>（如 free up / to do）松手后点「标为短语」。
            已划的词点击可看释义。再点一次「编辑划线」退出。
          </div>
        )}

        {/* 译文 */}
        <div className="mt-6 rounded-2xl border hairline sunken px-4 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">对照翻译</span>
            <div className="flex items-center gap-1.5">
              <button className="btn btn-ghost px-2 py-1 text-[11px]" onClick={retranslate} disabled={busy}>
                {busy ? <Spinner size={11} /> : <Languages size={11} />} 重新翻译
              </button>
              <button className="btn btn-ghost px-2 py-1 text-[11px]" onClick={() => (editing ? saveTranslation() : setEditing(true))}>
                {editing ? <Check size={11} /> : <Pencil size={11} />} {editing ? "保存" : "修改"}
              </button>
            </div>
          </div>
          {editing ? (
            <textarea className="input min-h-[72px] resize-y text-[14px] leading-relaxed" value={draft} onChange={(e) => setDraft(e.target.value)} />
          ) : (
            <p className="text-[14px] leading-[1.9] text-paper-200">
              {item.translation || <span className="text-paper-600">（暂无翻译，可点「重新翻译」或手动修改）</span>}
            </p>
          )}
        </div>

        {/* 复习评分 */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-paper-600">这句还记得吗：</span>
          {RATE.map((r) => (
            <button key={r.q} onClick={() => grade(r.q)} className={`btn px-3 py-1.5 text-[12px] ${r.cls}`}>
              {r.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-paper-600">
            {item.interval_days > 0 ? `下次约 ${item.interval_days.toFixed(1)} 天后` : "首次复习"}
          </span>
        </div>
      </article>

      {/* 划词详解 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="serif text-[17px] text-paper-100">
            划线词详解 <span className="text-paper-600">{annWords.length}</span>
          </h2>
          <span className="inline-flex items-center gap-1 text-[11px] text-paper-600">
            <Sparkles size={12} /> 每个词都有音标 · 释义 · 发音
          </span>
        </div>
        <div className="grid gap-3.5 md:grid-cols-2">
          {annWords.map((a) => (
            <div key={a.id} className="panel panel-hover px-4 py-3.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link to={`/words/${a.word_id}`} className="serif text-[19px] text-amber-glow hover:underline">
                      {a.headword || a.surface}
                    </Link>
                    {(a.phonetic_us || a.phonetic_uk) && (
                      <span className="text-[11px] text-paper-500">/{String(a.phonetic_us || a.phonetic_uk).replace(/^\/|\/$/g, "")}/</span>
                    )}
                    {a.pos && <span className="chip py-0 text-[10px]">{a.pos}</span>}
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-paper-400">
                    {a.meaning_zh || "（暂无释义）"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-center gap-1.5">
                  <PlayButton text={a.headword || a.surface} voice={voice} size="sm" />
                  <button
                    className="text-[10px] text-paper-600 hover:text-rose-300"
                    onClick={() => a.id && removeAnn(a.id)}
                    title="取消划线"
                  >
                    取消
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 border-t hairline pt-2 text-[11px] text-paper-600">
                <Link to={`/words/${a.word_id}`} className="hover:text-paper-200">
                  查看词条 →
                </Link>
                <span className="text-paper-700">·</span>
                <span>原词：{a.surface}</span>
              </div>
            </div>
          ))}
          {annWords.length === 0 && (
            <div className="panel px-4 py-8 text-center text-[12px] text-paper-600 md:col-span-2">
              这句还没有划线词。点右上角「编辑划线」，再点句子里的单词即可。
            </div>
          )}
        </div>
      </section>

      {/* 标签编辑 */}
      <div className="panel mt-5 flex flex-wrap items-center gap-3 px-5 py-3.5">
        <span className="label">标签</span>
        <input className="input w-auto min-w-[220px] flex-1 py-1.5 text-[12px]" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="daily, 职场, 文学" />
        <button className="btn py-1.5 text-[12px]" onClick={saveTranslation} disabled={busy}>
          <Check size={12} /> 保存标签
        </button>
      </div>

      <Modal open={!!peek} onClose={() => setPeek(null)} title={peek?.headword || peek?.surface || ""} width="max-w-sm">
        {peek && (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-paper-500">
                {peek.phonetic_us ? `美 /${peek.phonetic_us}/` : peek.phonetic_uk ? `英 /${peek.phonetic_uk}/` : ""}
              </span>
              <PlayButton text={peek.headword || peek.surface} voice={voice} size="sm" />
              <Volume2 size={12} className="text-paper-600" />
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-paper-300">{peek.meaning_zh || "（暂无释义）"}</p>
            <div className="mt-4 flex gap-2">
              <Link to={`/words/${peek.word_id}`} className="btn btn-primary flex-1 py-2 text-[12px]">
                打开完整词条
              </Link>
              <button className="btn py-2 text-[12px]" onClick={() => peek.id && removeAnn(peek.id)}>
                取消划线
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
