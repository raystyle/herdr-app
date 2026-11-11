// Coordinators:从 `coordinator` template(herdr-core)启动的 agent,每个
// space,位于其独立且置顶的 tab 中。其 workers 是它在各自 tab 中启动的 agent:
// 其子级,或标注 herdr.coordinator=<其 tab> 的 terminal(它们在其重启后仍然存续)。
// coordinator tab 也可以还没有 agent:一个 chat pane(mods/chat,props.role 为 “coordinator”)
// 在用户首条消息时启动 coordinator。这些记录在共享
// “coordinator.slots” = { [slot]: { space, tab, pane, folder } }。新 space 会获得一个,本机
// 本机与其他机器一律如此(它运行在 space 所在机器上),除非共享
// “coordinator.auto” 为 false。
// 共享文件:源为 lib/coordinator.js;bin/sync-shared 会把它复制到 lib/COPIES 里的每个 mod。
// 请编辑 lib/coordinator.js,不要改 mod 里的副本,然后运行 bin/sync-shared。

import { appHome, exec, hc, run, openOverlay, shared, setShared, home, machines, focused, readTextFile } from "herdr";
import { dirs } from "./dirs.js";
import { isWorktreePath } from "./core/paths.js";
import { terminals, panes, spaces as allSpaces } from "./live.js";
import { chatPane, chatLabel } from "./core/spaces.js";
import { logSpace } from "./spacelog.js";
import { toast, plainError } from "./ui.js";

// “vm/tb12” -> ["vm", "tb12"];本机的 id 没有前缀。
const split = (id) => (id?.includes("/") ? [id.split("/")[0], id.split("/").slice(1).join("/")] : ["", id]);

// Assistant 从 “assistant” template 启动;更早的(仍在运行的)来自 “coordinator”。
export const isAssistantTemplate = (name) => name === "assistant" || name === "coordinator";
export const isCoordinator = (k) => k?.state === "live" && (k.labels?.["herdr.role"] === "coordinator" || isAssistantTemplate(k.template));

// tab 中的 live coordinator terminal,或 null。`ps`:panes(),由已
// 请求大量 tab(每次 panes() 调用都会复制所有 pane)。
export function coordinatorIn(tabId, all = terminals(), ps = null) {
  const [machine, tab] = split(tabId);
  const direct = all.find((k) => isCoordinator(k) && k.labels?.["herdr.tab"] === tab && split(k.address)[0] === machine);
  if (direct) return direct;
  // Chat 模式下 agent 没有 pane 也没有 tab 标签:其 chat pane(herdr.chat)说明其位置。
  const chats = new Set((ps ?? panes()).filter((p) => p.mod === "chat" && p.tab === tabId).map((p) => p.pane));
  return chats.size ? all.find((k) => isCoordinator(k) && chats.has(chatPane(k))) ?? null : null;
}

// tab 中尚无 agent 的 coordinator chat({ slot, space, tab, pane, folder }),或 null。
export function slotIn(tabId, slots = shared("coordinator.slots") ?? {}, ps = null) {
  for (const [slot, s] of Object.entries(slots))
    if (s.tab === tabId && (ps ??= panes()).some((p) => p.pane === s.pane && p.tab === tabId)) return { slot, ...s };
  return null;
}

// coordinator 的 tab:有 coordinator agent 的,或等待首条消息的 coordinator chat。
export const isCoordinatorTab = (tabId, all = terminals(), ps = null) => {
  ps ??= panes();
  return Boolean(coordinatorIn(tabId, all, ps) || slotIn(tabId, undefined, ps));
};

// space 的 coordinator tab,或 null。其所有 tab 共用一次 terminals() 和 panes()。
export function coordinatorTab(space, all = terminals(), ps = null) {
  if (!space) return null;
  ps ??= panes();
  const slots = shared("coordinator.slots") ?? {};
  return space.tabs.find((t) => coordinatorIn(t.id, all, ps) || slotIn(t.id, slots, ps)) ?? null;
}

// 新 space 是否获得 coordinator tab:默认开,除非共享 “coordinator.auto” 为 false(无 UI;
// 手动设置以关闭)。
export const autoCoordinator = () => shared("coordinator.auto") !== false;

