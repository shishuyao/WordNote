"""极简 SM-2：复习间隔调度。仅用于句子/单词的"到期"队列。"""

from __future__ import annotations

import random
import time

DAY = 86400


def introduce() -> int:
    """新条目：立刻可复习。"""
    return int(time.time())


def schedule(
    quality: int,
    reps: int,
    interval_days: float,
    ease: float,
) -> dict:
    """quality: 0=忘了 3=吃力 4=一般 5=轻松。返回新的 reps/interval_days/ease/due_at。"""
    quality = max(0, min(5, int(quality)))
    ease = float(ease or 2.5)
    interval_days = float(interval_days or 0)
    reps = int(reps or 0)

    if quality < 3:
        reps = 0
        interval_days = 1.0
    else:
        if reps == 0:
            interval_days = 1.0
        elif reps == 1:
            interval_days = 6.0
        else:
            interval_days = max(1.0, interval_days * ease)
        ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        ease = max(1.3, min(3.2, ease))
        reps += 1

    jitter = random.uniform(0.97, 1.06)
    due_at = int(time.time() + interval_days * DAY * jitter)
    return {
        "reps": reps,
        "interval_days": round(interval_days, 2),
        "ease": round(ease, 3),
        "due_at": due_at,
    }
