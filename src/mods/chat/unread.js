// 未读,与 Slack 一致(herdr-winapp 的 src/unread.ts):某 space 的 Assistant(其 coordinator)
// 有用户未看的新内容时,其 sidebar 行加粗高亮。只有
// Assistant 才会计入;task chat 永远不会让某行加粗。
// 新增:agent 的 core 统计其 turn(`turn`,每次停止工作加一:一次回复,或其
// 对 Herdr 或任务所发内容的回复)。Read:最近看到的轮次,保存在 agent 自己的
// 终端上,即 core label herdr.chat.read,让每个 Herdr 客户端和设备显示一致。
// 其 chat(或终端)显示在前台窗口的屏幕上即为已读;space 行的菜单
// 提供 Mark as read(mods/spaces-chat)。
// 共享文件:源文件是 lib/unread.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的每个 mod 里。
// 编辑 lib/unread.js(不要编辑 mod 里的副本),然后运行 bin/sync-shared。

import { focused, window, shared, hc } from "herdr";
import { terminals, panes } from "./live.js";
import { muted } from "./notify.js";

// 规则(哪个终端是 space 的 Assistant、已读轮次、未读)在 core/spaces.js,与
// service 和 web app 共享。
export { READ } from "./core/spaces.js";
import { READ, assistantOf as assistantIn, isUnread, chatPane } from "./core/spaces.js";

export const assistantOf = (space, ts = terminals()) => assistantIn(space, ts);

// 标记已上报所覆盖的范围,直到 core 收到为止。
const asked = new Map();

export function unread(k) {
  return isUnread(k, shared("chat.seen") ?? {}, asked.get(k?.address) ?? 0);
}

// Assistant 有新内容的 space 的 id 列表。已静音的(Notify: Off)永远不算。
export function unreadSpaces(sp, ts = terminals()) {
  return new Set(sp.filter((s) => !muted(s.id) && unread(assistantOf(s, ts))).map((s) => s.id));
}

export function markRead(k) {
  if (!unread(k)) return;
  asked.set(k.address, k.turn);
  const undo = () => asked.get(k.address) === k.turn && asked.delete(k.address);
  hc(["label", k.address, `${READ}=${k.turn}`]).then((r) => r.code !== 0 && undo(), undo);
}

// 在屏幕上:其 chat pane 或其终端所在的 pane 处于窗口显示的 tab 中,
// 不在其他 pane 的 zoom 之下、不显示 worker 的线程,且窗口位于前台。
export function onScreen(k, ps = panes()) {
  if (!k || !window()?.active) return false;
  const chat = chatPane(k);
  const p = ps.find((x) => x.terminal === k.address) ?? ps.find((x) => x.pane === chat && x.mod === "chat");
  if (!p || p.tab !== focused()?.tab) return false;
  if (p.mod === "chat" && shared("chat.threads")?.[p.pane]) return false;
  return !ps.some((x) => x.tab === p.tab && x.zoomed && x.pane !== p.pane);
}

// 屏幕上的每个 Assistant 都算已读。
export function readShown(ts = terminals()) {
  const ps = panes();
  for (const k of ts) if (unread(k) && onScreen(k, ps)) markRead(k);
}
