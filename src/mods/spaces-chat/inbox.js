// 所有 space 和机器上需要用户的内容:Tasks panel 的 “Needs you”(mods/tasks;
// 没有 Inbox panel)。 条目为推导所得
// 每次都从当前现状推导、从不存储,因此处理完即消失:
// ask      Claude agent(权限、plan、问题)通过 chat 的
// PermissionRequest hook(mods/chat/ask-hook.sh):在其 chat 的卡片上回答
// blocked  其他等待用户的 agent(其 live 状态),本地或其他地方
// merge    处于 Ready 的 task(herdr-task 的 status ready):保存在 “inbox.tasks” 但不是
// 项,因为它位于 Tasks 的 Ready 而非 Needs you(ready():绿色计数)
// check    有问题的 task(check 失败、冲突、...:其 attention)
// stopped  agent 在报告 ready 前结束的 task(“Agent stopped”)
// waiting  agent 沉默且未报告 ready 的 task(herdr-task 的派生状态:
// Needs you,即需要 “reply”):原因(其自身状态行、其问题或最后的话)
// auto     未能触发或未能启动其 task 的 automation
// provider 其模型 provider 持续掉线的 assistant(coordinator):herdr-task tick
// 它被告知在 1、2、4、8 分钟后继续,而第五次尝试也被切断,
// 或错误属于等待无法解决的一类(已登出、额度用尽)
//
// 每个条目用至多 40 字符说明原因(reasonOf:同 herdr-winapp,标准原因或
// agent 自己的问题截断适配,绝不粘贴其消息原文):Tasks 行、红色计数
// 提醒和 toast 说法一致。task 的原因是 herdr-task 的(其 why);ask 的来自
// hook 的请求;等待中 agent 的来自其自身状态报告(OSC 7501 kind)。
//
// 引擎(startInbox)运行在始终加载的 tab 栏里。它共享需要
// 程序去查明:共享 “inbox.asks”(等待中的请求)、“inbox.tasks”、“inbox.autos”。
// live agent 在条目生成处读取(items())。
//
// hook(mods/chat/ask-hook.sh)每次都询问 chat,无论谁读取(web app、
// 手机);引擎触碰的标志(data/chat-asks/open/<terminal>)只在有 hc 或 jq 的地方
// 缺失。期间 Claude 在其 terminal 中显示自己的 prompt;Codex 在 hook 上等待,因此
// Codex agent 的 ask 在其 terminal 上屏后即释放,由 Codex 在那里提问。
//
// 共享文件:源为 lib/inbox.js;bin/sync-shared 会把它复制到 lib/COPIES 里的每个 mod。
// 请编辑 lib/inbox.js,不要改 mod 里的副本,然后运行 bin/sync-shared。

import { LINE_MAX, REASONS, fit, reqReason, reportReason } from "./core/needs.js";
import { SH } from "./core/paths.js";
import { dirsReady } from "./dirs.js";
import { notifies, spaceOfTerminal } from "./notify.js";
import { toast, toastWho as whoOf } from "./ui.js";
import { exec, appHome, home, focused, shared, setShared, watchFolder, readTextFile, writeTextFile, playSound, settings, run, layout } from "herdr";
import { terminals, agents, panes, spaces } from "./live.js";
import { chatPane } from "./core/spaces.js";

