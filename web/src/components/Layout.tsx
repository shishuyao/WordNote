import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, Feather, Layers, LogOut, Moon, Settings, Sparkles, Sun } from "lucide-react";
import { useAuth } from "../auth";
import { THEME_LABELS, useTheme } from "../theme";
import { api } from "../api";
import { DueBadge } from "./ui";

const NAV = [
  { to: "/", label: "摘抄", icon: Feather, end: true },
  { to: "/words", label: "单词本", icon: BookOpen, end: false },
  { to: "/review", label: "复习", icon: Layers, end: false },
  { to: "/settings", label: "设置", icon: Settings, end: false },
];

export default function Layout() {
  const { username, signOut } = useAuth();
  const { resolved, mode, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [due, setDue] = useState(0);

  useEffect(() => {
    let alive = true;
    api.stats()
      .then((s) => alive && setDue(s.due.total))
      .catch(() => {});
    window.scrollTo({ top: 0, behavior: "smooth" });
    return () => {
      alive = false;
    };
  }, [location.pathname]);

  return (
    <div className="min-h-screen pb-24 sm:pb-10">
      <header className="sticky top-0 z-50 border-b hairline bg-ink-950/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-3 px-4 sm:px-6">
          <button
            onClick={() => navigate("/")}
            className="group flex items-center gap-2.5"
            aria-label="回到首页"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-amber-glow/25 bg-gradient-to-b from-amber-glow/20 to-transparent text-amber-glow transition group-hover:border-amber-glow/45">
              <Sparkles size={16} />
            </span>
            <span className="leading-tight">
              <span className="serif block text-[17px] tracking-wide text-paper-50">词笺</span>
              <span className="block text-[10px] uppercase tracking-[0.22em] text-paper-600">wordnote</span>
            </span>
          </button>

          <nav className="ml-4 hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition ${
                    isActive
                      ? "veil-2 text-paper-50"
                      : "text-paper-500 hv-veil hover:text-paper-100"
                  }`
                }
              >
                <item.icon size={14} />
                {item.label}
                {item.to === "/review" && <DueBadge n={due} />}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn btn-ghost px-2"
              title={`外观：${THEME_LABELS[mode]}（点击切换深浅）`}
              aria-label="切换外观"
              onClick={toggle}
            >
              {resolved === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <span className="hidden text-xs text-paper-600 sm:block">{username}</span>
            <button className="btn btn-primary px-3.5 py-1.5 text-[13px]" onClick={() => navigate("/new")}>
              <Feather size={14} />
              新摘抄
            </button>
            <button
              className="btn btn-ghost px-2"
              title="退出登录"
              onClick={async () => {
                await signOut();
                navigate("/login");
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto max-w-[1180px] px-4 pb-6 pt-7 sm:px-6"
      >
        <Outlet />
      </motion.main>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t hairline bg-ink-950/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
        <div className="flex h-16 items-center justify-around">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex w-16 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] transition ${
                  isActive ? "text-amber-glow" : "text-paper-500"
                }`
              }
            >
              <span className="relative">
                <item.icon size={18} />
                {item.to === "/review" && due > 0 && (
                  <span className="absolute -right-2 -top-1 h-1.5 w-1.5 rounded-full bg-amber-glow" />
                )}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
