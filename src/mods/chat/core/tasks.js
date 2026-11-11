// 任务在用户眼中的呈现:状态(七种之一,与 herdr-task 一致)、需要用户的原因、其
// 第二行、组内顺序以及时间措辞。规则与 herdr-task 的 task_status() 相同,
// 供 Tasks panel(mods/tasks)和 web app 共用:Herdr 实时掌握的信息(任务的 agent 及其
// 状态)以参数传入,因此这里不直接读取 Herdr。
// 共享 core:源文件是 core/tasks.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的 mods 里。
import { REASONS } from "./needs.js";

// agent 自身的状态,按紧急程度从高到低。
export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
export const STATUS = { needs: "需要你", working: "进行中", merging: "合并中", ready: "就绪", queued: "排队中", scheduled: "已排期", todo: "待办", done: "完成" };
export const RANK_OF = Object.fromEntries(["needs", "ready", "merging", "working", "queued", "scheduled", "todo", "done"].map((id, i) => [id, i]));
// 列表的顺序:各分组,以及过滤行的 chips。
// Scheduled:到时自动启动的任务,排在 Queued 之后(等待时间更长)。
export const ORDER = ["needs", "ready", "merging", "working", "queued", "scheduled", "todo", "done", "automations"];
// 列表可用的分组方式(⋯ 菜单的 Group by;即 herdr-winapp 的 GROUP_WORDS)。"folder" 是 Space 的旧键。
export const GROUP_BY = ["you", "space", "status"];
// 分组的 key:“folder” 即 Space;Machine 和 Machine › Space 已移除:For you。
export const groupBy = (v) => (v === "folder" ? "space" : GROUP_BY.includes(v) ? v : "you");
// 窗口当前的分组方式(shared "tasks.group",来自其 ⋯ 菜单),未选择前为 For you。之前
// 当时是 "tasks.groupby",Status 默认按 space 拆分:关闭 Split by space 的 Status 仍显示为
// Status、Space 保持原名,其余为 For you。shared:窗口的 shared(key)。
export const groupNow = (shared) => {
  const v = shared("tasks.group");
  if (v) return groupBy(v);
  const old = shared("tasks.groupby");
  return old === "space" || old === "folder" ? "space" : old === "status" && shared("tasks.split") === false ? "status" : "you";
};

export const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);
// 用户所读的机器(Spaces sidebar 中的文字):其名称,或 This computer。
export const machineName = (m) => m ?? "本机";

// 由另一文件夹的任务事件触发的自动化(herdr-task auto --from),其行的第二行这样描述:
// 事件,然后是触发位置("On merges in vm-b · herdr-winapp")。
const FROM_EVENTS = { added: "新任务", ready: "就绪任务", failed: "失败", "needs-you": "需要你的任务", merged: "合并", stalled: "卡住" };
export function fromLine(events, where) {
  const words = (events ?? []).map((e) => FROM_EVENTS[e] ?? e);
  return `On ${words.length && words.length < 3 ? words.join(" or ") : "任务事件"} in ${where}`;
}

// automation 行对其位置的描述:其 machine 和 space,均随分组方式而定(Automations
// 分组不置于任何机器或 space 标题之下);仅当多台机器都有任务时才显示其机器。
export const autoWhere = (machine, space, multi) => [multi ? machine : null, space].filter(Boolean).join(" · ") || null;
// 本 space:任务、自动化或 Needs-you 条目属于该 space 的条件是它位于
// space 的 machine,且其列表的 folder 是该 space 的 folder,或它是为该 space 启动的(space id
// herdr-task 保存的内容:"sp3",从其他机器读取后为 "vm/sp3")。space:{ id, machine, folder };
// 归属:{ machine, folder, space }。
const bareId = (id) => (id == null ? null : String(id).slice(String(id).lastIndexOf("/") + 1));
export function inSpace(space, thing) {
  if (!space || !thing || (thing.machine ?? null) !== (space.machine ?? null)) return false;
  return (Boolean(thing.folder) && thing.folder === space.folder) || (thing.space != null && bareId(thing.space) === bareId(space.id));
}
// 列表的 task id:HAT-4。
export const refOf = (list, task) => `${list.prefix}-${task.id}`;
// 任务的置顶键(shared "tasks.pinned"):"<machine, 本机为空>:<folder>#<id>"。
export const taskKey = (list, task) => `${list.machine ?? ""}:${list.folder}#${task.id}`;

