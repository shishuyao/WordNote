"""单词词条聚合：有道 jsonapi（中文/音标/词形/真题例句）+ dictionaryapi.dev 兜底。

两者都是免 Key 的公开接口；抓到的原始包会落 lookup_cache，词条快照进 words.dict_json，
所以断网时历史词条仍然完整可看。
"""

from __future__ import annotations

import re
import time
from typing import Any

import httpx

from ..config import (
    DICTAPI_URL,
    HTTP_UA,
    LOOKUP_TTL,
    OFFLINE,
    YOUDAO_URL,
)
from ..db import cache_lookup, cached_lookup
from . import ecdict

POS_RE = re.compile(r"^((?:[a-z]{1,4}\.)(?:\s*&\s*[a-z]{1,4}\.)*)\s*")
TAG_RE = re.compile(r"<[^>]+>")


def _clean(text: str | None) -> str:
    if not text:
        return ""
    return TAG_RE.sub("", text).replace("\u00a0", " ").strip()


def _first_i(node: Any) -> str:
    """有道里 l.i 可能是 str，也可能是 list。"""
    if isinstance(node, str):
        return _clean(node)
    if isinstance(node, list):
        return " ".join(_clean(x) for x in node if isinstance(x, str))
    if isinstance(node, dict):
        v = node.get("i")
        return _first_i(v)
    return ""


def _as_list(node: Any) -> list:
    """节点可能是 dict / list / None，统一成 list，避免遍历到字符串。"""
    if isinstance(node, list):
        return node
    if isinstance(node, dict):
        return [node]
    return []


def _as_dict(node: Any) -> dict:
    """有道返回的节点有时是 dict、有时是单元素 list，统一成 dict。"""
    if isinstance(node, list):
        return node[0] if node and isinstance(node[0], dict) else {}
    return node if isinstance(node, dict) else {}


def _deep_get(obj: Any, *path: str | int) -> Any:
    cur = obj
    for key in path:
        if isinstance(cur, dict):
            cur = cur.get(key)
        elif isinstance(cur, list) and isinstance(key, int) and -len(cur) <= key < len(cur):
            cur = cur[key]
        else:
            return None
        if cur is None:
            return None
    return cur


def _split_pos(text: str) -> tuple[str, str]:
    m = POS_RE.match(text)
    if not m:
        return "", text.strip()
    return m.group(1).strip(), text[m.end():].strip("　 :：;；")


def _merge_senses(items: list[dict]) -> list[dict]:
    """把 [{pos, def}] 合成 [{pos, defs:[...]}]，同 pos 相邻合并。"""
    out: list[dict] = []
    for it in items:
        if not it["def"]:
            continue
        if out and out[-1]["pos"] == it["pos"]:
            out[-1]["defs"].append(it["def"])
        else:
            out.append({"pos": it["pos"], "defs": [it["def"]]})
    return out