// terminal 是谁的 worker:其 coordinator 的地址,或其父级的。
export function parentOf(k, all = terminals()) {
  const tab = k.labels?.["herdr.coordinator"];
  if (tab) {
    const [machine] = split(k.address);
    const c = coordinatorIn(machine ? `${machine}/${tab}` : tab, all);
    if (c && c.address !== k.address) return c.address;
  }
  return k.parent ?? null;
}

// coordinator 在世的 workers。
export const workersOf = (coord, all = terminals()) =>
  coord ? all.filter((k) => k.state === "live" && k.address !== coord.address && parentOf(k, all) === coord.address) : [];

// tab 显示的 agent:其 coordinator,否则其第一个 agent terminal。
export function agentIn(tabId, all = terminals()) {
  const c = coordinatorIn(tabId, all);
  if (c) return c;
  const p = panes().find((p) => p.tab === tabId && p.terminal && p.program?.agent);
  return p ? all.find((k) => k.address === p.terminal && k.state === "live") ?? null : null;
}

// terminal 运行的菜单项(knownAgents()),或 null。
export function entryFor(k, known) {
  if (!k) return null;
  const base = (s) => (s ?? "").split(/[\\/]/).pop();
  const chosen = k.labels?.["herdr.agent"];
  if (chosen) return known.find((a) => base(a.run?.[0]) === chosen) ?? null;
  return known.find((a) => a.key === k.program?.key) ?? known.find((a) => base(a.run?.[0]) === base(k.foreground?.argv?.[0] ?? k.argv?.[0])) ?? null;
}

// 辅助脚本以脱离方式运行:启动它的菜单立即关闭。macOS 没有 setsid(#736):在该平台上
// 脚本在 nohup 下以自己的作业(set -m)运行,因此照样比菜单存活更久。
export const DETACH = 'if command -v setsid >/dev/null 2>&1; then setsid -f bash "$0" "$@"; else set -m; nohup bash "$0" "$@" & fi >/dev/null 2>&1 </dev/null';
function script(name, args) {
  return exec("bash", ["-c", DETACH, `${appHome()}/mods/coordinator/${name}.sh`, ...args]);
}

// space 的 coordinator 工作目录:其聚焦(否则第一个)terminal 的文件夹。
function folderOf(space) {
  const mine = new Set(space.tabs.map((t) => t.id));
  const p = panes().find((p) => mine.has(p.tab) && p.focused && p.cwd) ?? panes().find((p) => mine.has(p.tab) && p.cwd);
  // Chat 模式下的 pane 不是 terminal pane:以其 agent 的文件夹代替。
  const chat = !p && panes().find((q) => mine.has(q.tab) && q.mod === "chat");
  const agent = chat && terminals().find((k) => chatPane(k) === chat.pane);
  return p?.cwd || agent?.cwd || space.folder || home();
}

// herdr-winapp settings(mods/herdr-winapp-settings 写入;herdr-task 也读取):
// herdr-winapp 的设置文件(~/.config/herdr-winapp/settings.json)= { version, everywhere: SETTINGS, machines: { <machine>: SETTINGS },
// spaces: { <space id>: { folder, name, machine, ...SETTINGS } } }
// 其中 SETTINGS = { coordinator, worker, reviewer: { agent, model, effort, fast, perm },
// tasks: { merge: "auto"|"checks"|"ask", review_rounds, must_fix: "blocker"|"major"|"minor", max_running,
// archive_after(Done 任务在列表中保留的天数;0:永不归档)},
// automations: { enabled }, agents: { reactions, feedback, feedback_repo } },所有键可选。machine 为 “local”(本机)或其
// 名;其他机器上的 space 为 “<machine>/<id>”。settings 窗口把每个其他
// 机器其份额(带 “here” 表示本机名)供其 herdr-task 使用。Settings 只编辑 Everywhere 和
// spaces;机器层保存其机器专属行(machine、home),仍会读取以
// machine scope 出现之前它为所有 spaces 设置的内容。
export const SHEPHERDR_FILE = () => dirs().settings;   // ~/.config/herdr-winapp/settings.json(lib/dirs.js)
export const SHEPHERDR_DEFAULTS = { tasks: { merge: "ask", review_rounds: 0, must_fix: "major", max_running: 10, archive_after: 7 }, automations: { enabled: true },
  agents: { reactions: true, feedback: true, feedback_repo: "" } };
