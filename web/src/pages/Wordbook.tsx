import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Dices, Plus, Search, Shuffle, Trash2, X } from "lucide-react";
import { api } from "../api";
import type { Word } from "../types";
import { EmptyState, Modal, PageTitle, PlayButton, Skeleton, Spinner, useToast } from "../components/ui";
import { useVoice } from "../auth";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
type Mode = "az" | "random" | "recent";

export default function Wordbook() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const [voice] = useVoice();
  const [mode, setMode] = useState<Mode>((params.get("mode") as Mode) || "az");
  const [letter, setLetter] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Word[] | null>(null);
  const [letters, setLetters] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.words.list({
        mode,
        letter: mode === "az" && letter ? letter : undefined,
        q: q.trim() || undefined,
        limit: mode === "random" ? 36 : 120,
      });
      setItems(r.items);
      setLetters(r.letters);
      setTotal(r.total);
    } catch (e) {
      push(e instanceof Error ? e.message : "加载失败", "err");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [mode, letter, q, push, seed]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q) { setMode("az"); setLetter(""); }
    }, 260);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    params.get("mode") ? setMode(params.get("mode") as Mode) : null;
  }, [params]);

  const changeMode = (m: Mode) => {
    setMode(m);
    setParams(m === "az" ? {} : { mode: m });
  };

  const removeWord = async (id: number, headword: string) => {
    if (!confirm(`把「${headword}」从单词本移出？按词条删除，例句一起删；句子里的划线会解除但句子保留。`)) return;
    try {
      await api.words.remove(id);
      setItems((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
      push(`已移出：${headword}`, "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "删除失败", "err");
    }
  };

  const addWord = async () => {
    if (!newWord.trim()) return;
    setSaving(true);
    try {
      const { item } = await api.words.create(newWord.trim());
      push(`已加入：${item.headword}`, "ok");
      setAdding(false);
      setNewWord("");
      navigate(`/words/${item.id}`);
    } catch (e) {
      push(e instanceof Error ? e.message : "保存失败", "err");
    } finally {
      setSaving(false);
    }
  };

  const letterCount = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(letters).forEach(([ch, n]) => {
      const upper = ch.toUpperCase();
      if (/[A-Z]/.test(upper)) map[upper] = (map[upper] ?? 0) + n;
      else map["#"] = (map["#"] ?? 0) + n;
    });
    return map;
  }, [letters]);

  return (
    <>
      <PageTitle
        eyebrow="LEXICON"
        title="单词本"
        desc="划过线的、单独记过的词都在这里；鼠标悬停看一眼释义，点开是完整词条。"
        right={
          <div className="flex gap-2">
            <button className="btn" onClick={() => setSeed((s) => s + 1)}>
              <Shuffle size={14} /> 换一批
            </button>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={14} /> 加单词
            </button>
          </div>
        }
      />

      {/* 工具条 */}
      <div className="panel mb-4 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-paper-600" />
          <input
            className="input pl-9 py-2 text-[13px]"
            placeholder="搜单词或中文释义…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-paper-600 hover:text-paper-200" onClick={() => setQ("")}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-xl border hairline veil-1 p-1">
          {(
            [
              { id: "az", label: "A-Z", icon: Search },
              { id: "random", label: "随机", icon: Dices },
              { id: "recent", label: "最近", icon: Plus },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => changeMode(m.id)}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] transition ${
                mode === m.id ? "veil-3 text-paper-50" : "text-paper-500 hover:text-paper-200"
              }`}
            >
              <m.icon size={12} />
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-paper-600">
          共 {total} 词{loading ? " · 加载中" : ""}
        </span>
      </div>

      {/* 字母索引 */}
      {mode === "az" && (
        <div className="mb-5 flex flex-wrap gap-1">
          <button
            onClick={() => setLetter("")}
            className={`h-8 rounded-lg border px-2.5 text-[12px] transition ${
              letter === ""
                ? "border-amber-glow/50 bg-amber-glow/15 text-amber-glow"
                : "hairline veil-1 text-paper-300 hv-line hover:text-paper-50"
            }`}
          >
            全部
          </button>
          {LETTERS.map((l) => {
            const n = letterCount[l] ?? 0;
            const active = letter === l;
            return (
              <button
                key={l}
                onClick={() => setLetter(l)}
                disabled={!n && !active}
                className={`relative h-8 w-8 rounded-lg border text-[12px] transition ${
                  active
                    ? "border-amber-glow/50 bg-amber-glow/15 text-amber-glow"
                    : n
                      ? "hairline veil-1 text-paper-300 hv-line hover:text-paper-50"
                      : "border-transparent text-paper-700"
                }`}
              >
                {l}
              </button>
            );
          })}
          {letterCount["#"] ? (
            <button
              onClick={() => setLetter("#")}
              className={`h-8 rounded-lg border px-2 text-[12px] ${
                letter === "#" ? "border-amber-glow/50 bg-amber-glow/15 text-amber-glow" : "hairline text-paper-300"
              }`}
            >
              #
            </button>
          ) : null}
        </div>
      )}

      {/* 卡片墙 */}
      {items === null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Search size={20} />}
          title={q ? `没有匹配「${q}」的词` : "这里还很空"}
          desc="在句子详情页点词划线，或者点右上角「加单词」单独记一个。"
          action={
            <Link to="/new" className="btn btn-primary">
              <Plus size={14} /> 去记一个
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AnimatePresence mode="popLayout">
            {items.map((w, i) => (
              <motion.div
                key={`${w.id}-${mode === "random" ? seed : 0}`}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.22, delay: Math.min(i * 0.012, 0.2) }}
              >
                <WordTile
                  word={w}
                  voice={voice}
                  onOpen={() => navigate(`/words/${w.id}`)}
                  onDelete={() => removeWord(w.id, w.headword)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="加一个单词" width="max-w-sm">
        <p className="mb-3 text-[12px] leading-relaxed text-paper-500">
          会自动拉取音标、中文释义、词形变化和例句；保存后进入词详情。
        </p>
        <input
          className="input serif text-[17px]"
          placeholder="serendipity"
          value={newWord}
          autoFocus
          onChange={(e) => setNewWord(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addWord()}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn" onClick={() => setAdding(false)}>
            取消
          </button>
          <button className="btn btn-primary" onClick={addWord} disabled={saving}>
            {saving ? <Spinner size={13} /> : <Plus size={13} />} 保存
          </button>
        </div>
      </Modal>
    </>
  );
}

function WordTile({
  word,
  onOpen,
  onDelete,
  voice,
}: {
  word: Word;
  onOpen: () => void;
  onDelete: () => void;
  voice: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="panel panel-hover group relative cursor-pointer overflow-hidden px-4 py-3.5"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="serif truncate text-[19px] leading-tight text-paper-50">{word.headword}</div>
          <div className="mt-1 h-4 text-[11px] text-paper-500">
            {word.phonetic_us || word.phonetic_uk ? (
              <span>/{String(word.phonetic_us || word.phonetic_uk).replace(/^\/|\/$/g, "")}/</span>
            ) : (
              <span className="text-paper-700">—</span>
            )}
          </div>
        </div>
        <span className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          <button
            className="grid h-8 w-8 place-items-center rounded-full text-paper-600 transition hover:bg-rose-500/15 hover:text-rose-300"
            title="从单词本移出"
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </button>
          <PlayButton text={word.headword} voice={voice} size="sm" />
        </span>
      </div>

      <div
        className={`mt-1.5 overflow-hidden text-[11.5px] leading-relaxed text-paper-400 transition-all duration-300 ${
          hover ? "max-h-28" : "max-h-9"
        }`}
      >
        {word.pos && <span className="mr-1 text-amber-glow/80">{word.pos}</span>}
        <span className={hover ? "" : "line-clamp-2"}>{word.meaning_zh || "（暂无释义）"}</span>
      </div>

      <div className="mt-2 flex items-center gap-2 text-[10px] text-paper-600">
        <span>{word.reps ? `复习 ${word.reps} 次` : "新词"}</span>
        {word.base_form && word.base_form !== word.headword && <span>· 原形 {word.base_form}</span>}
      </div>
    </div>
  );
}
