// 驻留在 chat pane 之后的 agent(pane-chat 切换),以其 core label 标识
// herdr.chat=<chat pane>。Herdr 通过其
// pane,因此终端被驻留而 chat 在显示的 agent 会从 agents() 中消失,tab
// 以及 space 状态。列出 agent 的 mods 会补回这些字段,如 chat pane 的 agent。
// 共享文件:源文件是 lib/parked.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的每个 mod 里。
// 编辑 lib/parked.js(不要编辑 mod 里的副本),然后运行 bin/sync-shared。

import { focused, shared, machines, run, exec, hc, appHome } from "herdr";
import { panes, terminals, spaces } from "./live.js";
import { chatPane } from "./core/spaces.js";

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const STATES = ["working", "blocked", "done", "idle"];

// 结构与 agents() 的条目相同;`pane` 即 chat pane。
export function chatAgents() {
  const seen = shared("chat.seen") ?? {};
  const chats = new Map(panes().filter((p) => p.mod === "chat").map((p) => [p.pane, p]));
  const own = new Set(panes().map((p) => p.terminal).filter(Boolean));
  const where = new Map(spaces().flatMap((s) => s.tabs.map((t) => [t.id, { s, t }])));
  const now = focused()?.pane;
  const out = [];
  for (const k of terminals()) {
    const pane = chatPane(k);
    const p = pane && chats.get(pane);
    if (!p || k.state !== "live" || own.has(k.address)) continue;
    const e = { terminal: k.address };
    let status = STATES.includes(k.status) ? k.status : "idle";
    // Done 表示完成但尚无人查看;查看其 chat 后变为 idle,与 Herdr 一致。
    if (status === "done" && (now === pane || (seen[e.terminal] ?? -1) >= (k.turn ?? 0))) status = "idle";
    const w = where.get(p.tab);
    out.push({
      address: e.terminal, pane, space: w?.s.id ?? null, space_name: w?.s.name ?? "", tab: p.tab,
      tab_index: w?.t.index ?? 0, tab_name: w?.t.name ?? "", status, app: k.report?.app ?? null,
      program: k.program, title: k.title ?? "", seq: k.turn ?? 0, focused: now === pane,
    });
  }
  return out;
}

// 两个状态中更紧急的一个(null 表示无)。
export const urgent = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a ?? null);

// 一个 tab 的状态,连同其中驻留的 agent。
export function tabStatus(tab, parked = chatAgents()) {
  return parked.filter((a) => a.tab === tab.id).reduce((s, a) => urgent(s, a.status), tab.status ?? null);
}

// spaces(),驻留 agent 计入其 tab 和 space 的状态。
export function spacesWithChats() {
  const parked = chatAgents();
  if (!parked.length) return spaces();
  return spaces().map((s) => {
    const tabs = s.tabs.map((t) => ({ ...t, status: tabStatus(t, parked) }));
    return { ...s, tabs, status: tabs.reduce((st, t) => urgent(st, t.status), s.status ?? null) };
  });
}

// 停靠的 agent 带有核心 label herdr.chat=<其 chat pane>。 当该 pane 消失时
// (其 tab 或 space 关闭,即使是 Herdr 启动以来从未显示过的),该 agent 结束,如同
// 关闭其 pane 本会终止它,其 chat 标记和请求也随之消失。在 pane
// 存在时,core keep 保持开启。机器
// 其 layout 加载完成后才判定,且 pane 必须连续两次缺失。
const missing = new Map();
const kept = new Set();
async function keepOn(address) {
  kept.add(address);
  try {
    const t = JSON.parse((await hc(["get", address, "--json"])).stdout);
    if (t.keep === false) await hc(["keep", address]);
  } catch { kept.delete(address); }
}
export function sweep() {
  const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? ""));
  const have = new Set(panes().map((p) => p.pane));
  const own = new Set(panes().map((p) => p.terminal).filter(Boolean));
  for (const k of terminals()) {
    // 按本窗口对 pane 的命名:其他窗口(或机器)写入的 label 也能匹配(#761)。
    const chat = chatPane(k);
    if (!chat || k.state !== "live") { kept.delete(k.address); continue; }
    const machine = k.address.includes("/") ? k.address.split("/")[0] : "";
    if (!ready.has(machine) || have.has(chat) || own.has(k.address)) {
      missing.delete(k.address);
      // 驻留时把 core keep 关掉了:重新打开,这样即使 core 丢失也能像 pane 的终端一样存活。
      if (have.has(chat) && !own.has(k.address) && !kept.has(k.address)) keepOn(k.address);
      continue;
    }
    if (!missing.has(k.address)) { missing.set(k.address, true); continue; }
    missing.delete(k.address);
    run("terminal.kill", { terminal: k.address });
    if (!machine) exec("sh", ["-c", 'rm -f "$1/open/$2" "$1/req/$2".*.json "$1/ans/$2".*.json', "x", `${appHome()}/data/chat-asks`, k.address]);
  }
}