const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task.cmd`;
export const ASKS = () => `${appHome()}/data/chat-asks`;
const pre = (machine, id) => (machine && id && !String(id).includes("/") ? `${machine}/${id}` : id ?? null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const put = (key, value) => { if (!same(shared(key), value)) setShared(key, value); };

// 本地的 Claude Code,live:hook 能带来其 ask 的那些 agent。
const claudeHere = (k) => k.state === "live" && !String(k.address).includes("/")
  && (k.program?.key === "claude" || k.agent === "claude-code" || k.report?.app === "claude-code");

// 显示该 terminal 的 chat pane,若已打开。
export function chatOf(address) {
  const c = chatPane(terminals().find((k) => k.address === address));
  return c && panes().some((p) => p.pane === c && p.mod === "chat") ? c : null;
}

// 以 terminal 形式在屏:其 pane 位于当前显示的 tab 中,且没有 chat 在显示它。
function onScreen(address) {
  const tab = focused()?.tab;
  return Boolean(tab) && panes().some((p) => p.terminal === address && p.tab === tab) && !chatOf(address) && !threadShown(address);
}

// task worker 的 thread(mods/chat 的 openThread():共享 “chat.threads” = { [pane]: { terminal,
// task, title } })位于当前显示的 tab:其 ask 在该处 thread 的卡片上回答。
function threadShown(address) {
  const tab = focused()?.tab;
  return Boolean(tab) && Object.entries(shared("chat.threads") ?? {}).some(([pane, v]) => v?.terminal === address
    && panes().some((p) => p.pane === pane && p.mod === "chat" && p.tab === tab));
}

// // ---- 引擎(标签栏运行它)--------------------------------------------------------

let started = false;
const alerted = new Set(), seenAt = new Map();

export function startInbox(cx) {
  if (started) return;
  started = true;
  cx.spawn(async (cx) => {
    await exec("sh", ["-c", 'mkdir -p "$1/open" "$1/req" "$1/ans"', "x", ASKS()]).catch(() => {});
    let watch = null;
    for (;;) {
      await flags().catch(() => {});
      await readAsks().catch(() => {});
      watch ??= watchFolder(`${ASKS()}/req`).catch(() => null).finally(() => { watch = null; });
      await Promise.race([watch, cx.sleep(4000)]);
    }
  });
  cx.spawn(async () => { await readTasks().catch(() => {}); });
  // agent 的提醒(herdr-task alert):只是 label,没有程序可运行;每秒查看一次。
  cx.timer.every(1000, () => agentAlerts());
  cx.timer.every(20000, (cx) => cx.spawn(async () => { await readTasks().catch(() => {}); }));
  // 已请求(shared “chat.threadreq”)但 1.5 秒内无 coordinator chat 认领的 thread
  // (该 space 中没有打开的,或它显示的是其 terminal):改为前往 worker 本身。
  let fellBack = null;
  cx.timer.every(500, () => {
    const q = shared("chat.threadreq");
    if (!q?.terminal || q.at === fellBack || shared("chat.threadack") === q.at) return;
    const age = Date.now() - q.at;
    if (age < 1500 || age > 6000) return;
    fellBack = q.at;
    toAgent(q.terminal);
  });
}

// 为本地每个未以 terminal 形式在屏的 Claude agent 触碰 hook 的标志。
async function flags() {
  const off = terminals().filter(claudeHere).map((k) => k.address).filter((a) => /^[\w.-]+$/.test(a) && !onScreen(a));
  if (off.length) await exec("sh", ["-c", 'cd "$1/open" && shift && touch -- "$@"', "x", ASKS(), ...off]);
}

// 等待中的请求(<terminal>.<time>.<hook pid>.json):hook 已消失的被丢弃。
async function readAsks() {
  const r = await exec("sh", ["-c", 'cd "$1/req" 2>/dev/null || exit 0; for f in *.json; do [ -f "$f" ] || continue; p=${f%.json}; p=${p##*.}; if kill -0 "$p" 2>/dev/null; then echo "$f"; else rm -f "$f"; fi; done; true', "x", ASKS()]);
  const ids = r.stdout.split("\n").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  const asks = ids.map((id) => ({ id, terminal: id.split(".")[0] }));
  // Codex 的(它在 hook 上等待)在其 terminal 上屏时归还给它;Claude 的
  // terminal 反正会显示自己的 prompt,而释放它会把 web 上的卡片也关掉。
  const shown = asks.filter((a) => onScreen(a.terminal));
  if (shown.length) {
    const r = await exec("sh", ["-c", 'cd "$1/req" && shift && for i; do grep -q \'"turn_id"\' "$i.json" 2>/dev/null && echo "$i"; done; true', "x", ASKS(), ...shown.map((a) => a.id)]).catch(() => null);
    for (const id of (r?.stdout ?? "").split("\n").filter(Boolean)) await release(id);
  }
  const left = asks.filter((a) => !onScreen(a.terminal));
  // 几秒后,Herdr 未显示有 agent 在等待的 ask 会获得自己的提醒。
  const now = Date.now();
  for (const a of left) {
    if (!seenAt.has(a.id)) seenAt.set(a.id, now);
    else if (now - seenAt.get(a.id) >= 3000 && !alerted.has(a.id)) { alerted.add(a.id); alert(a).catch(() => {}); }
  }
  for (const id of seenAt.keys()) if (!left.some((a) => a.id === id)) { seenAt.delete(id); alerted.delete(id); }
  put("inbox.asks", left);
}

// 未决定:Claude 在其 terminal 中提问。
const release = (id) => writeTextFile(`${ASKS()}/ans/${id}.json`, "", null).catch(() => {});

// 尚无任何 chat 显示的新 ask:获得与需要用户的 agent 相同的提示音和 toast,除非 Herdr
// 已经给出(agent 显示为 blocked)。打开的 chat 自行提醒。它说明原因,与
// 与 Tasks 行一致。
async function alert(a) {
  if (chatOf(a.terminal) || threadShown(a.terminal) || terminals().find((k) => k.address === a.terminal)?.status === "blocked") return;
  // 其 space 的 Notify 为 Off 的 Assistant 保持安静。
  if (!notifies(terminals().find((k) => k.address === a.terminal), "need")) return;
  let req = null;
  try { req = JSON.parse(await readTextFile(`${ASKS()}/req/${a.id}.json`) ?? ""); } catch {}
  if (settings()?.sounds?.enabled !== false) playSound("blocked");
  const k = terminals().find((x) => x.address === a.terminal);
  toast({ title: `${whoOf(k)} · Needs you`, body: req ? reqReason(req) : REASONS.question, level: "alert",
    action: { name: "tabs-tasks.inbox", args: {} } });
}

// // ---- agent 的警报 --------------------------------------------------------------------------

// `herdr-task alert "<title>" --body "<why>"`(同 herdr-winapp 的 `herdr-winapp alert`):agent 自己的
// terminal 获得核心 label herdr.alert = { id, at, title, body, task?, about? },每个
// Herdr client 立即可见。每个新条目:blocked 提示音和一个 toast,点击前往
// agent(Tasks panel 中该 task 的 chat)。task 的 agent,或关于 task 的提醒
// (--task)总是送达用户;Assistant 的遵循其 space 的 Notify(notify.js)。
// 重启之后,只显示最近 15 秒内的那些。
const ALERT = "herdr.alert";
const shownAlert = new Map(); // terminal -> 其最近一次提醒的 id
let alertsFrom = 0;
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

function agentAlerts() {
  alertsFrom ||= Date.now() - 15000;
  for (const k of terminals()) {
    const raw = k.labels?.[ALERT];
    if (!raw) continue;
    let a = null;
    try { a = JSON.parse(raw); } catch {}
    if (!a?.id || shownAlert.get(k.address) === a.id) continue;
    shownAlert.set(k.address, a.id);
    if (!(Number(a.at) >= alertsFrom) || !(a.about || notifies(k, "need"))) continue;
    if (settings()?.sounds?.enabled !== false) playSound("blocked");
    toast({ title: clip(`${whoOf(k, a.task)} · ${String(a.title ?? "")}`, 60), body: clip(String(a.body ?? ""), 300), level: "alert",
      action: { name: `tabs-tasks.alert-${k.address.replace(/\//g, "~")}` } });
  }
}

