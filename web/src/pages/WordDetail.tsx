import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  GitBranch,
  History,
  Languages,
  Pencil,
  RefreshCw,
  ScanLine,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import type { Word } from "../types";
import { Modal, PageTitle, PlayButton, Skeleton, Spinner, useToast } from "../components/ui";
import Senses from "../components/Senses";
import { useVoice } from "../auth";

const RATE = [
  { q: 0, label: "忘了" },
  { q: 3, label: "吃力" },
  { q: 4, label: "一般" },
  { q: 5, label: "轻松" },
];

export default function WordDetail() {
  const { id } = useParams();
  const wid = Number(id);
  const navigate = useNavigate();
  const { push } = useToast();
  const [voice] = useVoice();
  const [word, setWord] = useState<Word | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState("");
  const [editingMeaning, setEditingMeaning] = useState(false);
  const [meaning, setMeaning] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [showAi, setShowAi] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.words.get(wid);
      setWord(r.item);
      setNote(r.item.note || "");
      setMeaning(r.item.meaning_zh || "");
    } catch (e) {
      push(e instanceof Error ? e.message : "加载失败", "err");
    }
  }, [wid, push]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      await api.words.refresh(wid);
      await load();
      push("词条已刷新", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "刷新失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    setBusy(true);
    try {
      await api.words.patch(wid, { note });
      await load();
      setEditingNote(false);
      push("笔记已保存", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "保存失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const saveMeaning = async () => {
    setBusy(true);
    try {
      await api.words.patch(wid, { meaning_zh: meaning });
      await load();
      setEditingMeaning(false);
      push("释义已保存", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "保存失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const grade = async (q: number) => {
    try {
      await api.words.grade(wid, q);
      await load();
      push(`已记录：${RATE.find((r) => r.q === q)?.label}`, "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "操作失败", "err");
    }
  };

  const remove = async () => {
    await api.words.remove(wid);
    push("已从单词本移除", "ok");
    navigate("/words");
  };

  if (!word) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const dict = word.dict;
  const phonetic = word.phonetic_us || word.phonetic_uk || dict?.phonetic_us || dict?.phonetic_uk;
  const forms = { ...(dict?.forms || {}), ...(word.forms || {}) };
  const examples = word.examples ?? [];
  const sources = word.sentences ?? [];

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <button className="btn btn-ghost px-2 text-[13px]" onClick={() => navigate("/words")}>
          <ArrowLeft size={14} /> 单词本
        </button>
        <div className="flex items-center gap-2">
          <button className="btn py-1.5 text-[12px]" onClick={refresh} disabled={busy}>
            {busy ? <Spinner size={12} /> : <RefreshCw size={12} />} 刷新词条
          </button>
          <button className="btn py-1.5 text-[12px]" onClick={() => setConfirmDel(true)}>
            <Trash2 size={12} /> 移除
          </button>
        </div>
      </div>

      {/* 词头 */}
      <div className="panel mb-5 px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <h1 className="serif text-[38px] leading-none tracking-tight text-paper-50 sm:text-[46px]">{word.headword}</h1>
          <div className="flex items-center gap-2 pb-1">
            <PlayButton text={word.headword} voice={voice} size="lg" />
            {phonetic && (
              <span className="text-[13px] text-paper-500">/{String(phonetic).replace(/^\/|\/$/g, "")}/</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
            {word.pos && <span className="chip">{word.pos}</span>}
            {dict?.level && <span className="chip text-amber-glow/90">{dict.level}</span>}
            {dict?.source === "ecdict" && <span className="chip text-sage">离线词库</span>}
            {word.lookup_state === "pending" && (
              <span className="chip border-amber-glow/30 text-amber-glow">待补齐 · 联网后自动重查</span>
            )}
            {word.base_form && word.base_form !== word.headword && (
              <span className="chip">
                原形 <span className="text-paper-100">{word.base_form}</span>
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 pb-1 text-[11px] text-paper-600">
            <History size={12} /> {word.reps ? `复习 ${word.reps} 次` : "新词"}
            {word.interval_days > 0 && <span>· 间隔 {word.interval_days.toFixed(1)} 天</span>}
          </div>
        </div>

        {/* 释义 */}
        <div className="mt-5 border-t hairline pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">释义</span>
            <button className="btn btn-ghost px-2 py-1 text-[11px]" onClick={() => (editingMeaning ? saveMeaning() : setEditingMeaning(true))}>
              {editingMeaning ? <Check size={11} /> : <Pencil size={11} />} {editingMeaning ? "保存" : "编辑"}
            </button>
          </div>
          {editingMeaning ? (
            <textarea className="input min-h-[70px] text-[13px] leading-relaxed" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
          ) : (
            <div className="space-y-1.5">
              {dict?.senses?.length ? (
                <Senses
                  text={dict.senses
                    .map((s) => `${s.pos ? s.pos + " " : ""}${s.defs.join("；")}`)
                    .join("；")}
                />
              ) : (
                <p className="text-[13px] leading-relaxed text-paper-400">{word.meaning_zh || "（暂无中文释义，可手动补）"}</p>
              )}
            </div>
          )}
        </div>

        {/* 我的笔记 */}
        <div className="mt-4 border-t hairline pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">我的笔记</span>
            <button className="btn btn-ghost px-2 py-1 text-[11px]" onClick={() => (editingNote ? saveNote() : setEditingNote(true))}>
              {editingNote ? <Check size={11} /> : <Pencil size={11} />} {editingNote ? "保存" : "写点什么"}
            </button>
          </div>
          {editingNote ? (
            <textarea
              className="input min-h-[64px] text-[13px] leading-relaxed"
              placeholder="为什么记它？在哪个语境见到的？和哪个词容易混？"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          ) : (
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-paper-300">
              {word.note || <span className="text-paper-600">还没有笔记。</span>}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          {/* 词形变化 */}
          {Object.keys(forms).length > 0 && (
            <section className="panel px-5 py-4">
              <div className="mb-3 flex items-center gap-1.5">
                <GitBranch size={13} className="text-amber-glow" />
                <h2 className="serif text-[16px] text-paper-100">词形变化</h2>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(forms).map(([k, v]) => (
                  <div key={k} className="rounded-xl border hairline veil-1 px-3 py-2">
                    <div className="text-[10px] text-paper-600">{k}</div>
                    <div className="serif mt-0.5 flex items-center justify-between text-[14px] text-paper-100">
                      {v}
                      <PlayButton text={String(v)} voice={voice} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 我的出处 */}
          {sources.length > 0 && (
            <section className="panel px-5 py-4">
              <div className="mb-3 flex items-center gap-1.5">
                <BookOpen size={13} className="text-amber-glow" />
                <h2 className="serif text-[16px] text-paper-100">我的出处</h2>
                <span className="text-[11px] text-paper-600">在 {sources.length} 句里划过它</span>
              </div>
              <div className="space-y-2.5">
                {sources.map((s) => (
                  <Link
                    key={s.id}
                    to={`/sentences/${s.id}`}
                    className="block rounded-xl border hairline veil-1 px-3.5 py-2.5 transition hv-line hv-veil"
                  >
                    <p className="serif text-[14.5px] leading-relaxed text-paper-100">{s.text}</p>
                    {s.translation && <p className="mt-1 text-[12px] leading-relaxed text-paper-500">{s.translation}</p>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* 例句 */}
          {examples.length > 0 && (
            <section className="panel px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ScanLine size={13} className="text-amber-glow" />
                  <h2 className="serif text-[16px] text-paper-100">例句</h2>
                </div>
                <span className="text-[11px] text-paper-600">{examples.length} 条 · 含双语/真题</span>
              </div>
              <ul className="space-y-3">
                {examples.map((ex) => (
                  <li key={ex.id} className="border-l-2 hairline pl-3">
                    <div className="flex items-start gap-2">
                      <p className="serif flex-1 text-[14.5px] leading-relaxed text-paper-200">{ex.en}</p>
                      <PlayButton text={ex.en} voice={voice} size="sm" />
                    </div>
                    {ex.zh && <p className="mt-1 text-[12.5px] leading-relaxed text-paper-500">{ex.zh}</p>}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-paper-600">
                      <span className="chip py-0 text-[10px]">{ex.source === "sentence" ? "我的句子" : ex.source}</span>
                      {ex.sentence_id && (
                        <Link to={`/sentences/${ex.sentence_id}`} className="hover:text-paper-300">
                          查看原句 →
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 英英释义 */}
          {dict?.defs_en?.length ? (
            <section className="panel px-5 py-4">
              <div className="mb-3 flex items-center gap-1.5">
                <Languages size={13} className="text-sage" />
                <h2 className="serif text-[16px] text-paper-100">英英释义</h2>
              </div>
              <ul className="space-y-2.5">
                {dict.defs_en.map((d, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-paper-300">
                    {d.pos && <span className="mr-1.5 text-sage/90">{d.pos}</span>}
                    {d.def}
                    {d.synonyms?.length ? (
                      <span className="ml-2 text-[11px] text-paper-600">近义：{d.synonyms.slice(0, 6).join(", ")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* 右栏 */}
        <div className="space-y-5">
          {/* 复习 */}
          <section className="panel px-5 py-4">
            <div className="label mb-2.5">这条还记得吗</div>
            <div className="grid grid-cols-4 gap-1.5">
              {RATE.map((r) => (
                <button key={r.q} className="btn px-1 py-2 text-[12px]" onClick={() => grade(r.q)}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="mt-3 text-[11px] leading-relaxed text-paper-600">
              {word.due_at
                ? word.due_at <= Math.floor(Date.now() / 1000)
                  ? "已到期，随时可以复习"
                  : `下次复习：${new Date(word.due_at * 1000).toLocaleDateString("zh-CN")}`
                : "尚未排期"}
              {word.interval_days ? `（间隔 ${word.interval_days.toFixed(1)} 天，ease ${word.ease.toFixed(2)}）` : ""}
            </div>
          </section>

          {/* 同义词 / 词组 / 同根词 */}
          {dict?.synonyms?.length ? (
            <section className="panel px-5 py-4">
              <div className="label mb-2.5">同义词</div>
              <div className="space-y-2">
                {dict.synonyms.map((g, i) => (
                  <div key={i} className="text-[12.5px] leading-relaxed">
                    {g.pos && <span className="mr-1 text-paper-600">{g.pos}</span>}
                    <span className="text-paper-200">{g.words.join(" · ")}</span>
                    {g.tran && <span className="ml-1.5 text-paper-600">{g.tran}</span>}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {dict?.phrases?.length ? (
            <section className="panel px-5 py-4">
              <div className="label mb-2.5">常用词组</div>
              <div className="space-y-1.5">
                {dict.phrases.slice(0, 8).map((p, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="serif text-paper-100">{p.phrase}</span>
                    <span className="text-paper-500">{p.zh}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {dict?.word_family?.length ? (
            <section className="panel px-5 py-4">
              <div className="label mb-2.5">同根词</div>
              <div className="flex flex-wrap gap-1.5">
                {dict.word_family.flatMap((g, i) =>
                  g.words.map((w, j) => (
                    <span key={`${i}-${j}`} className="chip">
                      <span className="text-paper-200">{w.word}</span>
                      {w.zh && <span className="text-paper-600">{w.zh}</span>}
                    </span>
                  )),
                )}
              </div>
            </section>
          ) : null}

          {/* 词源 / AI 讲解 */}
          {dict?.ai_note ? (
            <section className="panel px-5 py-4">
              <button className="flex w-full items-center justify-between" onClick={() => setShowAi((v) => !v)}>
                <span className="label">AI 讲解 / 搭配</span>
                <ChevronDown size={14} className={`text-paper-600 transition ${showAi ? "rotate-180" : ""}`} />
              </button>
              {showAi && (
                <p className="mt-3 whitespace-pre-line text-[12.5px] leading-[1.9] text-paper-400">{dict.ai_note}</p>
              )}
            </section>
          ) : null}

          {dict?.etymology?.length ? (
            <section className="panel px-5 py-4">
              <div className="label mb-2.5">词源</div>
              <div className="space-y-2">
                {dict.etymology.slice(0, 2).map((e, i) => (
                  <p key={i} className="text-[12px] leading-relaxed text-paper-400">
                    {e.text}
                    {e.source && <span className="ml-1 text-paper-600">（{e.source}）</span>}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {dict?.web_meanings?.length ? (
            <section className="panel px-5 py-4">
              <div className="label mb-2.5">网络释义</div>
              <div className="flex flex-wrap gap-1.5">
                {dict.web_meanings.map((w, i) => (
                  <span key={i} className="chip">
                    {w.value}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <div className="panel px-5 py-4 text-[11px] leading-relaxed text-paper-600">
            <div className="mb-1 text-paper-400">词条来源</div>
            {dict?.source === "youdao" ? "有道词典公开接口" : dict?.source === "dictionaryapi" ? "dictionaryapi.dev" : "本地记录"}
            <br />
            抓取时间：{dict?.fetched_at ? new Date(dict.fetched_at * 1000).toLocaleString("zh-CN", { hour12: false }) : "—"}
          </div>
        </div>
      </div>

      <Modal open={confirmDel} onClose={() => setConfirmDel(false)} title="从单词本移除？" width="max-w-sm">
        <p className="text-[13px] leading-relaxed text-paper-400">
          会同时删除它的词典快照与例句；句子里的划线会解除（句子本身保留）。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => setConfirmDel(false)}>
            取消
          </button>
          <button className="btn border-rose-400/40 bg-rose-500/15 text-rose-200" onClick={remove}>
            <Trash2 size={13} /> 移除
          </button>
        </div>
      </Modal>
    </>
  );
}
