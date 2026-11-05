import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Loader2, Pause, Play, Volume2 } from "lucide-react";
import { api } from "../api";

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */
type Toast = { id: number; text: string; kind: "ok" | "err" | "info" };
const ToastCtx = createContext<{ push: (text: string, kind?: Toast["kind"]) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-3), { id, text, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              className="pointer-events-auto flex items-center gap-2 rounded-xl border hairline bg-ink-900/95 px-4 py-2.5 text-sm text-paper-100 shadow-2xl backdrop-blur"
            >
              {t.kind === "ok" ? (
                <CheckCircle2 size={15} className="text-emerald-400" />
              ) : t.kind === "err" ? (
                <AlertCircle size={15} className="text-rose-400" />
              ) : (
                <Volume2 size={15} className="text-amber-glow" />
              )}
              <span className="max-w-[70vw]">{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ------------------------------------------------------------------ */
/* 基础件                                                              */
/* ------------------------------------------------------------------ */
export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />;
}

export function PageTitle({ eyebrow, title, desc, right }: { eyebrow?: string; title: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="label mb-1.5">{eyebrow}</div>}
        <h1 className="serif text-[28px] leading-tight text-paper-50 sm:text-[32px]">{title}</h1>
        {desc && <p className="mt-1.5 text-sm text-paper-500">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon: ReactNode;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border hairline veil-1 text-amber-glow">
        {icon}
      </div>
      <div className="serif text-lg text-paper-100">{title}</div>
      {desc && <div className="max-w-sm text-sm leading-relaxed text-paper-500">{desc}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <div className="panel px-4 py-3.5">
      <div className="label mb-1">{label}</div>
      <div className={`serif text-[26px] leading-none ${accent ? "text-amber-glow" : "text-paper-50"}`}>{value}</div>
      {hint && <div className="mt-1.5 text-[11px] text-paper-600">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 发音按钮：走 /api/tts（服务端 Supertonic 3，磁盘缓存）               */
/* ------------------------------------------------------------------ */
export function PlayButton({
  text,
  voice,
  size = "md",
  label,
  className = "",
}: {
  text: string;
  voice?: string;
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const { push } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const play = async () => {
    if (!text.trim()) return;
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const audio = new Audio(api.tts.url(text.slice(0, 400), voice));
      audioRef.current = audio;
      audio.onended = () => setState("idle");
      audio.onerror = () => {
        setState("idle");
        push("发音失败：Supertonic 服务异常", "err");
      };
      await audio.play();
      setState("playing");
    } catch {
      setState("idle");
      push("浏览器拦截了播放，请再点一次", "err");
    }
  };

  const dims = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  const icon = size === "sm" ? 13 : size === "lg" ? 18 : 15;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        void play();
      }}
      title={label || "Supertonic 3 发音"}
      className={`grid place-items-center rounded-full border transition ${dims} ${
        state === "playing"
          ? "border-amber-glow/50 bg-amber-glow/15 text-amber-glow"
          : "hairline veil-1 text-paper-300 hv-line hover:text-paper-50"
      } ${className}`}
    >
      {state === "loading" ? (
        <Spinner size={icon} />
      ) : state === "playing" ? (
        <Pause size={icon} />
      ) : (
        <Play size={icon} className="translate-x-[1px]" />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 模态框                                                              */
/* ------------------------------------------------------------------ */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center scrim p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className={`panel w-full ${width} max-h-[86vh] overflow-y-auto p-5`}
            onClick={(e) => e.stopPropagation()}
          >
            {title && <div className="serif mb-4 text-lg text-paper-50">{title}</div>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* 其它小件                                                            */
/* ------------------------------------------------------------------ */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg veil-2 ${className}`} />;
}

export function DueBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-glow/90 px-1.5 text-[10px] font-semibold text-ink-900">
      {n > 99 ? "99+" : n}
    </span>
  );
}
