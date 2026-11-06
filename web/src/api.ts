import type {
  Dict,
  OfflineStatus,
  ReviewItem,
  Sentence,
  Stats,
  TtsStatus,
  Word,
} from "./types";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...init, headers });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("wn:unauthorized"));
    throw new ApiError("未登录或登录已过期", 401);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail =
      (data && (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))) ||
      `请求失败（${res.status}）`;
    throw new ApiError(detail, res.status);
  }
  return data as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text.slice(0, 200) };
  }
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export type MeResponse = { authenticated: boolean; username?: string; setup_required: boolean };

export const api = {
  me: () => request<MeResponse>("/auth/me"),
  login: (username: string, password: string) =>
    request<{ ok: boolean; username: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  setup: (username: string, password: string) =>
    request<{ ok: boolean; username: string }>("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  changePassword: (old_password: string, new_password: string) =>
    request<{ ok: boolean }>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ old_password, new_password }),
    }),

  stats: () => request<Stats>("/stats"),

  sentences: {
    list: (params: { q?: string; tag?: string; limit?: number; offset?: number; order?: string } = {}) =>
      request<{ total: number; items: Sentence[] }>(`/sentences${qs(params)}`),
    get: (id: number) => request<{ item: Sentence }>(`/sentences/${id}`),
    tags: () => request<{ items: { tag: string; count: number }[] }>("/sentences/tags/all"),
    create: (payload: {
      text: string;
      translation?: string;
      source?: string;
      note?: string;
      tags?: string[];
      annotations?: { surface: string; char_start: number; char_end: number }[];
      auto_translate?: boolean;
      auto_lookup?: boolean;
    }) =>
      request<{ item: Sentence; warnings: string[]; duplicate: boolean }>("/sentences", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    patch: (id: number, payload: Partial<Pick<Sentence, "text" | "translation" | "source" | "note" | "tags">>) =>
      request<{ item: Sentence }>(`/sentences/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    remove: (id: number) => request<{ ok: boolean }>(`/sentences/${id}`, { method: "DELETE" }),
    addAnnotation: (id: number, payload: { surface: string; char_start: number; char_end: number }) =>
      request<{ item: Sentence }>(`/sentences/${id}/annotations`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    removeAnnotation: (id: number, aid: number) =>
      request<{ item: Sentence }>(`/sentences/${id}/annotations/${aid}`, { method: "DELETE" }),
    translate: (id: number) =>
      request<{ item: Sentence; provider: string }>(`/sentences/${id}/translate?force=true`, { method: "POST" }),
    grade: (id: number, quality: number) =>
      request<{ item: Sentence }>(`/sentences/${id}/grade`, {
        method: "POST",
        body: JSON.stringify({ quality }),
      }),
  },

  words: {
    list: (params: { mode?: string; letter?: string; q?: string; limit?: number; offset?: number } = {}) =>
      request<{ total: number; items: Word[]; letters: Record<string, number> }>(`/words${qs(params)}`),
    get: (id: number) => request<{ item: Word }>(`/words/${id}`),
    create: (headword: string, note?: string) =>
      request<{ item: Word }>("/words", { method: "POST", body: JSON.stringify({ headword, note }) }),
    patch: (id: number, payload: { meaning_zh?: string; note?: string }) =>
      request<{ item: Word }>(`/words/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    remove: (id: number) => request<{ ok: boolean }>(`/words/${id}`, { method: "DELETE" }),
    refresh: (id: number) => request<{ item: Word }>(`/words/${id}/refresh`, { method: "POST" }),
    grade: (id: number, quality: number) =>
      request<{ item: Word }>(`/words/${id}/grade`, {
        method: "POST",
        body: JSON.stringify({ quality }),
      }),
    lookup: (word: string) => request<{ item: Dict }>(`/words/lookup/any${qs({ word })}`),
  },

  review: {
    queue: (kind: "all" | "word" | "sentence" = "all", limit = 20) =>
      request<{ items: ReviewItem[]; due: { words: number; sentences: number; total: number } }>(
        `/review/queue${qs({ kind, limit })}`,
      ),
    grade: (kind: "word" | "sentence", id: number, quality: number) =>
      request<{ ok: boolean; due_at: number; interval_days: number }>("/review/grade", {
        method: "POST",
        body: JSON.stringify({ kind, id, quality }),
      }),
  },

  tts: {
    url: (text: string, voice?: string) => `${BASE}/tts${qs({ text, voice })}`,
    status: () => request<TtsStatus>("/tts/status"),
    voices: () => request<{ items: { id: string; label: string }[]; default: string }>("/tts/voices"),
    clearCache: () => request<{ removed: number }>("/tts/cache", { method: "DELETE" }),
  },

  settings: {
    get: () => request<{ values: Record<string, string>; voices_available: string[] }>("/settings"),
    put: (values: Record<string, string>) =>
      request<{ values: Record<string, string> }>("/settings", {
        method: "PUT",
        body: JSON.stringify({ values }),
      }),
  },

  translate: (text: string, force = false) =>
    request<{ translation: string; provider: string; cached: boolean }>("/translate", {
      method: "POST",
      body: JSON.stringify({ text, force }),
    }),

  offline: {
    status: () => request<OfflineStatus>("/offline/status"),
    retry: (limit = 10) =>
      request<{ checked: number; fixed: number; remaining: number }>(`/offline/retry?limit=${limit}`, {
        method: "POST",
      }),
    prewarm: () =>
      request<{ scheduled: number; candidates: number; voice: string }>("/offline/prewarm", { method: "POST" }),
    bundleUrl: () => `${BASE}/export/bundle`,
  },

  exportJsonUrl: () => `${BASE}/export/json`,
  exportDbUrl: () => `${BASE}/export/db`,

  importJson: (payload: unknown) =>
    request<{ ok: boolean; imported: Record<string, number> }>("/import/json", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  extra: () =>
    request<{
      db_path: string;
      db_bytes: number;
      audio: { files: number; bytes: number };
      words: number;
      lookup_cache: number;
      translate_cache: number;
    }>("/stats/extra"),
};
