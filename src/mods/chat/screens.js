// CLI 会话开始前自己的界面(信任此文件夹、主题、登录、更新
// prompt,后续版本新增亦然),在聊天中显示为卡片,与 herdr-winapp 一致。读取
// 读取屏幕与监视正在启动的 agent 在 core/screens.js(web 端的服务)
// 同样监视):间隔一个轮询的两次相同读取即挂出卡片,对某项按一次
// 选项会在终端里按下,且仅当屏幕仍显示卡片所依据的内容。
// 卡片存于 shared state 的 "chat.screens" = { [address]: [card, ...] }(新的在后),因此
// agent 自己的聊天与其 Assistant 的聊天(任务 worker 的)显示同一张卡片,双方都能看到
// 它如何关闭(卡片字段见 core/screens.js)。

import { hc, shared, setShared } from "herdr";
import { terminals } from "./live.js";
import { headStrip, linkCtl } from "./cards.js";
import { ScreenWatch as Watch, SCREEN, KEEP, starting, cliOf } from "./core/screens.js";

export { starting, cliOf };

export const cardsOf = (addr) => (shared("chat.screens") ?? {})[addr] ?? [];
export const openCard = (addr) => { const c = cardsOf(addr).at(-1); return c?.state === "open" ? c : null; };

// 整个存储一次写入:已不在的 agent 的卡片随之清除。
function store(addr, list) {
  const live = new Set(terminals().filter((k) => k.state === "live").map((k) => k.address));
  const all = Object.fromEntries(Object.entries(shared("chat.screens") ?? {}).filter(([a]) => a !== addr && live.has(a)));
  if (list.length) all[addr] = list.slice(-KEEP);
  setShared("chat.screens", all);
}

// 监控 agent 屏幕:每个聊天副本一个,卡片存于 shared "chat.screens"。
export class ScreenWatch extends Watch {
  constructor(onPost) {
    super({ hc, cards: cardsOf, save: store }, onPost);
  }
}

// // ---- 卡片 --------------------------------------------------------------------------------

// 打开屏幕时卡片的条带:CLI 的文字,每个选项一行、点击即选择,以及
// 该 terminal。opts:{ who(谁的屏幕:"Claude"、"")、links(header
// 右侧)、press(i, cx)、toTerminal(cx)(无则不加链接)、busy(一次按下处理中)、error }。
export function screenStrips(card, opts = {}) {
  const id = card.id.replace(/[^\w-]/g, "_");
  const links = [...(opts.links ?? []), ...(opts.toTerminal ? [linkCtl(`scr-term-${id}`, "在终端里回答", (cx) => opts.toTerminal(cx))] : [])];
  const out = [headStrip({ who: opts.who ?? card.cli, links }), { key: "title", kind: "title", text: SCREEN.title(card.cli) }];
  if (card.words) out.push({ key: "words", kind: "detail", lines: card.words.split("\n"), clip: null });
  card.choices.forEach((c, i) => out.push({ key: `c${i}`, kind: "option", gap: i ? 1 : 8, num: i + 1, label: c.label, desc: c.description,
    disabled: Boolean(opts.busy), fn: opts.busy ? null : (cx) => opts.press?.(i, cx) }));
  if (opts.error) out.push({ key: "error", kind: "text", tone: "red", text: opts.error });
  return out;
}
