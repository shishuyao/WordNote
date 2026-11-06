/** 把浏览器选区换算成"相对某个容器"的字符偏移，用于给选中文本（含短语）建划线标注。 */

function firstTextNode(node: Node, forward: boolean): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return node;
  if (node.nodeType === Node.ELEMENT_NODE) {
    const kids = Array.from(node.childNodes);
    if (!forward) kids.reverse();
    for (const kid of kids) {
      const found = firstTextNode(kid, forward);
      if (found) return found;
    }
  }
  return null;
}

/** 选区端点可能落在元素上（拖选时很常见），统一收敛到文本节点。 */
function toTextPoint(node: Node, offset: number, isStart: boolean): { node: Node; offset: number } | null {
  if (node.nodeType === Node.TEXT_NODE) return { node, offset };
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const from = isStart ? offset : offset - 1;
  const step = isStart ? 1 : -1;
  for (let i = from; i >= 0 && i < el.childNodes.length; i += step) {
    const text = firstTextNode(el.childNodes[i], isStart);
    if (text) {
      return { node: text, offset: isStart ? 0 : (text.textContent?.length ?? 0) };
    }
  }
  // 整体退一步：用元素中最后/最前的文本
  const fallback = firstTextNode(el, isStart);
  if (!fallback) return null;
  return { node: fallback, offset: isStart ? 0 : (fallback.textContent?.length ?? 0) };
}

export function selectionOffsets(
  container: HTMLElement,
  range: Range | null = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null,
): { start: number; end: number } | null {
  if (!range) return null;
  if (range.collapsed) return null;
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

  const startPoint = toTextPoint(range.startContainer, range.startOffset, true);
  const endPoint = toTextPoint(range.endContainer, range.endOffset, false);
  if (!startPoint || !endPoint) return null;

  let start = -1;
  let end = -1;
  let pos = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (node === startPoint.node) start = pos + startPoint.offset;
    if (node === endPoint.node) end = pos + endPoint.offset;
    pos += len;
    if (start >= 0 && end >= 0) break;
    node = walker.nextNode();
  }
  if (start < 0 || end < 0) return null;
  if (end < start) [start, end] = [end, start];
  if (end === start) return null;
  return { start, end };
}

/** 去掉选区两端的空白 / 标点，返回干净的短语区间。 */
export function trimRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number; surface: string } | null {
  while (start < end && /[\s,;:.!?()[\]{}"'“”‘’]/.test(text[start])) start += 1;
  while (end > start && /[\s,;:.!?()[\]{}"'“”‘’]/.test(text[end - 1])) end -= 1;
  if (end <= start) return null;
  const surface = text.slice(start, end);
  if (!/[A-Za-z]/.test(surface)) return null;
  return { start, end, surface };
}