// herdr-task 的 auto_prefix:文件夹名各词的首字母(herdr-app-ttt -> HAT,最多
// 5),或单词前 4 个字母(herdr-winapp -> SHEP);至少 2 个字母。
export function autoPrefix(folder) {
  const name = String(folder ?? "").split("/").filter(Boolean).pop() ?? "";
  const ws = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z]+/).filter(Boolean);
  let p = ws.length > 1 ? ws.map((w) => w[0]).join("").slice(0, 5) : (ws[0] ?? "").slice(0, 4);
  if (p.length < 2) p = ws.join("").length >= 2 ? ws.join("").slice(0, 2) : "TASK";
  return p.toUpperCase();
}

// agent 在 STARTING_MS 之内为该任务启动且尚未结束(同 herdr-task)。
export const STARTING_MS = 90000;
export function starting(task, now = Date.now()) {
  const last = task.agents?.[task.agents.length - 1];
  if (last?.ended) return false;
  const at = Math.max(0, ...[task.started, last?.at, task.review?.at].filter((x) => typeof x === "number"));
  return now - at < STARTING_MS;
}

// Ready 状态的 task,其 agent 在报告 ready 后又重新动工(其 chat 中来自任何人的消息,
// herdr-task fix 或 resume)在下次 ready 前重新算 Working,同 herdr-task 的 busy_again()。Herdr 把
// agent 已完成的 turn(其终端的 turn):ready 状态下按 agent 记录:当它说过 ready 的那一轮结束后,它当前所在的轮次
// ready 的那一轮已结束(task.ready_turns);在该轮或更晚轮次上的工作是新的工作。其正在自行合并时不算
// 提问的轮次,也不算 reviewer 的轮次;在记录 turn 之前说的 ready:STARTING_MS 过后有任何工作即算。
export const WORKING_AGAIN = "又在工作了";
export function busyAgain(task, live, now = Date.now()) {
  if (task.state !== "ready" || task.merge_requested) return false;
  const seen = task.ready_turns;
  if (!seen && now - (task.ready_at ?? 0) < STARTING_MS) return false;
  return live.some((a) => a.status === "working" && a.role !== "reviewer" && (a.turn ?? 0) >= (seen?.[a.address] ?? 0));
}

// 任务的告警(检查失败、冲突、合并失败)只在无人处理时才需要用户介入
//,同 herdr-task 的 on_it:其某个 agent 在工作(working,或在提问:显示其问题),它曾
// 刚接手问题(herdr-task fix,GitHub news:handed_at)正在启动,或其 agent 已说明正在做什么
// (herdr-task status)自问题出现以来且仍然新鲜(ON_IT_MS,或其自身剩余时间,取更长):
// 在后台等 CI 的 agent 对 Herdr 而言是 idle。Herdr 自己的措辞(progress.by)不计入。
export const ON_IT_MS = 30 * 60000;
export function onIt(task, live, now = Date.now()) {
  if (live.some((a) => (a.status === "working" || a.status === "blocked") && a.role !== "reviewer")) return true;
  if (now - (task.handed_at ?? 0) < STARTING_MS) return true;
  const p = task.progress ?? {}, said = p.set ?? 0;
  if (p.by || !live.length || !said || said < (task.attention_at ?? 0)) return false;
  return now - said < Math.max(ON_IT_MS, typeof p.left === "number" ? p.left : 0);
}

// Needs you 之前的一段短暂宽限,即 herdr-task 的 GRACE_MS:任务常常只闪现几秒 Needs you
// 秒后自行推进(agent 常在说 ready 前一刻结束 turn,后台 job 的通知会唤醒
// 它,问题恰在交给 agent 前被发现)。因此安静的 agent(reply)与 Herdr 发现的问题
// (attention)只有持续超过 GRACE_MS 才需要用户:agent 自身的状态变化(a.since:hc 的
// status_ms)或问题的 attention_at 标明起始时间。真正需要用户的(提问、权限:blocked)
// 立即提醒用户。
export const GRACE_MS = 20000;
export const quietSince = (live) => Math.max(0, ...live.map((a) => (typeof a.since === "number" ? a.since : 0)));

// provider 重试的一行文案(herdr-task 的 retry_line):“Provider overloaded · Retry in 2m”。
export function retryLine(r, now = Date.now()) {
  return r.due ? `${r.reason} · Retry in ${Math.max(1, Math.ceil((r.due - now) / 60000))}m` : `${r.reason} · Retrying`;
}