// 点击提醒的 toast(tab 栏的 “alert-<terminal>” 命令;mod 命令携带
// 无参数):task 的 agent 打开 Tasks panel 中其 task 的 chat,其余一律前往 agent。
export function toAlert(args) {
  const terminal = args?.terminal;
  if (!terminal) return;
  const k = terminals().find((x) => x.address === terminal);
  if (k?.labels?.["herdr.task"] && hasNode(layout(), "tasks-thread")) {
    setShared("tasks.thread", { terminal, task: null, title: agentInfo(terminal)?.title ?? null, at: Date.now() });
    run("layout.select", { stack: "panel-body", child: "tasks" });
    run("layout.select", { stack: "tasks", child: "tasks-thread" });
    run("layout.show", { id: "panel" });
    return;
  }
  toAgent(terminal);
}

// // ---- 原因 ------------------------------------------------------------------------------

// 原因及其文案(core/needs.js,与 web app 共享),此处和以前一样。
export { LINE_MAX, REASONS, fit, reqReason, reportReason } from "./core/needs.js";

// 条目为何需要用户,至多 LINE_MAX 字符。req:ask 的请求,若已读取。
export function reasonOf(item, req = null) {
  if (item.why) return item.why;
  if (item.kind === "ask") return req ? reqReason(req) : REASONS.question;
  if (item.kind === "blocked") {
    // task worker:herdr-task 的原因(其 tool 调用、问题、plan 或其报告的 kind)。
    const t = (shared("inbox.tasks") ?? []).find((x) => x.kind === "asks" && x.live?.includes(item.terminal));
    if (t?.why) return t.why;
    const report = terminals().find((k) => k.address === item.terminal)?.report;
    const kind = report?.kind;
    return kind === "auth" ? REASONS.signedOut : kind === "permission" ? reportReason(report?.msg) ?? REASONS.permission : REASONS.question;
  }
  if (item.kind === "check") return fit(item.attention);
  // 只有进程确实结束才显示 “Agent stopped”;仍在运行且在等待的(以它自己的话
  // (即上文的 item.why)在等待用户。
  if (item.kind === "stopped") return REASONS.stopped;
  if (item.kind === "waiting") return REASONS.reply;
  return null;
}