export const LOCAL_MACHINE = "local";
export async function readWinapp() {
  try { return JSON.parse((await readTextFile(SHEPHERDR_FILE())) ?? "{}") ?? {}; } catch { return {}; }
}
// scope:null(Everywhere)、"m:<machine>"(某台机器)或某个 space id。
export const machineOfSpace = (id) => (String(id).includes("/") ? String(id).split("/")[0] : LOCAL_MACHINE);
// 一个 scope 读取的层,最具体的在前:[{ level: "space"|"machine"|"everywhere", key, obj }]。
export function winappLayers(cfg, scope = null) {
  const out = [];
  let machine = null;
  if (scope && scope.startsWith("m:")) machine = scope.slice(2);
  else if (scope) { out.push({ level: "space", key: scope, obj: cfg?.spaces?.[scope] || {} }); machine = machineOfSpace(scope); }
  if (machine) out.push({ level: "machine", key: machine, obj: cfg?.machines?.[machine] || {} });
  out.push({ level: "everywhere", key: null, obj: cfg?.everywhere || {} });
  return out;
}
// 一个 scope 中生效的配置:设置它的最具体层优先,否则用默认值。
// agent 是整体选择;task 与 automation 逐键合并。
export function winappFor(cfg, scope = null) {
  const layers = winappLayers(cfg, scope).reverse();
  const out = {};
  for (const role of ["coordinator", "worker", "reviewer"]) out[role] = layers.reduce((v, l) => l.obj[role] ?? v, null);
 // agents:在各层没有 agents 设置时,早于“对每个 agent 生效”设置的 Reactions仍然计
  const own = (l, k) => (k === "agents" && typeof l.obj.assistant?.reactions === "boolean" ? { reactions: l.obj.assistant.reactions, ...l.obj.agents } : l.obj[k] ?? {});
  for (const k of ["tasks", "automations", "agents"]) out[k] = Object.assign({ ...SHEPHERDR_DEFAULTS[k] }, ...layers.map((l) => own(l, k)));
  return out;
}

// 一个 app 命令,等待其完成,连同其产物({ tab, pane, ... })。
async function app(name, args) {
  const r = await exec("herdr-app", ["do", name, ...Object.entries(args).flatMap(([k, v]) => [`--${k}`, typeof v === "string" ? v : JSON.stringify(v)])]);
  let out = {};
  try { out = JSON.parse(r.stdout || "{}"); } catch {}
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr.trim() || `${name} failed`);
  return out;
}

// 某机器(null:本机)的 layout 当前是否在此就绪:只有此时 Herdr 才会添加 tab。
const machineReady = (name) => machines().find((m) => (m.name ?? null) === (name ?? null))?.layout === "ready";

// 其 Assistant 已在该 space 的机器上运行、而本窗口没有其 chat 的(从
// web app,或其运行期间 tab 被关闭):新 tab 会接管它,而不是另起一个。
function runningAssistant(space, ps = panes()) {
  const id = String(space.id).split("/").pop(), machine = space.machine ?? "";
  const shown = (k) => ps.some((p) => p.terminal === k.address || (p.mod === "chat" && p.pane === chatPane(k)));
  return terminals().find((k) => isCoordinator(k) && split(k.address)[0] === machine && !shown(k)
    && [k.labels?.["herdr.coordinator.space"], k.labels?.["herdr.space"]].includes(id)) ?? null;
}