def normalize_youdao(raw: dict, headword: str) -> dict:
    result: dict[str, Any] = {
        "headword": headword,
        "base_form": headword,
        "phonetic_uk": "",
        "phonetic_us": "",
        "senses": [],
        "defs_en": [],
        "forms": {},
        "examples": [],
        "exam_sents": [],
        "synonyms": [],
        "phrases": [],
        "word_family": [],
        "etymology": [],
        "web_meanings": [],
        "ai_note": "",
        "level": "",
        "source": "youdao",
        "fetched_at": int(time.time()),
    }

    # 音标
    simple = _as_dict(_deep_get(raw, "simple", "word"))
    ec_word = _as_dict(_deep_get(raw, "ec", "word"))
    result["phonetic_uk"] = ec_word.get("ukphone") or simple.get("ukphone") or ""
    result["phonetic_us"] = ec_word.get("usphone") or simple.get("usphone") or ""
    base = _first_i(ec_word.get("return-phrase")) or _first_i(
        _as_dict(_deep_get(raw, "ee", "word")).get("return-phrase")
    )
    if base:
        result["base_form"] = base

    # 中文释义
    for item in _as_list(ec_word.get("trs")):
        for tr in _as_list(item.get("tr")):
            text = _first_i(tr.get("l"))
            pos, definition = _split_pos(text)
            result["senses"].append({"pos": pos, "def": definition})
    result["senses"] = _merge_senses(result["senses"])

    # 词形变化
    for wf in _as_list(ec_word.get("wfs")):
        wf = (wf or {}).get("wf") or {}
        name, value = wf.get("name"), wf.get("value")
        if name and value:
            result["forms"][name] = value

    # 英英释义 + 例句
    for item in _as_list(_deep_get(raw, "ee", "word", "trs")):
        for tr in _as_list(item.get("tr")):
            definition = _first_i(tr.get("l"))
            if not definition:
                continue
            examples = []
            exam = _deep_get(tr, "exam", "i", "f", "l") or []
            if isinstance(exam, list):
                for ex in exam[:2]:
                    if isinstance(ex, dict) and ex.get("i"):
                        examples.append(_clean(ex["i"]))
            result["defs_en"].append(
                {
                    "pos": (tr.get("pos") or "").strip(),
                    "def": definition,
                    "examples": examples,
                    "synonyms": [
                        s.get("similar")
                        for s in _as_list(tr.get("similar-words"))
                        if isinstance(s, dict) and s.get("similar")
                    ][:8],
                }
            )

    # 双语例句（学习型，带中文）
    for pair in _as_list(_deep_get(raw, "blng_sents_part", "sentence-pair")):
        en = _clean(pair.get("sentence"))
        zh = _clean(pair.get("sentence-translation"))
        if en:
            result["examples"].append({"en": en, "zh": zh, "source": "有道双语例句"})

    # 真题例句
    for s in _as_list(_deep_get(raw, "individual", "pastExamSents")):
        en = _clean(s.get("en"))
        if en:
            result["exam_sents"].append(
                {"en": en, "zh": _clean(s.get("zh")), "source": _clean(s.get("source"))}
            )

    # 柯林斯/权威词典例句（expand_ec），比普通双语例句更规范
    for trans in _as_list(_deep_get(raw, "expand_ec", "word", 0, "transList")):
        for sent in _deep_get(trans, "content", "sents") or []:
            en = _clean(sent.get("sentSpeech") or sent.get("sentOrig"))
            zh = _clean(sent.get("sentTrans"))
            if en and zh and en not in {e["en"] for e in result["examples"]}:
                result["examples"].append(
                    {"en": en, "zh": zh, "source": _clean(sent.get("source")) or "权威例句"}
                )

    # 同义词
    for group in _as_list(_deep_get(raw, "syno", "synos")):
        syno = group.get("syno") or {}
        words = [w.get("w") for w in _as_list(syno.get("ws")) if isinstance(w, dict) and w.get("w")]
        if words:
            result["synonyms"].append(
                {"pos": syno.get("pos") or "", "tran": _clean(syno.get("tran")), "words": words}
            )

    # 词组
    for item in _as_list(_deep_get(raw, "phrs", "phrs")):
        phr = item.get("phr") or {}
        phrase = _first_i(phr.get("headword"))
        trans = " ".join(
            _first_i(tr.get("tr", {}).get("l")) for tr in _as_list(phr.get("trs")) if tr.get("tr")
        )
        if phrase:
            result["phrases"].append({"phrase": phrase, "zh": trans.strip()})

    # 同根词
    for item in _as_list(_deep_get(raw, "rel_word", "rels")):
        rel = item.get("rel") or {}
        words = [
            {"word": w.get("word"), "zh": _clean(w.get("tran"))}
            for w in _as_list(rel.get("words"))
            if isinstance(w, dict) and w.get("word")
        ]
        if words:
            result["word_family"].append({"pos": rel.get("pos") or "", "words": words})

    # 词源
    for e in _as_list(_deep_get(raw, "etym", "etyms", "zh")):
        if e.get("value"):
            result["etymology"].append(
                {"source": _clean(e.get("source")), "text": _clean(e.get("value"))}
            )

    # 网络释义（少量即可，避免噪音）
    for item in _as_list(_deep_get(raw, "web_trans", "web-translation")):
        for tr in _as_list(item.get("trans")):
            if tr.get("value"):
                result["web_meanings"].append(
                    {"value": _clean(tr.get("value")), "support": tr.get("support") or 0}
                )
    result["web_meanings"].sort(key=lambda x: -int(x["support"] or 0))
    result["web_meanings"] = result["web_meanings"][:3]

    # AI 释义（有道上线的中文讲解，包含搭配）
    ai = _as_dict(_deep_get(raw, "aiDefinition", "words", 0))
    if ai and ai.get("content"):
        result["ai_note"] = _clean_markdown(ai["content"])

    level = _deep_get(raw, "individual", "level")
    if level:
        result["level"] = _clean(level)

    # 去重例句（按英文句去重），上限 12 条
    seen: set[str] = set()
    uniq = []
    for ex in result["examples"]:
        key = re.sub(r"\s+", " ", ex["en"].lower())
        if key in seen:
            continue
        seen.add(key)
        uniq.append(ex)
    result["examples"] = uniq[:12]
    return result