// 仅在需要用户行动时显示 Ready,同 herdr-task 的 ready_wait:任务说过 ready 才是 Ready(且其
// 新闻和告警)只有当只剩用户的 Accept 时才显示。其 pull request 的检查仍在运行或
// GitHub 判定能否合并(task.pr.wait,由 herdr-task 的 tick 维护),或它正在自行合并时:
// 则显示 Working,并用几个词说明等待内容。属于用户自己的时候为 null。
export function readyWait(task, live = []) {
  if (task.merge_requested && live.length) return "合并中";
  if (task.merge_queued && task.pr) return "在 GitHub 合并队列中";
 //:平静等待 GitHub 要求的 review。
  if (task.auto_merge && task.pr && !task.merged) return task.pr.needs_approval ? "批准后即合并" : "检查通过后即合并";
  return task.pr?.wait || null;
}

// 任务的状态(即其分组)、需要用户的原因,及其活跃 agent。live:其 agent 此刻
// ([{ address, status, ... }],仅在其运行或 ready 时);loaded:false 表示其机器的 agent
// 尚不可知;每项为 { address, status, turn, role, since(hc 的 status_ms:GRACE_MS)}。规则与 herdr-task 的 task_status() 相同:其记录、
// 然后是其各 agent 自身的状态。
// helpers:其 worker 自己的辅助 agent,绝不算在 live 里:一次最多
// 工作或提问会让任务保持 Working(worker 在等它;worker 会回答其提问),否则不计入。
export function place(list, task, { live = [], helpers = [], loaded = true, now = Date.now() } = {}) {
  // Herdr 刚发现的问题:在 GRACE_MS 过去之前,task 的读法与没有它时相同(settles:届时的时间)。
  if (task.attention && ["running", "ready"].includes(task.state) && now - (task.attention_at ?? 0) < GRACE_MS) {
    const p = place(list, { ...task, attention: null }, { live, helpers, loaded, now });
    return { ...p, task, settles: (task.attention_at ?? 0) + GRACE_MS };
  }
  const st = task.state;
  if (!(st === "running" || st === "ready")) live = [];
  const status = live.reduce((s, a) => ((RANK[a.status] ?? 0) > (RANK[s] ?? 0) ? a.status : s), null);
  const busy = live.length && helpers.some((a) => a.status === "working" || a.status === "blocked");
  const states = [...live.map((a) => a.status), ...(busy ? ["working"] : [])];
  let section = ["todo", "queued", "scheduled", "done"].includes(st) ? st : null, needs = null, why = null, settles = 0;
  const need = (kind, text) => { section = "needs"; needs = kind; why = text; };
  if (section) return { list, task, live, status, section, needs, why };
  // 被模型提供商中断(herdr-task tick):Herdr 等待通知其继续期间显示 Working
  // 继续("Provider overloaded · Retry in 2m");重试次数用尽后变为 Needs you。
  const retry = st === "running" && task.retry && live.some((a) => a.address === task.retry.address) && !states.includes("blocked") ? task.retry : null;
  // Herdr 发现的只有用户能解决的问题:检查失败、冲突;其 agent 处理期间
  // (onIt()),Working 并附其 agent 自己的一句话。
  const fixing = task.attention && onIt(task, live, now);
  if (task.attention && !fixing) need("attention", task.attention);
  else if (retry?.over) need("provider", retry.reason);
  else if (retry) { section = "working"; why = retryLine(retry, now); }
  // 等待的原因:herdr-task 的措辞(其 agent 的状态行、提问或最后的话),
  // 由其调度器保存在任务上(task.waits),否则用标准原因。
  else if (states.includes("blocked")) need("asks", task.waits ?? REASONS.question);
  // Claude Code 的文件夹信任对话框(#755):其显示期间 agent 不上报状态;herdr-task 的调度器读取
  // 在屏幕上标记它(task.trust_ask:该 agent 的 address)。
  else if (task.trust_ask && live.some((a) => a.address === task.trust_ask && !a.status)) need("asks", task.waits ?? REASONS.trust);
  // 说过 ready 后又继续工作:在其再次 ready 之前不显示 Accept。
  else if (busyAgain(task, live, now)) { section = "working"; why = WORKING_AGAIN; }
  else if (fixing) { section = "working"; why = st === "ready" ? WORKING_AGAIN : null; }
  else if (st === "ready") {
 // 尚无需用户处理的事项):显示 Working 及其等待的内容。
    const wait = readyWait(task, live);
    section = wait ? "working" : "ready";
    if (wait) why = wait;
 // 说过 ready 但尚未停歇):在说过 ready 的那一轮里仍在工作
    // 输入,或其自身工作仍在运行(后台 job、Monitor、辅助任务:task.own_work,由其调度器维护)。
    // 在此之前显示 Working,之后才是 Ready。
    if (section === "ready" && live.length && (busy || task.own_work || live.some((a) => a.status === "working" && a.role !== "reviewer"))) section = "working";
  }
  // 其 agent 的终端尚未可知(机器正在加载):暂不下结论。
  else if (states.some((x) => x !== "idle" && x !== "done") || (!live.length && !loaded)) section = "working";
  // 刚启动(herdr-task 的 starting()):其终端仍在运行启动
  // agent,或 agent 在首条消息到达前处于 idle。
  else if (starting(task, now)) section = "working";
 // 安静,但在做自己的后台工作):后台 shell 或
  // Monitor 仍在运行,或其最新状态行显示正在等 CI 或 review。保留在任务上
  // 由其调度器记录(task.own_work);显示 Working 及其自身的状态行。
  else if (live.length && task.own_work && st === "running") section = "working";
  // 刚安静下来:GRACE_MS 内仍显示 Working(到宽限期结束:即本应需要用户的时候)。
  else if (live.length && quietSince(live) && now - quietSince(live) < GRACE_MS) { section = "working"; settles = quietSince(live) + GRACE_MS; }
  // 安静但未说 ready(herdr-task ready):仍存活,已结束本轮(等待内容见 task.waits);
  // 其进程消失,agent 已停止。
  else if (live.length) need("reply", task.waits ?? REASONS.reply);
  else need("stopped", REASONS.stopped);
  return { list, task, live, status, section, needs, why, ...(settles ? { settles } : {}) };
}