// 打开 space 的 coordinator tab,位于该 space 最前:一个还没有 agent 的 chat,它会启动
// 在用户首条消息时启动 coordinator(mods/chat),在 space 所在机器上。show:跳转到
// 它;否则视图保持不变。settings({ agent, model, effort, fast, perm },来自 New space
// 对话框):它启动时所用的配置。离线的机器恢复后获得(watchNewSpaces)。
export async function openCoordinator(space, show = true, settings = null) {
  if (space.machine && !machineReady(space.machine)) {
    setShared("coordinator.pending", { ...(shared("coordinator.pending") ?? {}), [space.id]: { settings, at: Date.now() } });
    toast({ title: `${space.machine} is offline`, body: "它恢复后 Assistant 会自动启动。" });
    return;
  }
  const folder = folderOf(space);
  // 除非 New space 对话框另有选择,coordinator 按 herdr-winapp settings 中该 space 的配置运行。
  if (!settings) settings = winappFor(await readWinapp(), space.id).coordinator;
  const slot = `coord-${space.id}-${Math.random().toString(36).slice(2, 10)}`;
  const was = focused();
  const running = runningAssistant(space);
  try {
    const out = await app("tab.new", { space: space.id, name: "Assistant", mod: "chat",
      props: { role: "coordinator", template: "assistant", space: space.id, folder, slot, ...(settings ? { settings } : {}) } });
    const pane = out.pane ?? panes().find((p) => p.tab === out.tab && p.mod === "chat")?.pane ?? null;
    setShared("coordinator.slots", { ...liveSlots(), [slot]: { space: space.id, tab: out.tab, pane, folder } });
    // chat 跟随其 slot 指定的 agent(mods/chat 的 adoptSlot)。
    if (running && pane) await hc(["label", running.address, `herdr.chat=${chatLabel(pane)}`, `herdr.chat.slot=${slot}`, `herdr.chat.origin=slot:${slot}`,
      `herdr.coordinator.tab=${String(out.tab).split("/").pop()}`]).catch(() => {});
    await app("tab.move", { id: out.tab, index: 1 });
    if (show) {
      if (!space.active) run("space.select", { id: space.id });
      run("tab.select", { id: out.tab });
    } else if (was?.pane) run("pane.focus", { pane: was.pane }); // tab.new 显示新 tab:回到用户原处。
  } catch (e) {
    toast({ title: "Assistant 没有打开", body: plainError(e), level: "error" });
  }
}

// New space:New space 对话框(mods/newspace),在该 space 的机器上(无:本机)。
// 它先找出该机器最近的文件夹和 home,因此对话框以其
// 内容需要,其路径按该 home 显示。
export async function newSpace(space) {
  // 所请求的机器,否则(无法连通)本机,同 core/newspace.js 的 startMachine:对话框的
  // Machine choice 提供其余选项,在连接了其他机器时显示。
  const asked = space?.machine ?? null;
  const machine = asked && !machineReady(asked) ? null : asked;
  const choosing = machines().some((m) => m.name && m.layout === "ready");
  const [recent, at] = await Promise.all([recentFolders(machine).catch(() => []), homeOf(machine).catch(() => null)]);
  if (!at) return toast({ title: `Couldn't reach ${machine}`, body: "连接后再试一次新建空间。", level: "error" });
  // 对话框自绘 panel(frame 为 “none”),居中,高度恰容当前内容:
  // overlay 即处于最高状态的 panel。
  openOverlay({ mod: "newspace", kind: "dialog", frame: "none", width: 460, height: newSpaceHeight(recent.length, choosing), props: { recent, machine, home: at } });
}

// 机器的 home 文件夹(null:本机)。
export async function homeOf(machine = null) {
  if (!machine) return home();
  const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
  return r.code === 0 && r.stdout.startsWith("/") ? r.stdout : null;
}

// New space 对话框各部分的尺寸,以 px 计(mods/newspace 按这些尺寸绘制):内边距,
// 标题、Folder 标签与字段(相隔一个 gap)、列表行(输入路径的 Use 行,至多
// NEWSPACE_SHOWN 个文件夹,再是 Choose folder…),Coordinator 行以及开启时的两个
// 行(Task ID、Agent)、按钮,以及 section 之间的间距。overlay 即对话框
// coordinator 开启时如此;关闭时对话框中部自绘得更矮。
export const NEWSPACE = { pad: 18, title: 20, label: 16, gap: 4, field: 32, row: 31, line: 32, buttons: 32, section: 16 };
export const NEWSPACE_SHOWN = 5;
// 选择:显示 Machine choice(其标签、字段及其下的 space),并且可以浏览其他机器的文件夹
// 更多,因此行数达到上限。
export function newSpaceHeight(n, choosing = false) {
  const k = NEWSPACE, rows = 1 + Math.min(choosing ? NEWSPACE_SHOWN : n, NEWSPACE_SHOWN) + 1;
  return (choosing ? k.label + k.gap + k.field + k.section : 0) + 2 * k.pad + k.title + k.section + k.label + k.gap + k.field + k.gap + rows * k.row + k.section + 3 * k.line + k.section + k.buttons;
}

