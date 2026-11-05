/**
 * 把词典拼出来的释义文本拆成结构化条目。
 *
 * 后台 short_meaning() 会把多条释义用「；」拼成一整段，而词典原文本身又带
 * "1. …；2. …；3. …" 内联序号，混在一起直接渲染会糊成一大块。这里做两层拆解：
 *   1) 按词性（n. / v. / adj. …）分成若干组
 *   2) 组内按 "1. 2. 3."（或 （1）（2））再拆成独立条目，编号前的引导语单独留 lead
 *
 * 例：
 *   "v. 动词 linger 的过去式和过去分词（不及物）：1. 逗留…；2.（想法…）…；3.…"
 *   → [{ pos: "v.", lead: "动词 linger 的过去式和过去分词（不及物）",
 *        items: ["逗留…", "（想法…）…", "…"], numbered: true }]
 */

export type SenseGroup = {
  pos: string;
  lead: string;
  items: string[];
  numbered: boolean;
};

const POS_TOKEN_RE = /(?:^|[\s；;、])((?:n|v|adj|adv|prep|pron|conj|num|art|int|aux|vt|vi|abbr|pl)\.(?:\s*&\s*(?:n|v|adj|adv)\.)?)\s*/gi;
// 1. / 1、 / 1) / （1） / (1)，允许前面是冒号、分号、空白或开头
const NUM_RE = /(?:^|[\s；;：:])(?:(\d{1,2})\s*[.、)）．]|（(\d{1,2})）|\((\d{1,2})\))\s*/g;

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[；;、,，：:.．\s]+/, "")
    .replace(/[；;、,，\s]+$/, "")
    .trim();
}

function splitNumbered(text: string): { lead: string; items: string[] } | null {
  const marks: { index: number; end: number; num: number }[] = [];
  NUM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUM_RE.exec(text)) !== null) {
    const num = Number(m[1] ?? m[2] ?? m[3]);
    marks.push({ index: m.index, end: m.index + m[0].length, num });
  }
  if (marks.length < 2) return null;
  // 编号必须从 1 开始、连续递增，才认定是"真编号"
  const sequential =
    marks[0].num === 1 && marks.every((x, i) => i === 0 || x.num === marks[i - 1].num + 1);
  if (!sequential) return null;

  const lead = tidy(text.slice(0, marks[0].index)).replace(/[:：.]$/, "");
  const items = marks
    .map((mark, i) => {
      const until = i + 1 < marks.length ? marks[i + 1].index : text.length;
      return tidy(text.slice(mark.end, until));
    })
    .filter(Boolean);
  if (items.length < 2) return null;
  return { lead, items };
}

function parseGroup(raw: string): SenseGroup | null {
  let text = tidy(raw);
  if (!text) return null;

  let pos = "";
  const posMatch = /^((?:n|v|adj|adv|prep|pron|conj|num|art|int|aux|vt|vi|abbr|pl)\.(?:\s*&\s*(?:n|v|adj|adv)\.)?)\s*/i.exec(
    text,
  );
  if (posMatch) {
    pos = posMatch[1].trim();
    text = text.slice(posMatch[0].length).trim();
  }

  const numbered = splitNumbered(text);
  if (numbered) {
    return { pos, lead: numbered.lead, items: numbered.items, numbered: true };
  }

  const items = text
    .split(/[；;]/)
    .map(tidy)
    .filter(Boolean);
  if (!items.length) return null;
  return { pos, lead: "", items, numbered: false };
}

export function parseMeaningGroups(raw: string): SenseGroup[] {
  const text = (raw || "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  // 按词性切段
  const cuts: { index: number; end: number; token: string }[] = [];
  POS_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = POS_TOKEN_RE.exec(text)) !== null) {
    cuts.push({ index: m.index, end: m.index + m[0].length, token: m[1] });
  }

  if (!cuts.length) {
    const single = parseGroup(text);
    return single ? [single] : [];
  }

  const segments: string[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i].index;
    const end = i + 1 < cuts.length ? cuts[i + 1].index : text.length;
    segments.push(text.slice(start, end));
  }
  const before = tidy(text.slice(0, cuts[0].index));
  if (before) segments.unshift(before);

  const groups = segments.map(parseGroup).filter((g): g is SenseGroup => Boolean(g));

  // 开头的无词性片段合并到第一组
  if (groups.length === 1 && groups[0].items.length === 1) {
    const only = groups[0];
    only.items = [tidy(only.items[0])];
  }
  return groups;
}

/** 兼容旧调用：只拿第一组（悬停卡这类单行场景） */
export function firstGroup(raw: string): SenseGroup | null {
  const groups = parseMeaningGroups(raw);
  return groups[0] ?? null;
}
