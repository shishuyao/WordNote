import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, KeyRound, Quote, UserRound } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Spinner } from "../components/ui";

export default function Login() {
  const { authenticated, setupRequired, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isSetup = setupRequired;

  useEffect(() => {

  }, [isSetup]);

  if (!loading && authenticated) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (isSetup) {
      if (password.length < 6) return setError("密码至少 6 位");
      if (password !== confirm) return setError("两次输入的密码不一致");
    }
    setBusy(true);
    try {
      if (isSetup) await api.setup(username.trim(), password);
      else await api.login(username.trim(), password);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* 左：品牌与引文 */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r hairline px-12 py-12 lg:flex">
        <div className="pointer-events-none absolute -left-32 top-1/3 h-[420px] w-[420px] rounded-full bg-amber-glow/[0.10] blur-[110px]" />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-[360px] w-[360px] rounded-full bg-sage/[0.08] blur-[110px]" />

        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-glow/25 bg-gradient-to-b from-amber-glow/25 to-transparent text-amber-glow">
            ✦
          </span>
          <div>
            <div className="serif text-xl tracking-wide">词笺</div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-paper-600">wordnote</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <Quote size={26} className="mb-5 text-amber-glow/40" />
          <p className="serif text-[30px] leading-[1.45] text-paper-100">
            He lingered by the window long after she had gone, watching the rain blur the
            streetlights.
          </p>
          <p className="mt-5 text-sm leading-relaxed text-paper-500">
            她走后，他在窗边徘徊了很久，看着雨水模糊了路灯。
          </p>
          <div className="mt-8 flex flex-wrap gap-2 text-[11px] text-paper-600">
            <span className="chip">落笔即复习</span>
            <span className="chip">Supertonic 3 发音</span>
            <span className="chip">SQLite 单文件可迁移</span>
          </div>
        </div>

        <div className="text-[11px] leading-relaxed text-paper-600">
          摘抄 → 划线 → 翻译 → 详解 → 间隔复习
          <br />
          一切数据都在你自己的机器上。
        </div>
      </div>

      {/* 右：表单 */}
      <div className="flex items-center justify-center px-5 py-12">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[380px]"
        >
          <div className="mb-8 lg:hidden">
            <div className="serif text-2xl">词笺</div>
            <div className="mt-1 text-xs tracking-[0.2em] text-paper-600">WORDNOTE</div>
          </div>

          <div className="label mb-2">{isSetup ? "首次使用 · 初始化账号" : "登录"}</div>
          <h2 className="serif text-[26px] leading-snug text-paper-50">
            {isSetup ? "先给这本册子上一把锁" : "欢迎回来"}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-paper-500">
            {isSetup
              ? "只在本机/局域网内使用。账号密码保存在本地加密库里，不会上传任何地方。"
              : "输入你的账号密码，会话 30 天内保持登录。"}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-3.5">
            <label className="block">
              <span className="mb-1.5 block text-[12px] text-paper-500">用户名</span>
              <div className="relative">
                <UserRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-paper-600" />
                <input
                  className="input pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="your-name"
                  required
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] text-paper-500">密码</span>
              <div className="relative">
                <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-paper-600" />
                <input
                  type="password"
                  className="input pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSetup ? "new-password" : "current-password"}
                  placeholder="至少 6 位"
                  required
                />
              </div>
            </label>

            {isSetup && (
              <label className="block">
                <span className="mb-1.5 block text-[12px] text-paper-500">再输一次</span>
                <input
                  type="password"
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="确认密码"
                  required
                />
              </label>
            )}

            {error && (
              <div className="rounded-xl border border-rose-400/25 bg-rose-400/[0.08] px-3 py-2 text-[13px] text-rose-200">
                {error}
              </div>
            )}

            <button type="submit" disabled={busy} className="btn btn-primary mt-1 w-full py-2.5">
              {busy ? <Spinner size={15} /> : null}
              {isSetup ? "初始化并进入" : "进入词笺"}
              {!busy && <ArrowRight size={15} />}
            </button>
          </form>

          <div className="mt-6 text-[11px] leading-relaxed text-paper-600">
            换个设备用：<span className="text-paper-500">{typeof window !== "undefined" ? window.location.origin : "http://<你的局域网IP>:8100"}</span>
            <br />
            忘记密码：删除 <span className="text-paper-500">data/wordnote.db</span> 里的 users 表记录后重新初始化（会丢失账号，不影响摘抄数据）。
          </div>
        </motion.div>
      </div>
    </div>
  );
}
