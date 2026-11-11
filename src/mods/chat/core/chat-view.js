// Shared core:源文件为 core/chat-view.js;bin/sync-shared 复制进 mods/chat/core/。请在此处编辑。
// 聊天行,窗口端聊天(mods/chat)与 web 端聊天(web/plugins/chat)的绘制方式
// 同样:它们的文字、消息时间、消息发送者、启动简报的标签、任务的新闻行,以及
// artifact 由 publish 产生,以及消息下方图片的尺寸规则。纯 JS:不依赖 herdr、node 或 DOM。

// 聊天显示的每个固定词句,只在此一处:两端都从这里读取(core/chat-view.test.js 校验)。
export const WORDS = {
  top: "对话开始",
  loading: "加载更早的消息…",
  find: "在对话中查找",
  noMatches: "无匹配",
  searchEarlier: "向前搜索",
  needsYou: "需要你",
 // 子 agent 行的状态,以及其展开方式
  subDone: "完成",
  subOpen: "打开它的对话",
  askingInTerminal: "agent 正在终端里提问。",
  openTerminal: "打开终端",
  replyInstead: "改为回复…",
  showMore: "展开",
  showLess: "收起",
  queued: "排队中 · 空闲时发送",
  // 在其工作期间输入:进入其 CLI 的队列,下一步时接收(Claude Code 自带的队列)
  inQueue: "排队中 · 下一步读取",
  sendNow: "立即发送",
  // 对其队列中 CLI 未立即接收的一条 Send now(其屏幕没有 "ctrl+enter to send now")
  notNow: "它现在没接住",
  ended: "此任务的 agent 已结束。",
  resuming: "恢复中…",
  emptyTitle: "让 Assistant 做什么?",
  emptyBody: "它规划工作,为每部分启动任务,随时向你汇报。",
  late: "不在对话中。请查看终端。",
  // 请求的 Assistant 所在机器离线时:其第一条消息等待机器恢复
  offline: (machine) => `${machine} is offline. The Assistant starts when it's back.`,
  publishing: "正在发布工件…",
  stopping: "停止中…",
  working: "进行中",
  asked: "问过你",
  askedAnswered: "问过你 · 已回答",
  askedClosed: "问过你 · 未回答关闭",
  attach: "附加文件",
  latest: "最新",
  // 以全屏提示代替会话。
  opening: "正在打开对话…",
  restarting: "正在重启 agent…",
  agentEnded: "此 agent 已结束",
  taskEnded: "此任务的 agent 已结束",
  unsupported: "此 agent 没有对话",
  unsupportedBody: "Chat reads Claude Code's and Codex's own session logs. This agent works in its terminal only.",
  notFound: "找不到此对话",
  notFoundBody: "Chat reads the agent's own session log, and Herdr can't tell which one this agent writes. Rather than show the wrong one, it shows none.",
  noAgent: "没有可显示的 agent",
  noAgentBody: "此对话窗格未绑定 agent。",
  startingAssistant: "正在启动 Assistant…",
  sessionGone: "早前的会话已丢失,正在开新会话…",
};

// // ---- 已丢失的会话 ------------------------------------------------------------------
// Claude Code:"No conversation found with session ID: …"。Codex:"ERROR: No saved session found with ID …"。
export const LOST = /\bno (?:saved )?(?:conversation|session|rollout)\b.*\bfound\b|\b(?:conversation|session)\b.*\bnot found\b/i;
// 先前会话已丢失时新 agent 听到的话(herdr-winapp 的措辞);聊天以一行淡字显示。
export const FRESH = "Your earlier session is gone, so this is a new one that remembers none of it. Check what is already here and preserve existing work.";
// 新 agent 的第一条消息:交接内容、其任务(worker 的),以及再次说明 Assistant 的角色(其模板的
// 文字,位于 front matter 之后)。
export function lostMessage({ ref = null, template = null } = {}) {
  let msg = `<restart>${FRESH}</restart>`;
  if (ref) msg += `\n\nYou work on task ${ref}: read its brief with \`herdr-task show ${ref}\` and carry on from what is already done.`;
  const body = String(template ?? "").split(/^---[ \t]*$/m).slice(2).join("---").trim();
  if (body) msg = `${msg}\n\n${body}`;
  return msg;
}
// 把一个词转成 shell 行,必要时加引号。
export const shellWord = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'"'"'`)}'`);
export const sessionStarted = "早前的会话已丢失,已开新会话。";
export const sessionFailed = (why) => `Earlier session was gone, and a new one didn't start: ${why}`;

