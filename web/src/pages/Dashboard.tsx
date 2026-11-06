import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, CalendarClock, Feather, Flame, Orbit, Sparkles } from "lucide-react";
import { api } from "../api";
import type { Stats, Sentence } from "../types";
import SentenceCard from "../components/SentenceCard";
import { useToast } from "../components/ui";
import { EmptyState, PageTitle, Skeleton, Stat } from "../components/ui";

export default function Dashboard() {
  const navigate = useNavigate();
  const { push } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [tagFilter, setTagFilter] = useState("");

  useEffect(() => {
    let alive = true;
    api.stats().then((s) => alive && setStats(s)).catch(() => {});
    api.sentences.tags().then((r) => alive && setTags(r.items)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api.sentences
      .list({ limit: 8, tag: tagFilter || undefined })
      .then((r) => alive && setSentences(r.items))
      .catch(() => alive && setSentences([]));
    return () => {
      alive = false;
    };
  }, [tagFilter]);

  const removeSentence = async (id: number) => {
    if (!confirm("删除这句摘抄？划线记录会一起删掉（单词条目保留在单词本里）。")) return;
    try {
      await api.sentences.remove(id);
      setSentences((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
      push("已删除这句摘抄", "ok");
      api.stats().then(setStats).catch(() => {});
    } catch (e) {
      push(e instanceof Error ? e.message : "删除失败", "err");
    }
  };

  const maxBar = useMemo(
    () => Math.max(1, ...(stats?.series ?? []).map((s) => s.count)),
    [stats],
  );

  return (
    <>
      <PageTitle
        eyebrow="COLLECTION"
        title="摘抄墙"
        desc="从 Slack 里捞出来的句子，划线、翻译、吃透；到期的会自动进复习队列。"
        right={
          <div className="flex items-center gap-2">
            <Link to="/review" className="btn">
              <CalendarClock size={14} />
              复习
              {stats?.due.total ? (
                <span className="rounded-full bg-amber-glow/20 px-1.5 text-[11px] text-amber-glow">
                  {stats.due.total}
                </span>
              ) : null}
            </Link>
            <Link to="/new" className="btn btn-primary">
              <Feather size={14} />
              新摘抄
            </Link>
          </div>
        }
      />

      {tags.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-paper-600">按标签：</span>
          <button
            onClick={() => setTagFilter("")}
            className={`chip transition ${tagFilter === "" ? "border-amber-glow/50 text-amber-glow" : ""}`}
          >
            全部
          </button>
          {tags.slice(0, 12).map((t) => (
            <button
              key={t.tag}
              onClick={() => setTagFilter(t.tag === tagFilter ? "" : t.tag)}
              className={`chip transition ${
                tagFilter === t.tag ? "border-amber-glow/50 text-amber-glow" : "hover:border-amber-glow/40"
              }`}
            >
              #{t.tag}
              <span className="text-paper-600">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* 数据条 */}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="单词" value={stats ? stats.words : "—"} hint="划过 / 记录过的词" />
        <Stat label="句子" value={stats ? stats.sentences : "—"} hint={`划线 ${stats?.annotations ?? 0} 处`} />
        <Stat label="待复习" value={stats ? stats.due.total : "—"} hint="今天该复习的条目" accent />
        <Stat
          label="连续"
          value={
            <span className="flex items-baseline gap-1">
              {stats ? stats.streak : "—"}
              <span className="text-[13px] text-paper-500">天</span>
            </span>
          }
          hint={stats ? `今日已复习 ${stats.reviews.today} 次` : undefined}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* 最近摘抄 */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="serif text-[17px] text-paper-100">最近的句子</h2>
            <Link to="/new" className="btn btn-ghost px-2 py-1 text-[12px]">
              去摘一句 <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-3.5">
            {sentences === null && (
              <>
                <Skeleton className="h-32" />
                <Skeleton className="h-28" />
              </>
            )}
            {sentences?.map((s) => (
              <SentenceCard key={s.id} sentence={s} onDelete={() => removeSentence(s.id)} />
            ))}
            {sentences && sentences.length === 0 && (
              <EmptyState
                icon={<Feather size={20} />}
                title="还没有摘抄"
                desc="把 Slack 里那句让你停下来的英文贴进来，系统会自动翻译，并为划线的词建词条。"
                action={
                  <button className="btn btn-primary" onClick={() => navigate("/new")}>
                    <Sparkles size={14} /> 摘第一句
                  </button>
                }
              />
            )}
          </div>
        </section>

        {/* 侧栏：复习节奏 + 入口 */}
        <aside className="space-y-3.5">
          <div className="panel px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="label">本周复习节奏</span>
              <span className="flex items-center gap-1 text-[11px] text-paper-600">
                <Flame size={12} className="text-amber-glow/70" /> {stats?.reviews.week ?? 0} 次
              </span>
            </div>
            <div className="flex h-[76px] items-end gap-2">
              {(stats?.series ?? Array.from({ length: 7 }, () => ({ day: "", count: 0 }))).map((d, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className={`w-full rounded-md transition-all ${
                      d.count > 0
                        ? "bg-gradient-to-t from-amber-deep/70 to-amber-glow"
                        : "veil-1"
                    }`}
                    style={{ height: `${Math.max(6, (d.count / maxBar) * 62)}px` }}
                    title={`${d.day}：${d.count} 次`}
                  />
                  <span className="text-[9px] text-paper-600">{d.day ? d.day.slice(5).replace("-", "/") : ""}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t hairline pt-3 text-[12px] leading-relaxed text-paper-500">
              到期：单词 <span className="text-paper-100">{stats?.due.words ?? 0}</span> · 句子{" "}
              <span className="text-paper-100">{stats?.due.sentences ?? 0}</span>
            </div>
            <button
              className="btn btn-primary mt-3 w-full py-2"
              onClick={() => navigate("/review")}
              disabled={!stats?.due.total}
            >
              {stats?.due.total ? `开始复习（${stats.due.total}）` : "今天没有到期内容"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <button
              className="panel panel-hover flex flex-col items-start gap-2 px-4 py-4 text-left"
              onClick={() => navigate("/words")}
            >
              <BookOpen size={18} className="text-amber-glow" />
              <span className="serif text-[15px] text-paper-100">单词本</span>
              <span className="text-[11px] leading-relaxed text-paper-600">A-Z 索引 · 随机翻牌</span>
            </button>
            <button
              className="panel panel-hover flex flex-col items-start gap-2 px-4 py-4 text-left"
              onClick={() => navigate("/words?mode=random")}
            >
              <Orbit size={18} className="text-sage" />
              <span className="serif text-[15px] text-paper-100">随机漫步</span>
              <span className="text-[11px] leading-relaxed text-paper-600">抽几个词看看还记得吗</span>
            </button>
          </div>

          <div className="panel px-5 py-4 text-[12px] leading-relaxed text-paper-500">
            <div className="mb-1.5 text-paper-300">数据在哪</div>
            SQLite 单文件 <span className="text-paper-300">data/wordnote.db</span>，整库拷走即可迁移；
            设置页可导出 JSON / DB。
          </div>
        </aside>
      </div>
    </>
  );
}