// queued 任务等待的原因:排在其前面的未完成任务,否则是文件夹已满。
// 运行中:列表里有多少任务当前有活跃 agent 在跑。
export function queueReason(list, task, running) {
  const byId = new Map(list.tasks.map((x) => [x.id, x]));
  const wait = (task.after ?? []).filter((i) => byId.has(i) && byId.get(i).state !== "done");
  // 其他文件夹或机器上的任务(herdr-task --after WEB-2、vm-b:HAT-12):其状态为
  // herdr-task 上次读取的结果("gone":已移除,不再展示任何内容)。
  const ext = (task.after_ext ?? []).filter((x) => !["done", "gone"].includes(x.state)).map((x) => x.ref);
  if (wait.length || ext.length) return `after ${[...wait.map((i) => refOf(list, { id: i })), ...ext].join(", ")}`;
  // 直白的描述,即 herdr-task 的 queue_reason:达到文件夹上限,否则其机器正忙
 // (herdr-task tick 的 “held”:“vm-a's memory is 92% full”,)。
  if (running >= (list.config?.max_running ?? 10)) return `Waits: ${running === 1 ? "1 task is" : `${running} tasks are`} running here`;
  return task.held ? `Waits: ${task.held}` : "即将开始";
}

// 从 agent 给出第一个预估起就显示剩余分钟数:粗略的猜测总比没有强(DECISIONS.md,
// )。Herdr 绝不多显示 agent 未说的内容。
export const estimated = (p) => typeof p?.left === "number";

// 任务的 agent 最近说的话(herdr-task status),展示形式:{ text, done, left(分钟), paused };
// 进入 ready 或等待指示、等待其他任务后归零。其分钟数在工作时递减,且
// 等待用户期间暂停计时(herdr-task 记录时间:progress.paused_at)。own:某个
// agent 自报(OSC 7501:{ pct, msg }),据此得到完成百分比,其消息即为状态行
// 直到它通过 herdr-task status 说出来。
export function reportOf(task, section, own = null, now = Date.now()) {
  const p = task.progress;
  if (task.state !== "running" || !["working", "needs"].includes(section)) return null;
  const text = p?.text || own?.msg || null;
  if (!text && !own) return null;
  const done = own ? own.pct : p?.done ?? null;
  let left = null;
  if (estimated(p)) {
    const rem = Math.max(0, p.left - ((p.paused_at ?? now) - (p.at ?? now)));
    left = rem < 60000 ? 0 : Math.ceil(rem / 60000);
  }
  return { text, done, left, paused: section === "needs" };
}