// "1 image", "3 images": images sent with a message whose files the chat can't show.
export const imagesLine = (n) => (n === 1 ? "1 image" : `${n} images`);
// Scrolled up: cards waiting below what shows ("1 question below"), else Latest.
export const questionsBelow = (n) => (n === 1 ? "1 question below" : n ? `${n} questions below` : WORDS.latest);
// A message that didn't go: why, and that a press sends it again.
export const notSent = (why) => `Not sent: ${String(why ?? "").replace(/\.$/, "")}. Click to try again.`;
// An earlier publish of an artifact, as one quiet line; the latest one's card.
export const published = (title, v) => `Published ${title} v${v}`;
export const artifactLine = (v) => `Artifact · v${v}`;
// a video an agent showed, in the window (which can't play one): a line that opens it in the system's player
export const videoLine = (name) => `${name} · Video`;
// m:ss, for the working line, a recording and a call.
export const elapsed = (secs) => `${Math.floor(Math.max(0, secs) / 60)}:${String(Math.floor(Math.max(0, secs)) % 60).padStart(2, "0")}`;

// What the agent's CLI says it does or waits for now (its status report: Claude Code's "Computing build times", a
// question's "answer: …"), from its terminal. The window's terminals() hands it over as `report`; herdr-core's own
// record (the service's) keeps it in `status`, an object while the CLI reports one. "" when it says nothing.
export function reportMsg(t) {
  for (const r of [t?.report, t?.status]) if (r && typeof r === "object" && typeof r.msg === "string" && r.msg.trim()) return r.msg.trim();
  return "";
}
// The working line's words: the call its log has open now, else its status report (not a question), else null
// (the line says Working).
export const doingWords = (conv, report) => conv?.doing ?? (report && !/^answer:/i.test(report) ? report : null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// The calendar day a time falls on, to tell where a new one starts.
export const dayOf = (at) => dayStart(new Date(at));

// A day's line between messages: Today, Yesterday, a weekday this week, else its date (and year, if not this one).
export function dayLabel(at, now = new Date()) {
  const d = new Date(at);
  const days = Math.round((dayStart(now) - dayStart(d)) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return DAYS[d.getDay()];
  return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}
// A message's time under it: 14:05 today, else 3 Nov 14:05.
export function clock(at, now = new Date()) {
  if (!at) return "";
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getDate()} ${MONTHS[d.getMonth()]} ${hm}`;
}

// The actions under a message, in order: reply and copy; then the CLI's rewind on your own (not a /command, not one
// another agent sent), or its fork on the agent's (when the CLI is known).
export function bandActs(side, text, { from = null, fork = true } = {}) {
  if (side === "user") return ["reply", "copy", ...(/^\//.test(String(text ?? "")) || from ? [] : ["rewind"])];
  return ["reply", "copy", ...(fork ? ["fork"] : [])];
}

// The whole band, in order from left to right (DECISIONS, Chat > Message actions): the reaction pills flush under the
// bubble's outer edge with the smiley beside them, each side the other's mirror. Yours: the time, its actions, the
// smiley, then the pills furthest right; the agent's: the pills furthest left, the smiley, its actions reversed and
// the time at the inner end. `acts`: bandActs(); `time` false leaves the time out, `react` false the smiley.
export function bandOrder(side, acts, { time = true, react = true } = {}) {
  const lead = [...(time ? ["time"] : []), ...acts];
  const smiley = react ? ["react"] : [];
  return side === "user" ? [...lead, ...smiley, "pills"] : ["pills", ...smiley, ...lead.reverse()];
}

// A message another agent sent with hc often names its sender in its first words ("From (t12u?): …", "From
// 用户在 m3 的 Assistant(t10v): …”)。
// 安静行已标明身份,预览从其后开始;发送方地址未知时以名称代替
// 未知。
const SIGNED = /^\s*(?:\*\*)?(?:[Mm]essage\s+)?[Ff]rom\s+(?:the person's\s+|your\s+)?([A-Z][\w.-]*(?:\s+[\w.-]+){0,2}?)\s*(?:\([^)\n]{0,40}\))?\s*:(?:\*\*)?\s*/;
export const signedBy = (text) => SIGNED.exec(String(text ?? ""))?.[1]?.trim() || null;
export const unsigned = (text) => String(text ?? "").replace(SIGNED, "");

// A sender outside any terminal: from="<machine>/ppid:123" (a script, a service, or a window that named its process).
export const outsideTerminal = (from) => /(^|\/)ppid:\d+$/.test(String(from ?? "").trim().split(/\s+/)[0]);

// The person's own words that came wrapped as a message from outside any terminal (a window or service on another
// 其 send 指明了进程的 machine,早于 ):均为用户片刻前在此聊天中发出的,带有
// 相同文字(matches(u, p):聊天自身的判断,确认日志消息 u 即待发送 p)。来自
// terminal(即 agent)不计入,刚由本端发出的也不计。users:日志中的用户消息;返回其 id。
export function ownWords(users, pending, matches) {
  const ids = [];
  for (const p of pending ?? []) {
    const u = (users ?? []).find((u) => !ids.includes(u.id) && matches(u, p));
    if (u?.from && outsideTerminal(u.from)) ids.push(u.id);
  }
  return ids;
}

// 经 hc 发送消息的一方(<hc from="t7 herd-12-fix-login">):人们所知的其角色或任务("Reviewer",
// ""、"Assistant on vm-ssa"),绝不显示其终端地址。artifact 的表单写其标题;用户自己的
// 行(已保存的 secret)显示为 “You”。terminal 之外的发送方(from="<machine>/ppid:123")或已消失的按
// 其签署消息所用的名称,否则 "Another agent"。
// find(address):该终端({ name, labels, template }),否则 null;machine:chat 所属 agent 的机器(null:
// 这边);taskOf(address):该地址作为 worker 的任务 ref,否则 null;here:本机在
// herdr-core:另一台机器的 agent 把我们的终端写成 "<here>/t75",我们的列表记作 "t75";machineName(key):
// 用户可读的机器名称("Mac mini"),否则 null(此时用其键)。
export function senderName(from, text = null, { find = () => null, machine = null, taskOf = () => null, here = null, machineName = () => null } = {}) {
  const [addr, ...rest] = String(from ?? "").trim().split(/\s+/);
  const signed = signedBy(text);
  if (addr === "person") return "You";
  if (outsideTerminal(addr)) return signed || "换一个 agent";
  if (!/^([\w.-]+\/)?t\d[0-9a-z]*$/.test(addr ?? "")) return String(from);
  // 不带前缀的 address 位于其收件 agent 所在的机器上。
  const full = !addr.includes("/") && machine ? `${machine}/${addr}` : addr;
  const local = here && full.startsWith(`${here}/`) ? full.slice(here.length + 1) : null;
  const k = find(full) ?? (local ? find(local) : null);
  const l = k?.labels ?? {}, name = rest.join(" ") || k?.name || "";
  // 其运行位置(null:本机),在与聊天 agent 所在处不同时标注。
  const at = local ? null : full.includes("/") ? full.split("/")[0] : null;
  const away = at !== machine && (at ?? here) ? ` on ${machineName(at ?? here) || (at ?? here)}` : "";
  if (l["herdr.role"] === "reviewer" || /\breview/i.test(name)) return "Reviewer";
  if (l["herdr.role"] === "coordinator" || /^(herdr-)?(assistant|coordinator)\b/.test(k?.template ?? "") || /^coord/i.test(name)) return `Assistant${away}`;
  const task = taskOf(full) ?? (local ? taskOf(local) : null) ?? /^([a-z][a-z0-9]*)-(\d+)(?:-|$)/i.exec(name)?.slice(1, 3).join("-").toUpperCase();
  if (task) return `${task}${away}`;
  if (!name && signed && / on /.test(signed)) return signed;
  return `${name || signed || "换一个 agent"}${away}`;
}

// agent 之间,以群聊形式。另一 agent 发来的 user item,其发送者:另一个 Assistant 的
// (<herdr-assistant>,x.assistant: { machine, space })按其 machine 和 space 显示("Assistant on Mac mini · Home";其
// 为本机时不标 machine),否则用 senderName 的(""、"Reviewer"、"Assistant on m3")。
// sender(from, text):带 chat 查询的 senderName;machineName(key):用户可读的机器名称
// key(null:未知);here:本机在 herdr-core 中的键。
export function fromName(x, sender = (f) => f, { machineName = (m) => m, here = null } = {}) {
  const a = x?.assistant;
  if (!a) return sender(x?.from, x?.text);
  const m = a.machine && a.machine !== here ? machineName(a.machine) || a.machine : null;
  return `Assistant${m ? ` on ${m}` : ""}${a.space ? ` · ${a.space}` : ""}`;
}

// 聊天 agent 发出的消息送给了谁("sent" 条目:{ to, how }):按 senderName 显示终端("",
// "Assistant on m3");tell-assistant 的目标是 Assistant,按其 address 或其 space 名称("Assistant ·
// Home")。
export function sentTo(x, sender = (f) => f) {
  const to = String(x?.to ?? "");
  const address = /^([\w.>-]+\/)?t\d[0-9a-z]*$/.test(to);
  if (x?.how !== "assistant") return address ? sender(to.split(">").pop()) : to;
  if (!address) return `Assistant · ${to}`;
  return String(sender(to.split(">").pop())).replace(/^(Another agent|t\d[0-9a-z]*)\b/, "Assistant");
}

// 聊天自身 agent 在群聊中的身份:space 的为 "Assistant",任务的 worker 用其任务 ref,否则
// 其 CLI 的名称(“Claude”)。
export function selfName({ assistant = false, task = null, kind = null } = {}) {
  if (assistant) return "Assistant";
  if (task) return task;
  return { claude: "Claude", codex: "Codex" }[kind] ?? "Agent";
}

// 头像用的首字母:任务 ref 的首字母("" → "S"),否则取第一个字母。
export const initialOf = (name) => (String(name ?? "").trim().match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();

// 会话的第一条消息:第一条用户消息,而非 items[0](:从它读出的行,如任务新闻,排在
// 在其之前)。-1:无。
export const firstUser = (items) => (items ?? []).findIndex((x) => x?.kind === "user");

// Assistant 首句话(其聊天启动它时用户的提问)在以下目录中的存档名
// data/chat-first/<name>.txt:窗口端聊天写入其 slot 的(否则其 origin 的),web 端写入其 slot 的(否则
// agent 的地址)。按 agent 地址重新打开的聊天(reload 后)靠其标签找到它们(#592)。
export function firstKeys({ slot = null, labels = {}, origin = null, addr = null } = {}) {
  return [...new Set([slot, labels?.["herdr.chat.slot"], labels?.["herdr.chat.origin"], origin, addr].filter(Boolean).map(String))];
}

// 用户输入的内容,以按原样显示的 markdown 呈现(#591):用户写的 "<" 或 "&" 只是字符,不是
// HTML 或实体("B1 = <yours>" 保留了 "<yours>")。代码,fenced 或 inline,原样保留。
export function literal(text) {
  return String(text ?? "").split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/</g, "\\<").replace(/&(?=#?\w+;)/g, "\\&"))).join("");
}

// A user message the person didn't type, in words for its quiet row, else null: the session's first message when the
// agent was started from a template (a coordinator), as a handoff, or for a task (herdr-task); and any message
// another agent sent with hc. i: its place in the conversation; start: the first byte read (0: the log's start).
// first: where the session's first message is in the conversation (firstUser()).
export function briefLabel(x, i, { start = null, template = null, task = false, sender = (f) => f, machineName = (m) => m, here = null, first = 0 } = {}) {
  if (x.from) return `Message from ${fromName(x, sender, { machineName, here })}`;
  if (i !== first || start !== 0) return null;
  if (/^<restart>/.test(x.text ?? "")) return "New session";
  if (/^You are taking over this tab/.test(x.text ?? "") || /^herdr-handoff/.test(template ?? "")) return "Handoff from the previous agent";
  if (template) return "新会话";
  if (task) return "任务简介";
  return null;
}

// A task's news line: { mark (its dot), what (happened), text (the rest) }. Herdr's line is "needs you: Needs
// a go (Fix login)", "is ready: Fix login · summary", ...: without the id and the title, split at its first
// ": ". e: { ref, event, text, made } (made: from the task's own record, not a line Herdr sent); x: the task.
export function newsWords(e, x) {
  const mark = { started: "started", "working-again": "started", "needs-you": "needs", failed: "needs", ready: "ready", done: "done" }[e.event] ?? "other";
  const title = x?.title ?? "", one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  if (e.made) return { mark, what: e.event, text: e.event === "ready" ? one(x?.summary) || title : title };
  let s = one(e.text);
  if (s.startsWith(`${e.ref} `)) s = s.slice(e.ref.length + 1);
  // Every line but ready's ends with the title in brackets.
  let named = title;
  if (e.event !== "ready") {
    const m = title && s.endsWith(` (${one(title)})`) ? [null, one(title)] : / \(([^()]*)\)$/.exec(s);
    if (m) { named = m[1]; s = s.slice(0, s.length - m[1].length - 3); }
  }
  const i = s.indexOf(": ");
  const what = (i < 0 ? s : s.slice(0, i)).replace(/^is /, "") || e.event;
  let text = i < 0 ? "" : s.slice(i + 2);
  if (e.event === "ready") {
    text = text.replace(/ · For AGENTS\.md: .*$/, "");
    if (title && text.startsWith(one(title))) text = text.slice(one(title).length).replace(/^ · /, "") || one(title);
  }
  if (e.event === "done") text = named;
  return { mark, what, text };
}

// The lines a space's tasks make in its Assistant's chat, in time order, each { id, at, ref, event, text, made }:
// Herdr's news in the conversation (items of kind "news") as said, and a start, ready or done it never said here
// (before this log's first page, or not sent) from the task's own started / ready_at / done_at. tasks: Map ref -> task.
// Each comes with live (needs you still, red) and accept (the newest ready line of a task still Ready).
export function newsTimeline(items, tasks, { start = null } = {}) {
  const all = [], said = new Set();
  for (const it of items) if (it.kind === "news") { said.add(`${it.ref}:${it.event}`); all.push(it); }
  const first = items.find((x) => x.at)?.at ?? 0;
  for (const [ref, x] of tasks) for (const [event, at] of [["started", x.started], ["ready", x.ready_at], ["done", x.done_at]]) {
    if (!Number.isFinite(at) || said.has(`${ref}:${event}`) || (at < first && start !== 0)) continue;
 // A ready not yet said, while the task is still at work (its checks running, ) or needs the person: not ready yet.
    if (event === "ready" && !["ready", "done"].includes(x.status)) continue;
    all.push({ id: `tn:${ref}:${event}:${at}`, at, ref, event, text: "", made: true });
  }
  all.sort((a, b) => a.at - b.at);
  const last = new Map(), lastReady = new Map();
  for (const e of all) { last.set(e.ref, e); if (e.event === "ready") lastReady.set(e.ref, e); }
  return all.map((e) => {
    const x = tasks.get(e.ref);
    return { ...e, ...newsWords(e, x), live: last.get(e.ref) === e && (e.event === "needs-you" || e.event === "failed") && x?.status === "needs",
      accept: lastReady.get(e.ref) === e && x?.status === "ready" };
  });
}

// Which artifact each publish in the conversation made: the first version this agent published from a few seconds
// before the call to five minutes after, not already taken. items: the conversation's; arts: the registry's
// artifacts ({ id, title, version, versions: [{ v, at, publisher }] }); me: the agent's terminal (no machine).
// -> Map item id -> { id, title, version (its latest), v (this publish's), latest (the last publish of it here) }.
export function resolveArtifacts(items, arts, me) {
  const out = new Map();
  const calls = items.filter((x) => x.kind === "artifact");
  if (!calls.length || !arts?.length) return out;
  const vs = arts.flatMap((a) => (a.versions ?? []).filter((v) => v.publisher === me).map((v) => ({ a, v }))).sort((p, q) => p.v.at - q.v.at);
  const used = new Set();
  for (const x of calls) {
    const at = x.at ?? 0;
    const hit = vs.find(({ a, v }) => !used.has(`${a.id}:${v.v}`) && v.at >= at - 5000 && v.at <= at + 300000);
    if (!hit) continue;
    used.add(`${hit.a.id}:${hit.v.v}`);
    out.set(x.id, { id: hit.a.id, title: hit.a.title, version: hit.a.version, v: hit.v.v });
  }
  const last = new Map();
  for (const [k, r] of out) last.set(r.id, k);
  for (const [k, r] of out) r.latest = last.get(r.id) === k;
  return out;
}

// Image thumbnails under a message: each image whole, its shape kept, fitted in THUMB_ONE (one image) or THUMB_MANY
// (w, h), never above its own size, all shrunk together when the row would pass the column (width). sizes: each
// image's { w, h }, or null until known (a 4:3 box). -> { boxes: [{ w, h }], h: the row's height }.
export const THUMB_ONE = [320, 220], THUMB_MANY = [200, 140], THUMB_GAP = 6;
export function fitThumbs(sizes, width = Infinity) {
  const [mw, mh] = sizes.length > 1 ? THUMB_MANY : THUMB_ONE;
  let boxes = sizes.map((v) => {
    if (!v?.w || !v?.h) return { w: Math.round((mh * 4) / 3), h: mh };
    const k = Math.min(1, mw / v.w, mh / v.h);
    return { w: Math.max(24, Math.round(v.w * k)), h: Math.max(24, Math.round(v.h * k)) };
  });
  const total = boxes.reduce((n, b) => n + b.w, 0) + THUMB_GAP * (boxes.length - 1);
  const k = Math.min(1, width / Math.max(1, total));
  if (k < 1) boxes = boxes.map((b) => ({ w: Math.floor(b.w * k), h: Math.floor(b.h * k) }));
  return { boxes, h: Math.max(24, ...boxes.map((b) => b.h)) };
}

// ---- subagents: an agent's own helper agents in herdr----
// What a worker (or an Assistant) starts with `hc run` for itself: a reviewer, a second opinion. Each is an hc child of
// its terminal, labelled herdr.role reviewer or helper (herdr.task: its worker's task). Never a task's worker (an
// Assistant's children are mostly workers: herdr.task without a helper role) nor an Assistant. Shown over its parent's
// chat as a subagent row: its role and CLI, working / needs / done, how long, opening to its last messages and its own
// chat. One that ended stays a while (it reported, its parent ended it).
export const HELPER_ROLES = ["reviewer", "helper"];
export const subagentWord = (status) => (status === "working" ? WORDS.working : status === "needs" ? WORDS.needsYou : WORDS.subDone);
export const SUBAGENT_KEEP_MS = 60 * 60000;

// ---- the rows over the box, grouped----
// Several subagents or background shells stacked over the box ate a phone's screen: each kind takes at most one row.
// One of a kind shows as its own row; two or more as one group row ("3 background processes"), its newest's title, how
// long that one has run and their shared state, opening in place to the list of them, each opening as before.
const SUB_KINDS = ["agent", "headless", "child"];
// shared by a group of subagents: one asking makes it ask, else one at work makes it work, else all are done
const sharedStatus = (items) =>
  items.some((j) => j.status === "needs") ? "needs" : items.some((j) => !j.status || j.status === "working") ? "working" : "done";
export function bgGroups(items) {
  const sub = items.filter((j) => SUB_KINDS.includes(j.kind));
  const proc = items.filter((j) => !SUB_KINDS.includes(j.kind));
  const group = (kind, list) => {
    const newest = list.reduce((a, b) => ((b.at ?? 0) > (a.at ?? 0) ? b : a));
    const n = list.length;
    const words = n < 2 ? null : kind === "sub" ? `${n} subagents` : `${n} background processes`;
    return { kind, items: list, newest, status: kind === "sub" ? sharedStatus(list) : "working", words };
  };
  return [...(sub.length ? [group("sub", sub)] : []), ...(proc.length ? [group("proc", proc)] : [])];
}
const roleOf = (k) => k?.labels?.["herdr.role"] ?? null;
export const isHelper = (k) => HELPER_ROLES.includes(roleOf(k)) && !!k?.parent;

// k's parent, as an address comparable with `addr`: another machine's terminal names its parent on that machine ("t5"
// for "vm/t5").
function parentAddr(k) {
  const p = String(k?.parent ?? "");
  if (!p) return null;
  const m = String(k.address ?? "").includes("/") ? String(k.address).split("/")[0] : null;
  return m && !p.includes("/") ? `${m}/${p}` : p;
}

const AGENTS = { codex: "Codex", claude: "Claude Code", "claude-code": "Claude Code", pi: "Pi" };
// its CLI: its herdr.agent label, else what hc says runs in it, else its command's name
export function subagentCli(k) {
  const a = k?.labels?.["herdr.agent"] ?? k?.agent ?? null;
  if (a) return String(a).replace(/^claude-code$/, "claude");
  const argv = k?.foreground?.argv ?? k?.argv ?? [];
  const prog = argv.map((x) => String(x).split("/").pop()).find((x) => /^(claude|codex|pi)$/.test(x));
  return prog ?? null;
}

// "Reviewer · Codex"
export function subagentTitle(s) {
  const role = s.role === "reviewer" ? "Reviewer" : s.role && s.role !== "helper" ? s.role[0].toUpperCase() + s.role.slice(1) : "Helper";
  return [role, AGENTS[s.cli] ?? (s.cli ? s.cli[0].toUpperCase() + s.cli.slice(1) : null)].filter(Boolean).join(" · ");
}

// how it is: "working", "needs" (it asks in its terminal) or "done" (its turn over, or it ended)
export function subagentStatus(k) {
  if (k?.state && k.state !== "live") return "done";
  const st = typeof k?.status === "object" ? k.status?.state : k?.status;
  return st === "working" ? "working" : st === "blocked" ? "needs" : "done";
}

// The subagents of the terminal at `addr`, oldest first: [{ address, role, cli, title, status, at, ended?, name }].
// terms: every terminal hc knows (live and finished).
export function subagentsOf(terms, addr, now = Date.now()) {
  if (!addr) return [];
  const out = [];
  for (const k of terms) {
    if (!k || !isHelper(k) || parentAddr(k) !== addr) continue;
    const ended = k.state && k.state !== "live";
    if (ended && now - (k.finished_ms ?? 0) > SUBAGENT_KEEP_MS) continue;
    const s = { address: k.address, role: roleOf(k), cli: subagentCli(k), status: subagentStatus(k), at: k.created_ms ?? now, name: k.name ?? null, ...(ended ? { ended: k.finished_ms ?? now } : {}) };
    out.push({ ...s, title: subagentTitle(s) });
  }
  return out.sort((a, b) => a.at - b.at);
}

// Media an agent puts in its message: a Markdown picture ![alt](path) or a link [words](path) to a local
// image or video file (an absolute path, ~/…, file://… or one relative to its folder). The chat shows each one right
// there, under the words (pictures as thumbnails, a video with a player), and keeps the rest of the words as they are:
// a picture leaves the words, a link leaves its own words. Code (fenced or `inline`) is never read for media, and a web
// address stays a link. { text, media: [{ path, name, alt, kind: "image" | "video" }] }, each path once, at most 12.
export const MEDIA_IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
export const MEDIA_VIDEO = /\.(mp4|m4v|webm|mov|ogv)$/i;
export const mediaKind = (name) => (MEDIA_IMAGE.test(String(name ?? "")) ? "image" : MEDIA_VIDEO.test(String(name ?? "")) ? "video" : null);
const MEDIA_MAX = 12;
export function mediaIn(text, { cwd = null, home = null } = {}) {
  const src = String(text ?? "");
  if (!src.includes("](")) return { text: src, media: [] };
  const media = [];
  const where = (raw) => {
    let p = raw.trim().replace(/^<(.*)>$/, "$1");
    if (/^file:\/\//i.test(p)) { try { p = decodeURIComponent(p.slice(7)); } catch { return null; } }
    else if (/^[a-z][\w+.-]*:/i.test(p) || p.startsWith("#") || p.startsWith("//")) return null;
    p = p.replace(/[?#].*$/, "");
    if (!p || !mediaKind(p)) return null;
    if (p.startsWith("~/")) p = home ? `${home.replace(/\/$/, "")}/${p.slice(2)}` : p;
    else if (!p.startsWith("/")) { if (!cwd) return null; p = `${cwd.replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`; }
    // 无法向上跳出其所述范围
    if (p.split("/").includes("..")) return null;
    return p;
  };
  // 每张图片原来的位置:原处一个标记,下方再读一次(\u0000 不会出现在消息里)
  const take = (path, alt) => {
    let i = media.findIndex((m) => m.path === path);
    if (i < 0 && media.length < MEDIA_MAX) i = media.push({ path, name: path.split("/").pop(), alt: alt.trim(), kind: mediaKind(path) }) - 1;
    return i;
  };
  // 代码之外的文字:fenced 块与行内代码保持原样
  const parts = src.split(/(^ {0,3}(?:```|~~~)[^\n]*\n[\s\S]*?(?:\n {0,3}(?:```|~~~)[^\n]*(?:\n|$)|$))/m);
  const out = parts.map((part, i) => {
    if (i % 2) return part;
    return part.split(/(`+[^`]*`+)/).map((bit, j) => {
      if (j % 2) return bit;
      return bit.replace(/(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"[^"\n]*")?\s*\)/g, (whole, bang, words, target) => {
        const path = where(target);
        if (!path) return whole;
        const i = take(path, words);
        return bang ? (i >= 0 ? `\u0000${i}\u0000` : "") : words;
      });
    }).join("");
  }).join("");
  if (!media.length) return { text: src, media };
  // a line with one picture and a short label ("Before:", "**After**") gives the picture its caption and goes; the lines
  // a picture leaves empty go, and the gaps they leave close
  const lines = out.split("\n").flatMap((l) => {
    const marks = [...l.matchAll(/\u0000(\d+)\u0000/g)];
    if (!marks.length) return [l.replace(/[ \t]+$/, "")];
    const rest = l.replace(/\u0000\d+\u0000/g, "").replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
    const label = rest.replace(/^[*_]+|[*_]+$/g, "").replace(/:$/, "").replace(/^[*_]+|[*_]+$/g, "").trim();
    if (marks.length === 1 && label && rest.length <= 40 && (/:[*_]*$/.test(rest) || /^[*_]/.test(rest))) { media[Number(marks[0][1])].alt = label; return []; }
    return rest ? [l.replace(/\u0000\d+\u0000[ \t]*/g, "").replace(/[ \t]+$/, "")] : [];
  });
  const words = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: words, media };
}