// task 与 automation,本地及每台有 task 的机器。一次只读一份:缓慢的
// 机器绝不能每 20 秒重复叠加。
let reading = null;
function readTasks() {
  return reading ??= readTasksNow().finally(() => { reading = null; });
}

async function readTasksNow() {
  const r = await exec("sh", ["-c", SH + 'ls "$SHEP_TASKS/.remote" 2>/dev/null; true']).catch(() => null);
  const where = [null, ...(r?.stdout ?? "").split("\n").filter(Boolean)];
  const tasks = [], autos = [];
  for (const machine of where) {
    const on = machine ? ["--on", machine] : [];
    const list = await json(CLI(), [...on, "list", "--all", "--json"]);
    for (const g of Array.isArray(list) ? list : []) for (const x of g.tasks ?? []) {
      // Ready:herdr-task 自身的状态,同 Tasks 的 Ready 组和 herdr-winapp 的绿色
      // 计数(不含 Merging,也不含其 agent 在提问的:该 agent 是 “blocked” 条目)。
      // “asks”:其 agent 在等待(live 的 blocked terminal,或自有条目):为说明原因而保留。
      // “provider”:被其模型的 provider 切断,重试次数用尽(herdr-task tick)。
      // 其 agent 正在处理的问题(herdr-task 的 on_it():Working,而非 Needs you)不生成条目。
      const kind = x.attention ? (x.needs === "attention" ? "check" : null) : x.state === "ready" ? (x.status === "ready" ? "merge" : null)
        : x.needs === "stopped" || x.status === "stopped" ? "stopped" : x.needs === "reply" || x.needs === "provider" ? "waiting"
        : x.needs === "asks" ? "asks" : null;
      if (!kind) continue;
      const last = x.agents?.[x.agents.length - 1];
      tasks.push({ kind, machine, folder: g.folder, name: g.name, ref: x.ref ?? `#${x.id}`, title: x.title, attention: x.attention ?? null, why: x.why ?? null,
        pr: x.pr ?? null, space: pre(machine, x.space), tab: pre(machine, x.tab), live: (x.live ?? []).map((a) => pre(machine, a.address)),
        merging: Boolean(x.merge_requested && x.live?.length), at: x.ready_at ?? last?.ended ?? last?.at ?? x.started ?? x.created ?? 0 });
    }
    const auto = await json(CLI(), [...on, "auto", "list", "--all", "--json"]);
    for (const a of Array.isArray(auto) ? auto : []) if (a?.last_error)
      autos.push({ machine, id: a.id, ref: a.ref ?? null, title: a.title, folder: a.folder, error: a.last_error, last_task: a.last_task ?? null });
  }
  put("inbox.tasks", tasks);
  put("inbox.autos", autos);
  await readRetries();
}

// 本地的 Assistants(coordinators)被其 provider 持续切断(herdr-task tick 的
// .retries.json):各生成一个条目,且只 toast 一次。task worker 的显示在其 task 上。
const told = new Set();
async function readRetries() {
  let rows = {};
  try { rows = JSON.parse(await readTextFile(`${(await dirsReady()).tasks}/.retries.json`) ?? "{}") ?? {}; } catch {}
  const over = Object.values(rows).filter((r) => r?.role === "coordinator" && r.over && r.reason && !r.stale
    && terminals().some((k) => k.address === r.address && k.state === "live"))
    .map((r) => ({ terminal: r.address, why: r.reason, cut: r.cut, at: r.at ?? 0 }));
  for (const r of over) if (!told.has(`${r.terminal}:${r.cut}`)) {
    told.add(`${r.terminal}:${r.cut}`);
    if (settings()?.sounds?.enabled !== false) playSound("blocked");
    toast({ title: `${whoOf(terminals().find((k) => k.address === r.terminal))} · ${r.why}`, body: "Write to it to carry on, or restart it.", level: "alert",
      action: { name: "tabs-tasks.inbox", args: {} } });
  }
  put("inbox.provider", over);
}

