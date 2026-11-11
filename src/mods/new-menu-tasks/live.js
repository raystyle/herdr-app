// Herdr 的实时列表,每次 render 读取一次。Herdr 给一次 render 约 50 毫秒;
// 超时则中止 render 并显示 “This view could not be re-rendered; showing the last version
// that worked”。每次 terminals()、panes()、spaces() 或 agents() 调用都会重新复制整份列表
// (terminals() 取六台机器上的 18 个 terminal 约需 3.5 毫秒),而某次 render 请求了它们
// 几十次:chat,然后是状态栏(每个等待中的 agent 一次 terminals(),每个等待中的
// agent)。在 inRender() 内这些每次 render 给一个副本;其他场合(点击、定时器、task)
// 实时列表,和以前一样。副本由整个 render 共享:绝不排序或修改它们
// 就位。每个 view 的 render 都包在 inRender() 里,共享模块从这里读列表。
//
// 共享文件:源为 lib/live.js;bin/sync-shared 会把它复制到 lib/COPIES 里的每个 mod。
// 请编辑 lib/live.js,不要改 mod 里的副本,然后运行 bin/sync-shared。
import { agents as liveAgents, panes as livePanes, terminals as liveTerminals, spaces as liveSpaces } from "herdr";

// render 的副本。被 Herdr 中止的 render 不会执行 `finally`,因此比任何 render 都旧的副本
// 可能达到的时限(STALE 毫秒)永不使用。
const STALE = 250;
let frame = null;
const current = () => (frame && Date.now() - frame.at < STALE ? frame : null);
const once = (name, read) => () => {
  const f = current();
  if (!f) return read();
  if (!(name in f.lists)) f.lists[name] = read();
  return f.lists[name];
};

export const agents = once("agents", liveAgents);
export const panes = once("panes", livePanes);
export const terminals = once("terminals", liveTerminals);
export const spaces = once("spaces", liveSpaces);

// 以每份列表的一个副本运行 fn(一次 render);嵌套在另一 render 内的 render 沿用外层的副本。
export function inRender(fn) {
  const outer = current();
  frame = outer ?? { at: Date.now(), lists: {} };
  try { return fn(); } finally { frame = outer; }
}
