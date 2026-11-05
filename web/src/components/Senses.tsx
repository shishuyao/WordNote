import { parseMeaningGroups } from "../lib/meaning";

/**
 * 释义渲染：把"一整段挤在一起"的释义拆成
 *   词性 chip + 引导语 + 编号条目（1/2/3 用小圆数字）
 * 让复习卡片、词详情这些地方一眼能读。
 */
export default function Senses({
  text,
  pos,
  dense = false,
  className = "",
}: {
  text: string;
  pos?: string | null;
  dense?: boolean;
  className?: string;
}) {
  const groups = parseMeaningGroups(text || "");

  if (!groups.length) {
    return <p className="text-[13px] leading-relaxed text-paper-400">{text || "—"}</p>;
  }

  const itemText = dense ? "text-[13px] leading-[1.75]" : "text-[14px] leading-[1.8]";

  return (
    <div className={`space-y-3 ${className}`}>
      {groups.map((group, gi) => {
        const chip = group.pos || (gi === 0 ? pos || "" : "");
        return (
          <div key={gi}>
            {(chip || group.lead) && (
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {chip && (
                  <span className="chip py-0 text-[10px] text-amber-glow/90">{chip}</span>
                )}
                {group.lead && (
                  <span className="text-[11.5px] leading-relaxed text-paper-500">{group.lead}</span>
                )}
              </div>
            )}
            <ol className={dense ? "space-y-1" : "space-y-2"}>
              {group.items.map((item, i) => (
                <li key={i} className="flex gap-2.5">
                  {group.numbered ? (
                    <span className="mt-[3px] grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full veil-2 text-[10px] font-medium text-paper-500">
                      {i + 1}
                    </span>
                  ) : (
                    <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-paper-600/60" />
                  )}
                  <span className={`${itemText} text-paper-200`}>{item}</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