// 分组内排序:最近有活动的在前;todo 按添加顺序。
export function order(section) {
  // Scheduled:即将启动的排最前。
  if (section === "scheduled") return (a, b) => (a.task.scheduled_for ?? 0) - (b.task.scheduled_for ?? 0);
  if (section === "todo") return (a, b) => a.task.id - b.task.id;
  if (section === "done") return (a, b) => (b.task.done_at ?? 0) - (a.task.done_at ?? 0);
  return (a, b) => (b.task.ready_at ?? b.task.started ?? 0) - (a.task.ready_at ?? a.task.started ?? 0);
}

// 输入的每个词是否都命中其中之一,不区分大小写(herdr-winapp 的 matches():其列表的过滤器)。
export function matches(q, ...fields) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const all = fields.filter((f) => f != null && f !== "").join(" ").toLowerCase();
  return words.every((w) => all.includes(w));
}

// 今天显示 “9:00”,本周显示 “Tue 9:00”,否则 “Nov 12 9:00”。
export function day(ms, now = Date.now()) {
  const d = new Date(ms), today = new Date(now);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return hm;
  // 一周内显示星期;更远显示日期("Nov 12")。
  if (Math.abs(ms - now) < 6 * 86400000) return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hm}`;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ${d.getDate()} ${hm}`;
}

export function ago(ms, suffix = true, now = Date.now()) {
  const m = Math.floor((now - ms) / 60000);
  const s = m < 1 ? "<1m" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
  return suffix ? (m < 1 ? "刚刚" : `${s} ago`) : s;
}

// 每个第二行以大写开头("After "),agent 自述的文字也一样;已混用大小写的词
// 保持原样(如 "iOS")。
export const capital = (s) => (/^[a-z](?![A-Z])/.test(String(s)) ? s[0].toUpperCase() + s.slice(1) : s);

// 剩余时间,按 herdr-winapp 在工作行图形下方的简短写法:"6m"、"<1m"、"2h"。
export const short = (n) => (n < 1 ? "<1m" : n < 60 ? `${n}m` : `${Math.round(n / 60)}h`);

// 行的第二行,与 herdr-winapp 一致:Needs you 和 Merging 显示原因;Working 显示原因,或 agent 自述的当前状态
// 内容(w:reportOf);Queued 显示等待原因(queued:queueReason 的措辞);Ready 显示自何时起。
export function secondLine(p, w, queued = null, now = Date.now()) {
  const { section } = p;
  return section === "needs" || section === "merging" ? p.why : section === "working" ? p.why ?? w?.text ?? null
    : section === "queued" ? queued
    : section === "scheduled" ? startsLine(p.task.scheduled_for, now)
    : section === "ready" ? (p.task.ready_at ? `Ready ${ago(p.task.ready_at, true, now)}` : "Ready to accept") : null;
}

// 工作行圆点下方的剩余分钟("6m"),其 agent 给出后才显示;scheduled 任务距启动的时间
// (“6h”、“2d”),位于其时钟之下。
export const leftOf = (p, w, now = Date.now()) => (p.section === "scheduled" ? untilShort(p.task.scheduled_for, now)
  : p.section === "working" && !p.why && w?.left != null ? short(w.left) : null);

// // ---- 已排期----------------------------------------------------------------------------------------
// herdr-task 的 when.py 措辞:本周内 "Today 18:00"、"Tomorrow 9:00"、"Fri 9:00",否则 "Nov 20 9:00"。
export function startsAt(ms, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
  if (days === 0) return `Today ${hm}`;
  if (days === 1) return `Tomorrow ${hm}`;
  if (days > 1 && days < 7) return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hm}`;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ${d.getDate()} ${hm}`;
}
// 启动前的倒计时,尽量短以放在圆点下:"45m"、"6h"、"2d";到期显示 "now"(下一次 tick 启动它)。
export function untilShort(ms, now = Date.now()) {
  if (typeof ms !== "number") return null;
  const m = Math.ceil((ms - now) / 60000);
  return m <= 0 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
// 计划行的第二行:"Starts Today 18:00";到期后显示 "Starts now"。
export const startsLine = (ms, now = Date.now()) => (typeof ms !== "number" ? "Scheduled" : ms <= now ? "Starts now" : `Starts ${startsAt(ms, now)}`);
