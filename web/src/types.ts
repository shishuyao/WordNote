export type Annotation = {
  id?: number;
  surface: string;
  char_start: number;
  char_end: number;
  word_id?: number | null;
  headword?: string | null;
  phonetic_us?: string | null;
  phonetic_uk?: string | null;
  pos?: string | null;
  meaning_zh?: string | null;
  ann_note?: string | null;
};

export type Sentence = {
  id: number;
  text: string;
  translation: string | null;
  source: string;
  note: string;
  tags: string[];
  created_at: number;
  updated_at: number;
  due_at: number | null;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  word_count: number;
  annotations: Annotation[];
};

export type DictSense = { pos: string; defs: string[] };
export type DictDef = { pos: string; def: string; examples: string[]; synonyms: string[] };
export type DictExample = { en: string; zh: string; source: string };

export type Dict = {
  headword: string;
  base_form: string;
  phonetic_uk: string;
  phonetic_us: string;
  senses: DictSense[];
  defs_en: DictDef[];
  forms: Record<string, string>;
  examples: DictExample[];
  exam_sents: DictExample[];
  synonyms: { pos: string; tran: string; words: string[] }[];
  phrases: { phrase: string; zh: string }[];
  word_family: { pos: string; words: { word: string; zh: string }[] }[];
  etymology: { source: string; text: string }[];
  web_meanings: { value: string; support: number }[];
  ai_note: string;
  level: string;
  source: string;
  fetched_at?: number;
  note?: string;
};

export type WordExample = {
  id: number;
  en: string;
  zh: string;
  source: string;
  sentence_id: number | null;
};

export type WordSourceSentence = {
  id: number;
  text: string;
  translation: string | null;
  created_at: number;
  surface: string;
  char_start: number;
  char_end: number;
};

export type Word = {
  id: number;
  headword: string;
  base_form: string;
  phonetic_uk: string;
  phonetic_us: string;
  pos: string;
  meaning_zh: string;
  meaning_en: string;
  forms: Record<string, string>;
  note: string;
  source: string;
  created_at: number;
  updated_at: number;
  due_at: number | null;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  lookup_state?: string;
  dict?: Dict | null;
  examples?: WordExample[];
  sentences?: WordSourceSentence[];
};

export type Stats = {
  words: number;
  sentences: number;
  annotations: number;
  due: { words: number; sentences: number; total: number };
  reviews: { today: number; week: number; total: number };
  streak: number;
  series: { day: string; count: number }[];
  recent_sentences: { id: number; text: string; translation: string | null; created_at: number; anns: number }[];
};

export type ReviewItem = Partial<Word> & Partial<Sentence> & { kind: "word" | "sentence"; example?: { en: string; zh: string } | null };

export type TtsStatus = {
  server: string;
  alive: boolean;
  model_loaded: boolean;
  model_id: string;
  cache: { files: number; bytes: number };
};

export type OfflineStatus = {
  offline_mode: boolean;
  ecdict: { available: boolean; count: number; bytes: number; updated_at: number };
  audio: { files: number; bytes: number };
  pending_words: number;
  pending_list: { id: number; headword: string; source: string }[];
  counts: { words: number; sentences: number; annotations: number; examples: number };
};