// 与上次相同的输出不再解析(每个命令一条:每台机器几条)。
// 不是文件 mtime 检查:herdr-task 能在文件未变时推导状态(agent 沉默)。
const parsed = new Map();
async function json(cmd, args) {
  const r = await exec(cmd, args).catch(() => null);
  if (!r || r.code !== 0) return null;
  const key = [cmd, ...args].join("\0"), last = parsed.get(key);
  if (last?.out === r.stdout) return last.value;
  let value = null;
  try { value = JSON.parse(r.stdout); } catch {}
  parsed.set(key, { out: r.stdout, value });
  return value;
}

// // ---- 条目 ----------------------------------------------------------------------------

// 当前全部条目,最紧急在前:ask 和等待中的 agent,然后是问题。这些是 Tasks
// “Needs you” 和红色计数;可合并的 task 不算(它在 Ready 里:ready())。
export function items() {
  const asks = shared("inbox.asks") ?? [];
  const asking = new Set(asks.map((a) => a.terminal));
  const out = asks.map((a) => ({ key: `ask:${a.id}`, kind: "ask", id: a.id, terminal: a.terminal, at: Number(a.id.split(".")[1]) * 1000 || 0 }));
  const all = terminals();
  forgetUnblocked(all);
  for (const k of all)
    if (k.state === "live" && k.status === "blocked" && !asking.has(k.address))
      out.push({ key: `blocked:${k.address}`, kind: "blocked", terminal: k.address, at: blockedSince(k.address) });
  const tasks = shared("inbox.tasks") ?? [];
  for (const x of tasks) if (x.kind !== "merge" && x.kind !== "asks") out.push({ key: `${x.kind}:${x.machine ?? ""}:${x.folder}:${x.ref}`, ...x });
  for (const p of shared("inbox.provider") ?? []) if (!asking.has(p.terminal)) out.push({ key: `provider:${p.terminal}`, kind: "provider", ...p });
  for (const a of shared("inbox.autos") ?? []) out.push({ key: `auto:${a.machine ?? ""}:${a.id}`, kind: "auto", ...a, at: a.error?.at ?? 0 });
  return out;
}

export const count = () => items().length;

// 条目所在的 tab,用于 tab 和 space 上的红色计数:其 agent 的(其 chat
// 显示它,否则其 pane),或其 task 的。task agent 没有 tab(herdr-task 以不带 tab 的方式运行它们,
// pane,作为 space coordinator 的 hc 子级):它们的是其父级的,否则是其 space 的
// coordinator 的(label 为 herdr.task.space,或 task 的 space)。
export function tabOf(item, depth = 0) {
  const up = (address) => (address && depth < 3 ? tabOf({ terminal: address }, depth + 1) : null);
  if (!item.terminal) return item.tab ?? up(coordinatorOf(item.space)?.address);
  const pane = chatOf(item.terminal) ?? panes().find((p) => p.terminal === item.terminal)?.pane;
  const k = terminals().find((x) => x.address === item.terminal);
  const m = String(item.terminal).includes("/") ? item.terminal.split("/")[0] : null;
  const space = k?.labels?.["herdr.task.space"];
  return (pane && panes().find((p) => p.pane === pane)?.tab) || k?.labels?.["herdr.tab"]
    || up(k?.parent) || up(space && coordinatorOf(m ? `${m}/${space}` : space)?.address) || null;
}

// space 的 live coordinator(“vm/sp3”:在那台机器上),或 null。
function coordinatorOf(space) {
  if (!space) return null;
  const s = String(space), m = s.includes("/") ? s.split("/")[0] : null, id = m ? s.slice(m.length + 1) : s;
  return terminals().find((k) => k.state === "live" && (k.labels?.["herdr.role"] === "coordinator" || k.template === "assistant" || k.template === "coordinator")
    && (k.address.includes("/") ? k.address.split("/")[0] : null) === m
    && [k.labels?.["herdr.space"], k.labels?.["herdr.coordinator.space"]].includes(id)) ?? null;
}

