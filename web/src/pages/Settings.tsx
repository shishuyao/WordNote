import { useEffect, useRef, useState } from "react";
import {
  CloudOff,
  Monitor,
  Moon,
  Sun,
  SunMoon,
  Database,
  Download,
  HardDriveDownload,
  KeyRound,
  RefreshCw,
  Archive,
  Mic,
  ShieldCheck,
  Trash2,
  Upload,
  Waves,
} from "lucide-react";
import { api } from "../api";
import type { OfflineStatus, TtsStatus } from "../types";
import { PageTitle, PlayButton, Spinner, useToast } from "../components/ui";
import { useVoice } from "../auth";
import { THEME_LABELS, useTheme, type ThemeMode } from "../theme";

const fmtBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default function SettingsPage() {
  const { push } = useToast();
  const [voice, setVoice] = useVoice();
  const { mode: themeMode, resolved: themeResolved, setMode: setThemeMode } = useTheme();
  const [voices, setVoices] = useState<{ id: string; label: string }[]>([]);
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [extra, setExtra] = useState<Awaited<ReturnType<typeof api.extra>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [importing, setImporting] = useState(false);
  const [offline, setOffline] = useState<OfflineStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadAll = async () => {
    try {
      const [v, s, e, o] = await Promise.all([
        api.tts.voices(),
        api.tts.status(),
        api.extra(),
        api.offline.status(),
      ]);
      setVoices(v.items);
      setStatus(s);
      setExtra(e);
      setOffline(o);
      if (!localStorage.getItem("wn.voice") && v.default) setVoice(v.default);
    } catch (err) {
      push(err instanceof Error ? err.message : "加载失败", "err");
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickVoice = async (v: string) => {
    setVoice(v);
    try {
      await api.settings.put({ voice: v });
    } catch {
      /* 本地生效即可 */
    }
  };

  const clearAudio = async () => {
    setBusy(true);
    try {
      const r = await api.tts.clearCache();
      push(`清掉了 ${r.removed} 个音频缓存`, "ok");
      await loadAll();
    } catch (e) {
      push(e instanceof Error ? e.message : "操作失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const retryPending = async () => {
    setBusy(true);
    try {
      const r = await api.offline.retry(10);
      push(`补全了 ${r.fixed} 个词条（剩余 ${r.remaining}）`, "ok");
      await loadAll();
    } catch (err) {
      push(err instanceof Error ? err.message : "补全失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const prewarmAll = async () => {
    setBusy(true);
    try {
      const r = await api.offline.prewarm();
      if (!r.scheduled) return push("没有需要预合成的文本", "info");
      push(`已排入 ${r.scheduled} 条预合成（音色 ${r.voice}），后台慢慢跑`, "ok");
    } catch (err) {
      push(err instanceof Error ? err.message : "预合成失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const changePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.changePassword(oldPwd, newPwd);
      setOldPwd("");
      setNewPwd("");
      push("密码已更新", "ok");
    } catch (err) {
      push(err instanceof Error ? err.message : "修改失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (file: File) => {
    setImporting(true);
    try {
      const data = JSON.parse(await file.text());
      const r = await api.importJson(data);
      push(`导入完成：单词 ${r.imported.words}，句子 ${r.imported.sentences}，划线 ${r.imported.annotations}`, "ok");
      await loadAll();
    } catch (err) {
      push(err instanceof Error ? err.message : "导入失败（需要 wordnote 导出的 JSON）", "err");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <PageTitle eyebrow="SETTINGS" title="设置" desc="发音、数据迁移、账号。数据全部在本机，随时可以整套拷走。" />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 发音 */}
        <section className="panel px-5 py-5">
          <div className="mb-4 flex items-center gap-1.5">
            <Waves size={14} className="text-amber-glow" />
            <h2 className="serif text-[16px] text-paper-100">英文发音 · Supertonic 3</h2>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`chip ${status?.alive ? "border-emerald-400/30 text-emerald-300" : "border-rose-400/30 text-rose-300"}`}>
              {status ? (status.alive ? "服务在线" : "服务离线（会回退 CLI）") : "检测中…"}
            </span>
            <span className="chip">{status?.model_loaded ? "模型已加载" : "模型未加载"}</span>
            <span className="chip">44.1 kHz · 10 音色</span>
            <span className="chip">缓存 {status ? `${status.cache.files} 条 / ${fmtBytes(status.cache.bytes)}` : "—"}</span>
          </div>

          <label className="label mb-2 block">默认音色</label>
          <div className="mb-3 flex gap-2">
            <select className="input" value={voice} onChange={(e) => pickVoice(e.target.value)}>
              {voices.map((v) => (
                <option key={v.id} value={v.id} className="bg-ink-900">
                  {v.label}
                </option>
              ))}
            </select>
            <PlayButton text="Serendipity is the art of making happy accidents." voice={voice} size="md" label="试听" />
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-paper-600">
            发音走后端 <code className="text-paper-400">{status?.server || "127.0.0.1:8090"}</code> 的 audiocpp 常驻服务，
            同一句/同一个词只会合成一次，之后直接读本地 WAV。
          </p>
          <div className="flex gap-2">
            <button className="btn py-1.5 text-[12px]" onClick={loadAll} disabled={busy}>
              {busy ? <Spinner size={12} /> : <Mic size={12} />} 重新检测
            </button>
            <button className="btn py-1.5 text-[12px]" onClick={clearAudio} disabled={busy}>
              <Trash2 size={12} /> 清空音频缓存
            </button>
          </div>
        </section>

        {/* 数据迁移 */}
        <section className="panel px-5 py-5">
          <div className="mb-4 flex items-center gap-1.5">
            <Database size={14} className="text-sage" />
            <h2 className="serif text-[16px] text-paper-100">数据与迁移</h2>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-xl border hairline veil-1 px-3 py-2">
              <div className="text-paper-600">数据库</div>
              <div className="mt-0.5 truncate text-paper-200" title={extra?.db_path}>
                {extra ? fmtBytes(extra.db_bytes) : "—"}
              </div>
            </div>
            <div className="rounded-xl border hairline veil-1 px-3 py-2">
              <div className="text-paper-600">单词 / 缓存</div>
              <div className="mt-0.5 text-paper-200">
                {extra?.words ?? "—"} 词 · {extra?.lookup_cache ?? "—"} 词典缓存
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="btn py-1.5 text-[12px]" href={api.exportJsonUrl()}>
              <Download size={12} /> 导出 JSON
            </a>
            <a className="btn py-1.5 text-[12px]" href={api.exportDbUrl()}>
              <HardDriveDownload size={12} /> 导出 SQLite
            </a>
            <button className="btn py-1.5 text-[12px]" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? <Spinner size={12} /> : <Upload size={12} />} 导入 JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-paper-600">
            迁移到别的机器：把整个 <code className="text-paper-400">data/</code> 目录（含 wordnote.db 与 audio 缓存）拷过去即可，
            secret.key 一起拷走可保持登录态；只拷 .db 也能用，重新登录一次即可。
          </p>
        </section>

        {/* 离线能力 */}
        <section className="panel px-5 py-5">
          <div className="mb-4 flex items-center gap-1.5">
            <CloudOff size={14} className="text-sage" />
            <h2 className="serif text-[16px] text-paper-100">离线能力</h2>
            <span className="chip ml-1 py-0 text-[10px]">断公网也能用</span>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-xl border hairline veil-1 px-3 py-2">
              <div className="text-paper-600">离线词库</div>
              <div className="mt-0.5 text-paper-200">
                {offline ? (offline.ecdict.available ? `${offline.ecdict.count.toLocaleString()} 词` : "未安装") : "—"}
              </div>
              <div className="text-[10px] text-paper-600">{offline?.ecdict.available ? fmtBytes(offline.ecdict.bytes) : "跑 scripts/import_ecdict.py"}</div>
            </div>
            <div className="rounded-xl border hairline veil-1 px-3 py-2">
              <div className="text-paper-600">发音缓存</div>
              <div className="mt-0.5 text-paper-200">{offline ? `${offline.audio.files} 条` : "—"}</div>
              <div className="text-[10px] text-paper-600">{offline ? fmtBytes(offline.audio.bytes) : ""}</div>
            </div>
            <div className="rounded-xl border hairline veil-1 px-3 py-2">
              <div className="text-paper-600">待补齐词条</div>
              <div className="mt-0.5 text-paper-200">{offline ? offline.pending_words : "—"}</div>
              <div className="text-[10px] text-paper-600">查词失败会自动重试</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn py-1.5 text-[12px]" onClick={retryPending} disabled={busy}>
              {busy ? <Spinner size={12} /> : <RefreshCw size={12} />} 补全待查词条
            </button>
            <button className="btn py-1.5 text-[12px]" onClick={prewarmAll} disabled={busy}>
              <Mic size={12} /> 预合成全部发音
            </button>
            <a className="btn py-1.5 text-[12px]" href={api.offline.bundleUrl()}>
              <Archive size={12} /> 导出离线包（db + 词库 + 音频）
            </a>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-paper-600">
            断网时：已摘抄的句子、译文、词条、例句、发音全部可用；<span className="text-paper-400">新词</span>用本地 ECDICT 查中文释义/音标/词形（<span className="text-paper-400">无例句</span>）；
            <span className="text-paper-400">新句译文</span>需手填。彻底离线可在启动前设 <code className="text-paper-400">WORDNOTE_OFFLINE=1</code>。
          </p>
        </section>

        {/* 外观 */}
        <section className="panel px-5 py-5">
          <div className="mb-4 flex items-center gap-1.5">
            <SunMoon size={14} className="text-amber-glow" />
            <h2 className="serif text-[16px] text-paper-100">外观</h2>
            <span className="chip ml-1 py-0 text-[10px]">
              当前：{themeResolved === "dark" ? "深色（墨）" : "浅色（暖纸）"}
            </span>
          </div>
          <div className="flex gap-2">
            {(["system", "light", "dark"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setThemeMode(m)}
                className={`btn flex-1 py-2 text-[12px] ${
                  themeMode === m ? "border-amber-glow/50 bg-amber-glow/10 text-amber-glow" : ""
                }`}
              >
                {m === "system" ? <Monitor size={12} /> : m === "light" ? <Sun size={12} /> : <Moon size={12} />}
                {THEME_LABELS[m]}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-paper-600">
            深色是「墨」，浅色是「暖纸」；顶部也有个太阳/月亮按钮可以一键切换。
            选择记在本机浏览器，不跟随账号同步。
          </p>
        </section>

        {/* 账号 */}
        <section className="panel px-5 py-5">
          <div className="mb-4 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-amber-glow" />
            <h2 className="serif text-[16px] text-paper-100">账号</h2>
          </div>
          <form onSubmit={changePwd} className="space-y-2.5">
            <label className="block">
              <span className="mb-1 block text-[12px] text-paper-500">当前密码</span>
              <input type="password" className="input" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} required />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] text-paper-500">新密码（至少 6 位）</span>
              <input type="password" className="input" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} required minLength={6} />
            </label>
            <button className="btn btn-primary py-2 text-[12px]" disabled={busy}>
              {busy ? <Spinner size={12} /> : <KeyRound size={12} />} 更新密码
            </button>
          </form>
        </section>

        {/* 说明 */}
        <section className="panel px-5 py-5 text-[12px] leading-relaxed text-paper-500">
          <div className="mb-3 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-sage" />
            <h2 className="serif text-[16px] text-paper-100">关于</h2>
          </div>
          <ul className="ml-4 list-disc space-y-1">
            <li>句子翻译：MyMemory（免费、免 Key），结果落库缓存</li>
            <li>词条：有道词典公开接口 + dictionaryapi.dev 兜底</li>
            <li>发音：Supertonic 3（audiocpp，44.1kHz，10 音色）</li>
            <li>存储：SQLite 单文件 + WAV 缓存，纯本地可迁移</li>
            <li>复习：SM-2 简化版，按期自动排队</li>
          </ul>
          <p className="mt-3 text-[11px] text-paper-600">
            当前访问地址：<span className="text-paper-300">{typeof window !== "undefined" ? window.location.origin : "-"}</span> · 服务常驻由计划任务保证（见 scripts/）。
          </p>
        </section>
      </div>
    </>
  );
}