// 某机器上用户工作过的文件夹(null:本机的),最新在前,至多 8 个:其 spaces 的
// terminal 和其他 agent 的,各自以其 repo 顶层文件夹表示。task 的 worktree 不列入(它们
// 归属某个 task)。
export async function recentFolders(machine = null) {
  const at = new Map();
  const add = (p, t) => { if (p && !isWorktreePath(p)) at.set(p, Math.max(at.get(p) ?? 0, t ?? 0)); };
  const there = (id) => (machine ? id.startsWith(`${machine}/`) : !id.includes("/"));
  for (const k of terminals()) if (there(k.address)) add(k.foreground?.cwd ?? k.cwd, k.created_ms);
  for (const p of panes()) if (p.cwd && there(p.pane) && there(p.tab)) add(p.cwd, Date.now());
  const paths = [...at.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 40);
  const r = await exec("sh", ["-c", 'for d; do [ -d "$d" ] || continue; git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d"; done', "x", ...paths], machine ? { on: machine } : {});
  const out = [];
  for (const p of r.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (!out.includes(p) && !isWorktreePath(p)) out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

// 在 `machine`(null:本机)的 `folder` 处创建 space(New space 对话框),并且除非
// `settings` 为 null 时,其 Coordinator tab,在首条消息时以这些设置启动;落点
// 其中的内容。`icon`:对话框选定的 emoji(null 为 “#”),与 sidebar 的 Rename 一样保留
// (mods/spaces-chat sections.js 的 setIcon)。以 space id resolve。
// 有 coordinator 时,space 只有其 Coordinator tab:Herdr 的首个 shell tab 会被移除,同时
// 它仍是无人用过的全新 shell。
export async function createSpace(folder, settings, machine = null, icon = null) {
  setShared("coordinator.creating", Date.now());
  // 从一开始就命名,与 Herdr 的叫法一致(repo 名,否则文件夹名),但在 home 处为 “Home”:
  // 未命名的 space 跟随其第一个 terminal,当 coordinator 停靠在
  // 也可以是 task 在其 worktree 中的 worker(“task-3-...”)。给定的名称会保留。
  const name = await placeName(folder, machine);
  const out = await app("space.new", { folder, name, ...(machine ? { machine } : {}) });
  const now = JSON.parse((await exec("herdr-app", ["ls"]).catch(() => ({ stdout: "" }))).stdout || "{}").spaces?.find((x) => x.id === out.space);
  if (now && !now.named) {
    logSpace("rename", out.space, "coordinator.js createSpace (New space)", { to: name });
    await app("space.rename", { id: out.space, name }).catch(() => {});
  }
  if (icon) {
    const d = shared("spaces-chat") ?? {};
    setShared("spaces-chat", { ...d, icons: { ...(d.icons ?? {}), [out.space]: icon } });
  }
  if (settings === null) return out.space;
  await openCoordinator({ id: out.space, tabs: [], active: true, folder }, true, settings);
  if (out.terminal && out.tab && (await freshShell(out.terminal)))
    await app("tab.close", { id: out.tab, confirmed: true }).catch(() => {});
  return out.space;
}

// 机器的 home space:位于其 home 文件夹的 space,其 Assistant 还照管
// 该机器(herdr-task 的 home 轮)。缺失则创建,带其 Assistant tab,且视图
// 则回到用户原处:Herdr 的 space.new 会显示新 space。
export async function makeHomeSpace(machine = null) {
  const at = await homeOf(machine);
  if (!at) throw new Error(`Couldn't reach ${machine}.`);
  const mine = (s) => (s.machine ?? null) === machine && s.folder === at;
  const all = JSON.parse((await exec("herdr-app", ["ls"]).catch(() => ({ stdout: "" }))).stdout || "{}").spaces ?? [];
  const there = all.find(mine);
  if (there) {
    if (!coordinatorTab(there)) await openCoordinator(there, false);
    return there.id;
  }
  const was = focused();
  const out = await app("space.new", { folder: at, ...(machine ? { machine } : {}) });
  try {
    await openCoordinator({ id: out.space, tabs: [], active: false, folder: at }, false);
    if (out.terminal && out.tab && (await freshShell(out.terminal)))
      await app("tab.close", { id: out.tab, confirmed: true }).catch(() => {});
  } finally {
    if (was?.space) run("space.select", { id: was.space });
    if (was?.pane) run("pane.focus", { pane: was.pane });
  }
  return out.space;
}

// 无人用过的 shell:shell 本身在前景,位于其首个 prompt(一两行,或处于登录消息之下)。
// 仍在启动的 shell 会等待,至多 3 秒。
async function freshShell(address) {
  for (let i = 0; i < 12; i++) {
    const fresh = await shellState(address);
    if (fresh !== null) return fresh;
    await exec("sleep", ["0.25"]);
  }
  return false;
}

// true:全新 shell;false:已使用,或不是 shell;null:尚无前景程序。
async function shellState(address) {
  try {
    const k = JSON.parse((await exec("hc", ["get", address, "--json"])).stdout);
    if (k.state !== "live") return false;
    if (!k.foreground?.argv?.length) return null;
    const fg = k.foreground.argv[0].split("/").pop().replace(/^-/, "");
    if (!["bash", "zsh", "fish", "sh", "dash", "nu", "elvish", "xonsh", "pwsh"].includes(fg)) return false;
    const screen = (await exec("hc", ["read", address, "--lines", "40"])).stdout.split("\n").filter((l) => l.trim());
    // 其上方的登录消息(其他机器的 motd)没有用:只要它自己的
    // prompt 是最后一行,其后没有输入或运行的内容。
    const prompt = (l) => /[$#%>❯]\s*$/.test(l);
    return screen.length <= 2 || (prompt(screen[screen.length - 1]) && screen.filter(prompt).length === 1);
  } catch { return null; }
}

// Herdr 对 `machine` 上 `folder` 中未命名 space 的称呼:其 repo 名,否则文件夹名,home 处为 ~。
async function placeName(folder, machine = null) {
  if (folder === (await homeOf(machine).catch(() => null))) return "Home";
  const top = (await exec("git", ["-C", folder, "rev-parse", "--show-toplevel"], machine ? { on: machine } : {}).catch(() => null))?.stdout.trim();
  return (top || folder).split("/").filter(Boolean).pop() ?? folder;
}

// 从即将关闭的 mod 打开 space 的 coordinator tab:由 tab 栏完成(watchNewSpaces)。
// show 为 false:视图保持原处。
export const requestCoordinator = (space, show = true) => setShared("coordinator.openreq", { space: space.id, show, at: Date.now() });

// Slot 记录其 chat pane 仍在的情况(待本机 layout 加载后判定)。
function liveSlots() {
  const slots = shared("coordinator.slots") ?? {};
  if (machines().find((m) => m.name == null)?.layout !== "ready") return slots;
  const have = new Set(panes().map((p) => p.pane));
  return Object.fromEntries(Object.entries(slots).filter(([, s]) => !s.pane || have.has(s.pane)));
}

// 某机器是否运行自己的 herdr-winapp 窗口(其 herdr-app home 下有 mods):该窗口
// 会为自己的新 space 配 Assistant,因此本窗口不去管它们。每台机器询问一次。
const ownWindow = new Map();
function hasOwnWindow(machine) {
  if (!ownWindow.has(machine)) {
    ownWindow.set(machine, null);
    exec("sh", ["-c", 'test -d "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"'], { on: machine })
      .then((r) => ownWindow.set(machine, r.code === 0), () => ownWindow.delete(machine));
  }
  return ownWindow.get(machine);
}
// 上次检查时 layout 已就绪的其他机器:重新连上的机器其 spaces 会被记录
// 再次检查,因此它离线期间在那里创建的 space 不会被改动。
const wasReady = new Set();

// 从 tab 栏的 render 调用:每个新 space 都获得 coordinator tab,本机与其他
// 其他机器(有自己 herdr-winapp 窗口的机器自管其事)。本窗口
// 首次运行之前、它关闭期间、或在机器离线期间创建的 space,均不改动。
export function watchNewSpaces(spaces) {
  if (machines().find((m) => m.name == null)?.layout !== "ready") return;
  // 立即关闭的菜单(+ 菜单、space 的 Start Assistant)会请 tab 栏打开
  // 为它打开 coordinator tab。
  const req = shared("coordinator.openreq");
  if (req) {
    setShared("coordinator.openreq", null);
    const space = spaces.find((s) => s.id === req.space);
    if (space && Date.now() - req.at < 10000 && !coordinatorTab(space)) openCoordinator(space, req.show !== false);
  }
  // 在其机器离线期间请求的(openCoordinator):机器恢复后即打开,
  // 视图所在处;此后已消失的 space,或超过一周的请求,会被丢弃。
  const pending = shared("coordinator.pending");
  if (pending && Object.keys(pending).length) {
    const left = {};
    for (const [id, w] of Object.entries(pending)) {
      const space = spaces.find((s) => s.id === id);
      if (Date.now() - (w.at ?? 0) > 7 * 86400000) continue;
      if (!space ? !machineReady(machineOfSpace(id)) : !machineReady(space.machine)) { left[id] = w; continue; }
      if (space && !coordinatorTab(space)) openCoordinator(space, false, w.settings ?? null);
    }
    if (Object.keys(left).length !== Object.keys(pending).length) setShared("coordinator.pending", left);
  }
  // New space 对话框一经提交即关闭:space 在此创建(createSpace),其中
  // 使工作不因视图切到新 space 时对话框消失而被打断。
  const make = shared("newspace.createreq");
  if (make) {
    setShared("newspace.createreq", null);
    if (Date.now() - make.at < 10000) createSpace(make.folder, make.settings ?? null, make.machine ?? null, make.icon ?? null)
      .catch((e) => toast({ title: "空间没有创建", body: plainError(e), level: "error" }));
  }
  // Settings > Machines 开启了某机器的 Home Assistant:其 home space,缺失则创建。
  const home = shared("home.makereq");
  if (home) {
    setShared("home.makereq", null);
    if (Date.now() - home.at < 10000) makeHomeSpace(home.machine ?? null)
      .catch((e) => toast({ title: "主空间没有创建", body: plainError(e), level: "error" }));
  }
  const fresh = watchRemoteSpaces(spaces);
  const mine = spaces.filter((s) => !s.machine && !s.id.includes("/"));
  const seen = shared("coordinator.seen");
  if (!Array.isArray(seen)) setShared("coordinator.seen", mine.map((s) => s.id));
  else {
    const here = mine.filter((s) => !seen.includes(s.id));
    if (here.length || seen.some((id) => !mine.some((s) => s.id === id))) {
      setShared("coordinator.seen", mine.map((s) => s.id));
      const slots = shared("coordinator.slots") ?? {}, kept = liveSlots();
      if (Object.keys(kept).length !== Object.keys(slots).length) setShared("coordinator.slots", kept);
    }
    fresh.unshift(...here);
  }
  if (!fresh.length) return;
  // New space 对话框正在创建的 space,其 coordinator(或无)由对话框决定。
  if (!autoCoordinator() || Date.now() - (shared("coordinator.creating") ?? 0) < 15000) return;
  // 新 space 的第一个 tab 随之出现:一旦有了,coordinator 排到前面。
  // 当新 space 正是用户正在查看的时落到其中;在别处创建的 space
  // (agent 的)使视图保持原处。
  for (const s of fresh) if (s.tabs.length && !coordinatorTab(s)) openCoordinator(s, s.active);
}

// 其他机器的新 space,同 watchNewSpaces 对本机的处理:共享
// “coordinator.seen.remote” = { [机器]: [space id 列表] },在该机器 layout 就绪期间记录。
function watchRemoteSpaces(spaces) {
  const seen = shared("coordinator.seen.remote") ?? {};
  let next = null, fresh = [];
  for (const m of machines()) {
    if (m.name == null) continue;
    if (m.layout !== "ready") { wasReady.delete(m.name); continue; }
    const mine = spaces.filter((s) => s.machine === m.name).map((s) => s.id);
    const before = seen[m.name];
    const back = !wasReady.has(m.name);
    wasReady.add(m.name);
    if (!Array.isArray(before) || back) {
      if (JSON.stringify(before) !== JSON.stringify(mine)) (next ??= { ...seen })[m.name] = mine;
      continue;
    }
    const add = mine.filter((id) => !before.includes(id));
    if (!add.length && before.every((id) => mine.includes(id))) continue;
    // 尚不确定它是否有自己的窗口:下次再看。
    if (add.length && hasOwnWindow(m.name) === null) continue;
    (next ??= { ...seen })[m.name] = mine;
    if (!hasOwnWindow(m.name)) fresh.push(...spaces.filter((s) => add.includes(s.id)));
  }
  if (next) setShared("coordinator.seen.remote", next);
  return fresh;
}

// agent 正在处理的 task(herdr-task):其 key,或 null。
export const taskOf = (k) => k?.labels?.["herdr.task"] ?? null;

// 通过 herdr-task 在其 tab 中重启 task 的 agent,按 `agentKey` 或按原样。
export const switchTask = (k, agentKey) =>
  script("task", [taskOf(k), k.foreground?.cwd ?? k.cwd, parentOf(k) ?? "", ...(agentKey ? [agentKey] : [])]);

// 在其 tab 中重启 agent `k`:带 `argv` 时按该 agent;不带时按原样
// (重新按 template 生成 coordinator,使修改后的 instructions 生效)。
export const restartAgent = (k, argv) => script("restart", argv ? [k.address, JSON.stringify(argv)] : [k.address]);

// 关闭 tab。有在世 workers 的 coordinator 会先询问;space 的最后一个 tab 会关闭该 space,
// 因此像 Close space 一样询问(用我们的 confirm,而非 Herdr 的)。
export function closeTab(tabId) {
  const c = coordinatorIn(tabId);
  if (c && workersOf(c).length) {
    openOverlay({ mod: "coordinator", kind: "dialog", width: 440, height: 336, props: { view: "close", tab: tabId } });
    return;
  }
  const space = allSpaces().find((s) => s.tabs.some((x) => x.id === tabId));
  if (space?.tabs.length === 1) return closeSpace(space.id);
  run("tab.close", { id: tabId });
}

// 重命名 tab:用我们的 prompt(mods/prompt-chat,应用的统一 dialog footer),字段中预填
// 给定名称(无人命名时为空:保留其编号)。
export function renameTab(tab) {
  openOverlay({ mod: "prompt-chat", kind: "dialog", width: 400, height: 196, props: { title: "重命名标签页",
    value: tab?.named ? tab.name : "", placeholder: tab?.name ?? "", command: { name: "tab.rename", args: { id: tab?.id } } } });
}

// space 的 Rename 和 Close,与其 sidebar 菜单的做法一致(mods/spaces-chat):Rename 对话框
// (名称和图标),并在 Herdr 关闭前用我们的 confirm(mods/confirm-chat)。
export function renameSpace(id) {
  openOverlay({ mod: "spaces-chat", kind: "dialog", frame: "none", width: 380, height: 172, props: { view: "rename", space: id } });
}
export function closeSpace(id) {
  const name = allSpaces().find((s) => s.id === id)?.name;
  openOverlay({ mod: "confirm-chat", kind: "dialog", width: 400, height: 168, props: {
    title: name && name !== "~" ? `Close \u201c${name}\u201d?` : "Close this space?",
    detail: "它的标签页会关闭,其中所有程序都会结束。", verb: "关闭空间",
    command: { name: "space.close", args: { id, confirmed: true } } } });
  logSpace("close", id, "coordinator.js closeSpace (asks in confirm-chat)");
}

// 元素在窗口中的位置,由其上的鼠标事件得出:{ x, y, width, height }。
export const rectOf = (e) => ({ x: e.position.x - (e.local_position?.x ?? 0), y: e.position.y - (e.local_position?.y ?? 0),
  width: e.bounds?.width ?? 0, height: e.bounds?.height ?? 0 });

// 宽 `width` 的子菜单在宽 `menu` 的菜单旁、其所属行处打开的位置:右侧
// 若在 `right`(窗口右缘,若已知)之前放得下则显示在菜单处,否则在其左;其
// 首行与该行齐平(菜单行有 5 px 内边距)。保持在窗口内部。
export function besideRow(row, menu, width, right) {
  const left = row.x - 5, edge = left + menu;
  const fits = right != null && edge + 4 + width <= right - 8;
  let x = fits ? edge + 4 : left - 4 - width;
  if (x < 8) x = right != null ? Math.min(edge + 4, right - 8 - width) : edge + 4;
  return { x: Math.max(8, x), y: Math.max(8, row.y - 5) };
}

// 结束 coordinator 的 tab;“stop” 先结束其 workers。
export const closeCoordinator = (tabId, coord, mode) => script("close", [tabId, coord.address, mode]);
