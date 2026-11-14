"""按当前设置的语速，把已有单词/句子音频预合成一遍（后台跑）。"""
import asyncio
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"D:\DeepSeekWorkPlace\projects\wordnote\server")

from app.services import tts  # noqa: E402


async def main():
    speed = tts.default_speed()
    voice = tts.default_voice()
    targets = list(dict.fromkeys(tts.prewarm_targets()))
    print(f"语速={speed} 音色={voice} 目标={len(targets)} 条", flush=True)
    ok = 0
    for i, text in enumerate(targets, 1):
        try:
            await tts.synthesize(text, voice, speed)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  跳过 {text[:24]!r}: {exc}", flush=True)
        if i % 20 == 0:
            print(f"  {i}/{len(targets)}", flush=True)
    print(f"完成：{ok}/{len(targets)}", flush=True)
    print("cache:", tts.cache_stats(), flush=True)


asyncio.run(main())
