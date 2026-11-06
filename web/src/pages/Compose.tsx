import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eraser, Languages, Loader2, Save, Search, Sparkles, Wand2 } from "lucide-react";
import { api } from "../api";
import type { Dict } from "../types";
import { PageTitle, PlayButton, Spinner, useToast } from "../components/ui";
import { selectionOffsets, trimRange } from "../lib/selection";

type Mark = { surface: string; char_start: number; char_end: number };

export default function Compose() {
  const navigate = useNavigate();
  const { push } = useToast();
  const [tab, setTab] = useState<"sentence" | "word">("sentence");

  return (
    <>
      <PageTitle
        eyebrow="CAPTURE"
        title="新摘抄"
        desc="整句贴进来，点一下单词就划线；保存时自动翻译、自动建词条。"
      />
      <div className="mb-5 inline-flex rounded-xl border hairline veil-1 p-1">
        {[
          { id: "sentence", label: "句子", icon: Sparkles },
          { id: "word", label: "单词", icon: Search },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] transition ${
              tab === t.id ? "veil-3 text-paper-50" : "text-paper-500 hover:text-paper-100"
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sentence" ? <SentenceComposer onSaved={(id) => navigate(`/sentences/${id}`)} /> : <WordComposer onSaved={(id) => navigate(`/words/${id}`)} />}
    </>
  );
}

function SentenceComposer({ onSaved }: { onSaved: (id: number) => void }) {
  const { push } = useToast();
  const [text, setText] = useState("");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [source, setSource] = useState("slack");
  const [tags, setTags] = useState("");
  const [translation, setTranslation] = useState("");
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [preview, setPreview] = useState<Record<string, Dict | "loading" | "error">>({});
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [phraseSel, setPhraseSel] = useState<{ start: number; end: number; surface: string } | null>(null);
  const previewRef = useRef<HTMLParagraphElement>(null);

  const keyOf = (surface: string) => surface.toLowerCase();

  const fetchPreview = async (surface: string) => {
    const key = keyOf(surface);
    if (preview[key]) return;
    setPreview((p) => ({ ...p, [key]: "loading" }));
    try {
      const { item } = await api.words.lookup(surface);
      setPreview((p) => ({ ...p, [key]: item }));
    } catch {
      setPreview((p) => ({ ...p, [key]: "error" }));
    }
  };

  const toggleWord = (surface: string, start: number, end: number) => {
    setMarks((prev) => {
      const exists = prev.some((m) => m.char_start === start && m.char_end === end);
      if (exists) return prev.filter((m) => !(m.char_start === start && m.char_end === end));
      void fetchPreview(surface);
      return [...prev, { surface, char_start: start, char_end: end }];
    });
  };

  const readSelection = () => {
    if (!previewRef.current) return;
    const offs = selectionOffsets(previewRef.current);
    if (!offs) return;
    const trimmed = trimRange(text, offs.start, offs.end);
    if (!trimmed) {
      setPhraseSel(null);
      return;
    }
    const words = trimmed.surface.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) {
      setPhraseSel(null);
      return;
    }
    setPhraseSel(trimmed);
  };

  const addPhraseMark = () => {
    if (!phraseSel) return;
    const mark = { surface: phraseSel.surface, char_start: phraseSel.start, char_end: phraseSel.end };
    setMarks((prev) =>
      prev.some((m) => m.char_start === mark.char_start && m.char_end === mark.char_end) ? prev : [...prev, mark],
    );
    void fetchPreview(mark.surface);
    setPhraseSel(null);
    window.getSelection()?.removeAllRanges();
  };

  const translateNow = async () => {
    if (!text.trim()) return;
    setTranslating(true);
    try {
      const r = await api.translate(text.trim(), true);
      setTranslation(r.translation);
      push(`已翻译（${r.provider}）`, "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "翻译失败", "err");
    } finally {
      setTranslating(false);
    }
  };

  const save = async () => {
    if (!text.trim()) return push("先把句子贴进来", "err");
    setBusy(true);
    try {
      const res = await api.sentences.create({
        text: text.trim(),
        translation: translation.trim() || undefined,
        source: source.trim() || undefined,
        tags: tags.split(/[,，\s]+/).map((t) => t.replace(/^#/, "")).filter(Boolean),
        annotations: marks,
        auto_translate: autoTranslate && !translation.trim(),
        auto_lookup: true,
      });
      res.warnings?.forEach((w) => push(w, "info"));
      push(res.duplicate ? "已打开原有记录" : "已保存，词条也建好了", "ok");
      onSaved(res.item.id);
    } catch (e) {
      push(e instanceof Error ? e.message : "保存失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const words = useMemo(() => text.match(/[A-Za-z][A-Za-z'’\-]*/g)?.length ?? 0, [text]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-4">
        <div className="panel px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">原句（English）</span>
            <span className="text-[11px] text-paper-600">{words} 个词 · 点单词即可划线</span>
          </div>
          <textarea
            className="input min-h-[120px] resize-y bg-transparent border-0 px-0 serif text-[19px] leading-[1.7] focus:!shadow-none"
            placeholder="把这句英文贴进来，比如：He lingered by the window long after she had gone…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMarks([]);
              setPreview({});
            }}
          />
          {text.trim() && (
            <div className="mt-3 rounded-xl border border-dashed hairline sunken px-4 py-3">
              <div className="mb-1.5 text-[11px] text-paper-600">在上一步输入框里点词不方便？在下面这行里点：</div>
              <p
                ref={previewRef}
                className="serif text-[19px] leading-[1.75] text-paper-50"
                onMouseUp={readSelection}
                onTouchEnd={() => window.setTimeout(readSelection, 40)}
              >
                {renderInteractive(text, marks, toggleWord)}
              </p>
              {phraseSel && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-amber-glow">已选中「{phraseSel.surface}」</span>
                  <button className="btn btn-primary px-2.5 py-1 text-[11px]" onClick={addPhraseMark}>
                    加入划线
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
            </div>
          )}
        </div>

        <div className="panel px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">中文翻译</span>
            <button className="btn btn-ghost px-2 py-1 text-[12px]" onClick={translateNow} disabled={translating || !text.trim()}>
              {translating ? <Spinner size={12} /> : <Languages size={12} />} 立即翻译
            </button>
          </div>
          <textarea
            className="input min-h-[64px] resize-y text-[13px] leading-relaxed"
            placeholder="可留空：保存时会自动用 MyMemory 翻译"
            value={translation}
            onChange={(e) => setTranslation(e.target.value)}
          />
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-paper-500">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-amber-glow"
              checked={autoTranslate}
              onChange={(e) => setAutoTranslate(e.target.checked)}
            />
            保存时自动翻译（免费翻译接口，结果会缓存进库）
          </label>
        </div>

        <div className="panel flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="block min-w-[140px] flex-1">
            <span className="mb-1.5 block text-[12px] text-paper-500">出处</span>
            <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="slack / 某本书 / 播客" />
          </label>
          <label className="block min-w-[160px] flex-[1.5]">
            <span className="mb-1.5 block text-[12px] text-paper-500">标签（逗号分隔）</span>
            <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="daily, 生活, 职场" />
          </label>
          <button className="btn btn-primary py-2.5" onClick={save} disabled={busy}>
            {busy ? <Spinner size={14} /> : <Save size={14} />}
            保存摘抄
          </button>
        </div>
      </div>

      {/* 右侧：划线词预览 */}
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="serif text-[17px] text-paper-100">
            划线词 <span className="text-paper-600">{marks.length}</span>
          </h2>
          {marks.length > 0 && (
            <button className="btn btn-ghost px-2 py-1 text-[12px]" onClick={() => setMarks([])}>
              <Eraser size={12} /> 清空
            </button>
          )}
        </div>
        {marks.length === 0 && (
          <div className="panel px-4 py-6 text-center text-[12px] leading-relaxed text-paper-600">
            在左边句子里点一下单词，就会在这里生成词条预览。
            <br />
            保存后自动进单词本，并带音标、释义、例句和发音。
          </div>
        )}
        {marks.map((m) => {
          const data = preview[keyOf(m.surface)];
          const short = !data || data === "loading" || data === "error" ? "" : data.senses?.[0]?.defs?.[0] ?? "";
          const phonetic = !data || data === "loading" || data === "error" ? "" : data.phonetic_us || data.phonetic_uk;
          return (
            <div key={`${m.char_start}-${m.char_end}`} className="panel px-4 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="serif text-[17px] text-amber-glow">{m.surface}</span>
                    {phonetic && <span className="text-[11px] text-paper-500">/{String(phonetic).replace(/^\/|\/$/g, "")}/</span>}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-paper-500">
                    {data === "loading" ? "查词中…" : data === "error" ? "词典查询失败，保存后仍会建词条" : short || "（无释义，可保存后手动补）"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <PlayButton text={m.surface} size="sm" />
                  <button className="btn btn-ghost px-2 py-1 text-[11px]" onClick={() => setMarks((p) => p.filter((x) => x !== m))}>
                    去掉
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div className="panel px-4 py-3 text-[11px] leading-relaxed text-paper-600">
          <div className="mb-1 text-paper-400">小贴士</div>
          划线会自动分词保存位置，之后在详情页还能再点词补划或取消。
          划过的词如果只是变形（lingered / lingering），词详情里会显示原形与词形变化。
        </div>
      </aside>
    </div>
  );
}

function renderInteractive(text: string, marks: Mark[], toggle: (s: string, a: number, b: number) => void) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  const re = /[A-Za-z][A-Za-z'’\-]*/g;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const marked = marks.some((x) => x.char_start === start && x.char_end === end);
    nodes.push(
      <span
        key={`${start}-${end}`}
        role="button"
        data-word={m[0]}
        data-offset={start}
        onClick={() => toggle(m[0], start, end)}
        className={marked ? "marked-word" : "clickable-word"}
      >
        {m[0]}
      </span>,
    );
    cursor = end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function WordComposer({ onSaved }: { onSaved: (id: number) => void }) {
  const { push } = useToast();
  const [word, setWord] = useState("");
  const [note, setNote] = useState("");
  const [dict, setDict] = useState<Dict | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const lookup = async () => {
    const w = word.trim();
    if (!w) return;
    setLoading(true);
    try {
      const { item } = await api.words.lookup(w);
      setDict(item);
    } catch (e) {
      push(e instanceof Error ? e.message : "查询失败", "err");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!word.trim()) return;
    setSaving(true);
    try {
      const { item } = await api.words.create(word.trim(), note.trim() || undefined);
      push("已加入单词本", "ok");
      onSaved(item.id);
    } catch (e) {
      push(e instanceof Error ? e.message : "保存失败", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <div className="panel px-5 py-4">
          <span className="label">单词 / 短语</span>
          <div className="mt-2 flex gap-2">
            <input
              ref={inputRef}
              className="input serif text-[18px]"
              placeholder="serendipity"
              value={word}
              onChange={(e) => {
                setWord(e.target.value);
                setDict(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
              autoFocus
            />
            <button className="btn" onClick={lookup} disabled={loading}>
              {loading ? <Spinner size={14} /> : <Search size={14} />} 查词
            </button>
          </div>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[12px] text-paper-500">备注（可选）</span>
            <textarea className="input min-h-[60px] text-[13px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="为什么记它 / 在什么语境下见到" />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button className="btn btn-primary" onClick={save} disabled={saving || !word.trim()}>
              {saving ? <Spinner size={14} /> : <Save size={14} />} 加入单词本
            </button>
            <span className="text-[11px] text-paper-600">保存时会重新拉一次词典快照并入库</span>
          </div>
        </div>

        <div className="panel px-5 py-4">
          <div className="label mb-2">词典预览</div>
          {!dict && <div className="py-8 text-center text-[12px] text-paper-600">输入单词后按 Enter 或点「查词」</div>}
          {dict && (
            <div>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="serif text-[26px] text-paper-50">{dict.base_form || dict.headword}</span>
                {dict.phonetic_uk && <span className="text-[12px] text-paper-500">英 /{dict.phonetic_uk}/</span>}
                {dict.phonetic_us && <span className="text-[12px] text-paper-500">美 /{dict.phonetic_us}/</span>}
                <PlayButton text={dict.base_form || dict.headword} size="sm" />
                {dict.level && <span className="chip">{dict.level}</span>}
              </div>
              <div className="mt-3 space-y-1.5">
                {dict.senses?.map((s, i) => (
                  <div key={i} className="text-[13px] leading-relaxed text-paper-300">
                    {s.pos && <span className="mr-1.5 text-amber-glow/90">{s.pos}</span>}
                    {s.defs.join("；")}
                  </div>
                ))}
              </div>
              {Object.keys(dict.forms || {}).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(dict.forms).map(([k, v]) => (
                    <span key={k} className="chip">
                      {k} <span className="text-paper-100">{v}</span>
                    </span>
                  ))}
                </div>
              )}
              {dict.examples?.slice(0, 2).map((ex, i) => (
                <div key={i} className="mt-3 border-l-2 hairline pl-3">
                  <div className="flex items-start gap-2">
                    <p className="serif flex-1 text-[14px] leading-relaxed text-paper-200">{ex.en}</p>
                    <PlayButton text={ex.en} size="sm" />
                  </div>
                  {ex.zh && <p className="mt-0.5 text-[12px] text-paper-500">{ex.zh}</p>}
                </div>
              ))}
              {dict.source === "none" && (
                <div className="mt-3 rounded-lg border border-amber-glow/20 bg-amber-glow/[0.06] px-3 py-2 text-[12px] text-amber-glow/90">
                  词典没收录这个词，保存后可以手动补释义。
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <aside className="panel h-fit px-5 py-4 text-[12px] leading-relaxed text-paper-500">
        <div className="mb-2 flex items-center gap-1.5 text-paper-200">
          <Wand2 size={13} className="text-amber-glow" /> 词条里会有什么
        </div>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>英/美音标、考试级别（四六级等）</li>
          <li>中文释义（按词性分组）</li>
          <li>词形变化：三单 / 过去式 / 过去分词 / 现在分词 / 复数</li>
          <li>双语例句 + 真题例句 + 柯林斯例句</li>
          <li>同义词、常用词组、同根词、词源</li>
          <li>你自己的出处句子（在哪句里划的它）</li>
        </ul>
        <div className="mt-4 border-t hairline pt-3 text-[11px] text-paper-600">
          数据源：有道词典公开接口（中文释义 / 真题例句）+ dictionaryapi.dev 兜底。
          全部免费、无需 Key，抓取结果会存进本地库，断网也能看历史词条。
        </div>
      </aside>
    </div>
  );
}