def _clean_markdown(text: str) -> str:
    text = TAG_RE.sub("", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = text.replace("&nbsp;", " ")
    return text.strip()


def normalize_dictapi(payload: list, headword: str) -> dict:
    result: dict[str, Any] = {
        "headword": headword,
        "base_form": headword,
        "phonetic_uk": "",
        "phonetic_us": "",
        "senses": [],
        "defs_en": [],
        "forms": {},
        "examples": [],
        "exam_sents": [],
        "synonyms": [],
        "phrases": [],
        "word_family": [],
        "etymology": [],
        "web_meanings": [],
        "ai_note": "",
        "level": "",
        "source": "dictionaryapi",
        "fetched_at": int(time.time()),
    }
    if not payload:
        return result
    entry = payload[0]
    result["phonetic_us"] = entry.get("phonetic") or ""
    for ph in entry.get("phonetics") or []:
        if ph.get("text") and not result["phonetic_uk"]:
            result["phonetic_uk"] = ph["text"]
    for meaning in entry.get("meanings") or []:
        pos = meaning.get("partOfSpeech") or ""
        defs = []
        for d in meaning.get("definitions") or []:
            definition = _clean(d.get("definition"))
            if not definition:
                continue
            defs.append(definition)
            if d.get("example"):
                result["examples"].append(
                    {"en": _clean(d["example"]), "zh": "", "source": "dictionaryapi.dev"}
                )
        if defs:
            result["senses"].append({"pos": pos, "defs": defs[:3]})
            result["defs_en"].append({"pos": pos, "def": defs[0], "examples": [], "synonyms": []})
    return result


def is_useful(normalized: dict) -> bool:
    return bool(normalized.get("senses") or normalized.get("defs_en"))


async def _fetch_youdao(client: httpx.AsyncClient, word: str) -> dict | None:
    try:
        r = await client.get(YOUDAO_URL, params={"q": word})
        if r.status_code != 200:
            return None
        data = r.json()
        if not isinstance(data, dict):
            return None
        if not (data.get("ec") or data.get("ee") or data.get("web_trans")):
            return None
        return data
    except (httpx.HTTPError, ValueError):
        return None


async def _fetch_dictapi(client: httpx.AsyncClient, word: str) -> list | None:
    try:
        r = await client.get(f"{DICTAPI_URL}/{word}")
        if r.status_code != 200:
            return None
        data = r.json()
        return data if isinstance(data, list) else None
    except (httpx.HTTPError, ValueError):
        return None


async def lookup_word(headword: str, *, force: bool = False) -> dict:
    """查词：缓存 →（在线时）有道 → 离线词库 ECDICT → dictionaryapi → 空。

    离线模式（WORDNOTE_OFFLINE=1）只查本地 ECDICT，不发任何外网请求。
    """
    headword = headword.strip().strip(".,;:!?\"'()[]{}").lower()
    if not headword:
        return normalize_dictapi([], headword)

    if not force:
        hit = cached_lookup(headword, LOOKUP_TTL)
        if hit and is_useful(hit):
            return hit

    if OFFLINE:
        local = ecdict.lookup_local(headword)
        if local and is_useful(local):
            return local
        return _empty(headword, "离线模式：本地词库（ECDICT）未收录该词")

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(6.0, connect=4.0),
        headers={"User-Agent": HTTP_UA},
        follow_redirects=True,
    ) as client:
        raw = await _fetch_youdao(client, headword)
        if raw:
            normalized = normalize_youdao(raw, headword)
            if is_useful(normalized):
                cache_lookup(headword, normalized)
                return normalized
        # 有道挂了/超时：本地词库先顶上（秒回，有中文释义与词形）
        local = ecdict.lookup_local(headword)
        if local and is_useful(local):
            return local
        fallback = await _fetch_dictapi(client, headword)
        if fallback:
            normalized = normalize_dictapi(fallback, headword)
            if is_useful(normalized):
                cache_lookup(headword, normalized)
                return normalized

    return _empty(headword, "词典未收录该词，可手动补释义")


def _empty(headword: str, note: str) -> dict:
    empty = normalize_dictapi([], headword)
    empty["source"] = "none"
    empty["note"] = note
    return empty


def short_meaning(normalized: dict, limit: int = 90) -> str:
    """拼一条简短中文释义，用于词表/悬停卡。"""
    chunks: list[str] = []
    for sense in normalized.get("senses") or []:
        pos = sense.get("pos") or ""
        for d in sense.get("defs") or []:
            text = f"{pos} {d}".strip()
            chunks.append(text)
            break
        if len(chunks) >= 3:
            break
    text = "；".join(chunks)
    if not text:
        for d in normalized.get("defs_en") or []:
            text = d.get("def") or ""
            if text:
                break
    return text[:limit]