// tab id -> 其中的条目数。
export function countsByTab() {
  const m = new Map();
  for (const it of items()) { const tab = tabOf(it); if (tab) m.set(tab, (m.get(tab) ?? 0) + 1); }
  return m;
}

// Tasks 的 Ready 中的 task,用于绿色计数(与红色并列),并按 tab 分。
export const ready = () => (shared("inbox.tasks") ?? []).filter((x) => x.kind === "merge");
export const readyCount = () => ready().length;
export function readyByTab() {
  const m = new Map();
  for (const it of ready()) { const tab = tabOf(it); if (tab) m.set(tab, (m.get(tab) ?? 0) + 1); }
  return m;
}

// agent 何时开始等待:本窗口第一次看到它如此的时间(其 tab 的最近一次变更
// 更晚也不会更好,因此以第一次见到为准。
const since = new Map();
function blockedSince(address) {
  if (!since.has(address)) since.set(address, Date.now());
  return since.get(address);
}

// 不再等待的重新开始。对一份列表的一次遍历:每个等待中的 agent 一次 terminals(),
// 每等待中的 agent 一次,使状态栏超出了 Herdr 的 render 时限。
function forgetUnblocked(all) {
  const blocked = new Set(all.filter((k) => k.status === "blocked").map((k) => k.address));
  for (const a of since.keys()) if (!blocked.has(a)) since.delete(a);
}

// // ---- 前往 --------------------------------------------------------------------------

// 显示需要用户处理的内容:Tasks panel 的 Active tab(共享 “tasks.show”)。
export function showInbox() {
  setShared("tasks.show", { tab: "active", at: Date.now() });
  run("layout.select", { stack: "panel-body", child: "tasks" });
  run("layout.show", { id: "panel" });
}

// 前往 agent:有 chat 显示它则去 chat,否则其 pane,再否则由 Herdr 查找。
export function toAgent(address) {
  const chat = chatOf(address);
  if (chat) { selectTabOf(chat); run("pane.focus", { pane: chat }); return; }
  // task worker 的 thread,打开在其 coordinator 的 chat 旁(mods/chat)。
  const thread = Object.entries(shared("chat.threads") ?? {}).find(([p, v]) => v?.terminal === address && panes().some((x) => x.pane === p))?.[0];
  if (thread) { selectTabOf(thread); run("pane.focus", { pane: thread }); return; }
  const p = panes().find((x) => x.terminal === address);
  if (p) { selectTab(p.tab); run("pane.focus", { pane: p.pane }); return; }
  // 没有 pane(task worker 不带 pane 运行):在 tab 之上窥视其 terminal。
  peekTerminal(address);
}

// 没有 pane 的 terminal(task worker 或 reviewer,设计上就没有 tab):其原始
// Tasks panel 的 task 视图中的屏幕,Terminal 侧(mods/chat/panel.js 的 openTaskThread(),
// 然后 requestWorkerTerminal())。 没有该 view 的 layout 使用 Herdr 自带的窥视。
const hasNode = (n, id) => Boolean(n && typeof n === "object") && (n.id === id || (n.children ?? []).some((c) => hasNode(c, id)));
export function peekTerminal(terminal, task = null, title = null) {
  if (!hasNode(layout(), "tasks-thread")) { run("terminal.peek", { terminal }); return; }
  setShared("tasks.thread", { terminal, task, title: title ?? agentInfo(terminal)?.title ?? null, at: Date.now() });
  run("layout.select", { stack: "panel-body", child: "tasks" });
  run("layout.select", { stack: "tasks", child: "tasks-thread" });
  run("layout.show", { id: "panel" });
  setShared("tasks.thread.termreq", { terminal, at: Date.now() });
}

function selectTab(tab) {
  const s = spaces().find((x) => x.tabs.some((t) => t.id === tab));
  if (s && !s.active) run("space.select", { id: s.id });
  run("tab.select", { id: tab });
}
const selectTabOf = (pane) => { const p = panes().find((x) => x.pane === pane); if (p) selectTab(p.tab); };

// 条目所涉及的 agent,用于其名称和状态。
export const agentInfo = (address) => agents().find((a) => a.address === address) ?? null;
export const terminalInfo = (address) => terminals().find((k) => k.address === address) ?? null;
