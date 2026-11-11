// Autopilot 的文字与选项,窗口内一致(Settings › Autopilot:mods/herdr-winapp-settings/autopilot-section.js;
// header 的开关:mods/pane-chat/autopilot.js),以及 web 端(service/compat.ts、web/plugins/coordinators)。
// 按 Tasks 的方式设置:Everywhere 的 heartbeat、schedule 与 events,以及 space 自行设置的(herdr-winapp settings,
// ~/.config/herdr-winapp/settings.json 的 "autopilot" = { every, events, heartbeat },位于 "everywhere" 与 "spaces"[id],随
// 随其余配置下发到每台 machine)。各 space 在其 Assistant 的 header 中开关。herdr-task 保留每个
// space 的开关及其唤醒方式(mods/tasks/bin/herdr_task/autopilot.py,~/.local/share/herdr-winapp/tasks/.autopilot.json,其
// "everywhere" {every, events} 与 heartbeat 文件 everywhere.md 是 Settings 接管之前 Everywhere 的旧有内容,
// 设置未指定时仍按其读取)。pilotFor() 即 herdr-task 的 resolve(),供 header 使用,读取相关文件
// 本身,以及 herdr-task 尚无记录的 space;core/autopilot.cases.json 保存双方
// 测试用例(core/autopilot.test.js、test/test_herdr_task.py)。
// Shared core:源文件为 core/autopilot.js;bin/sync-shared 会把它复制进 lib/COPIES 中的各 mod。

export const TITLE = "Autopilot";
export const ABOUT = "Turn it on in a space with the switch in its Assistant's header: its Assistant then wakes on a schedule "
  + "or when something happens to its tasks. By default it unblocks and checks what's open, then adds and starts the next "
  + "most useful tasks to push the project forward, toward the space's Direction (none: what the project itself shows). "
  + "It acts on its own and makes the calls itself, never asking you; it only alerts you for something critical "
  + "(money, publishing, deleting data, security, or stuck). It never merges or accepts: that stays yours.";
// space 可单独设置的字段(herdr-winapp settings 的 "autopilot")。direction:单行的指引语(space 级)。
export const FIELDS = ["heartbeat", "every", "events", "direction"];

// 每行的 label 及其下方的一行说明。
export const ROWS = {
  direction: { label: "Direction", about: "One line it steers toward in this space. Empty: it works out what matters most from the project itself." },
  heartbeat: { label: "Heartbeat", about: "它工作的依据:方向、优先级、边界和停止条件。" },
  every: { label: "Schedule", about: "自动唤醒时。" },
  events: { label: "事件", about: "这些事件发生在它的任务上时,会立刻唤醒空间的 Assistant。" },
};

// schedule 的可选项(herdr-task 的 --every 措辞);其余一律为 Custom。
export const PRESETS = [["", "Off"], ["每 30 分钟", "每 30 分钟"], ["每 60 分钟", "每小时"], ["工作日 9:00", "工作日 9:00"]];
export const CUSTOM = "自定义…";
export const CUSTOM_PLACEHOLDER = "工作日每 2 小时";
export const CUSTOM_HINT = "Like \"every 2 hours on weekdays from 8:00 to 18:00\". Saved when you leave the box.";
// 唤醒它的事件(herdr-task 的 EVENTS,按其顺序)。
export const EVENTS = [["added", "已添加"], ["ready", "就绪"], ["failed", "失败"], ["needs-you", "需要你"], ["merged", "Merged"], ["stalled", "卡住了"]];

// heartbeat 输入框:停止输入片刻后保存,离开时也保存;随后 "Saved" 淡显片刻。
export const SAVED = "Saved";
// Direction 输入框:单行,离开时保存(herdr-task:DIRECTION_MAX)。
export const DIRECTION_PLACEHOLDER = "Like \"get the checkout flow ready to launch\"";
export const DIRECTION_MAX = 300;
export const directionOf = (words) => String(words ?? "").replace(/\s+/g, " ").trim().slice(0, DIRECTION_MAX);
export const SAVE_AFTER_MS = 600;
export const NO_HEARTBEAT = "无法创建心跳文件。";

// 在用户自行填写之前 Everywhere 使用的默认 heartbeat(autopilot.py STARTER,措辞相同):拿来即可用的真实内容
// 与其他项目无异;用户编辑它——Everywhere 级或 space 级——以作指引。
export const STARTER = `Direction: push this project forward on your own, without wasting my time or money. Follow this space's Direction when it has one; with none, work out what matters most from the project itself.

You decide, I steer later: make every call yourself, taste and product choices too. Pick the best option, act on it, and tell me in one line what you chose and why, so I can redirect you. Never ask me a question on a wake; only a take-over (below) stops for me.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why and unblock it yourself (nudge, resume, fix). A worker's question or choice: answer it yourself with the best option. Only a take-over waits for me.
2. Ready: check the work (diff, checks, proof). A clear defect: send it back saying what's wrong. Looks right: say so in one line; Accepting stays mine. Never park on a task waiting for my Accept: go on with work that doesn't need it (step 4), and each wake it still holds tasks back, say in one line what waits on my Accept.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. Push the project forward: look at the project itself (README, docs and goals, recent commits and merged tasks, open GitHub issues and PRs, TODOs, failing or missing tests, your saved progress and what I asked for lately). Pick the most valuable next tasks yourself, each with a full brief (what, why, how to check it's done), and start them within the queue. At most 2 a wake; never one that repeats an open or recent task or an old ask I dropped. Tell me in one line what you started and why.
5. End by saving progress: facts and your next step, never a limit of your own. Only this heartbeat and I set limits.

Take over: the only time you stop for me. Something irreversible or outside this space that can't wait (spending money, deploying or publishing outside this space, pushes to main, emails or posts, deleting data, credentials, a security problem), or you're stuck on the same thing after retrying twice. Then don't do it: send one herdr-task alert "<what>" --body "<why>", say it in one line, and carry on with other work.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Never do a take-over thing yourself: alert me instead.
- Work only through herdr-task tasks; never write the code yourself.
- 3 or more tasks waiting on me: add and start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines on what you did and chose, never a question; never repeat what you told me before, except what still waits on me. When there's truly nothing worth doing (nothing to unblock, check or start, and no next task worth adding), end with <hc no-reply why="你检查了什么,它在等什么"/>, never a bare <hc no-reply/>.

Stopping goal: none. Runs until I switch it off.
`;

// 未设置前用 Everywhere 的(herdr-task:everywhere_default)。
export const DEFAULT = { every: "每 60 分钟", events: [] };
// 早期版本写下的 starter(herdr-task 的 OLD_STARTERS):从未编辑过的即代表今日的。
export const OLD_STARTERS = [`Direction: push this project forward on your own, without wasting my time or money. Follow this space's Direction when it has one; with none, work out what matters most from the project itself.

You decide, I steer later: make every call yourself, taste and product choices too. Pick the best option, act on it, and tell me in one line what you chose and why, so I can redirect you. Never ask me a question on a wake; only a take-over (below) stops for me.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why and unblock it yourself (nudge, resume, fix). A worker's question or choice: answer it yourself with the best option. Only a take-over waits for me.
2. Ready: check the work (diff, checks, proof). A clear defect: send it back saying what's wrong. Looks right: say so in one line; Accepting stays mine.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. Push the project forward: look at the project itself (README, docs and goals, recent commits and merged tasks, open GitHub issues and PRs, TODOs, failing or missing tests, your saved progress and what I asked for lately). Pick the most valuable next tasks yourself, each with a full brief (what, why, how to check it's done), and start them within the queue. At most 2 a wake; never one that repeats an open or recent task or an old ask I dropped. Tell me in one line what you started and why.
5. End by saving progress and your next step.

Take over: the only time you stop for me. Something irreversible or outside this space that can't wait (spending money, deploying or publishing outside this space, pushes to main, emails or posts, deleting data, credentials, a security problem), or you're stuck on the same thing after retrying twice. Then don't do it: send one herdr-task alert "<what>" --body "<why>", say it in one line, and carry on with other work.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Never do a take-over thing yourself: alert me instead.
- Work only through herdr-task tasks; never write the code yourself.
- 3 or more tasks waiting on me: add and start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines on what you did and chose, never a question; never repeat what you told me before. Reply only <hc no-reply/> when there's truly nothing worth doing: nothing to unblock, check or start, and no next task worth adding.

Stopping goal: none. Runs until I switch it off.
`, `Direction: push this project forward, without wasting my time or money. Follow this space's Direction when it has one; with none, work out what matters most from the project itself.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why. Unblock what you can (nudge, resume, fix); what only I can answer, ask me once, in one clear question.
2. Ready: check the work (diff, checks, proof). Tell me in a line if it looks right to Accept; a clear defect, send it back saying what's wrong.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. Push the project forward: look at the project itself (README, docs and goals, recent commits and merged tasks, open GitHub issues and PRs, TODOs, failing or missing tests, your saved progress and what I asked for lately). Add the most valuable next tasks, each with a full brief (what, why, how to check it's done), and start them within the queue. At most 2 a wake; never one that repeats an open or recent task or an old ask I dropped. Tell me in one line what you started and why.
5. End by saving progress and your next step.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Ask before anything risky, costly or outside this space (deploys, pushes to main, emails, posts, payments, sign-ups).
- Work only through herdr-task tasks; never write the code yourself.
- Same thing failed twice: stop retrying and tell me.
- 3 or more tasks waiting on me: add and start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines, only what's new that I must know or decide; never repeat what you told me before. Reply only <hc no-reply/> when there's truly nothing worth doing: nothing to unblock, check or start, and no next task worth adding. Alert me only for what can't wait (something down, work at risk).

Stopping goal: none. Runs until I switch it off.
`, `Direction: keep this space's tasks moving to done, without wasting my time or money. Don't invent work or redo old asks from past chats.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why. Unblock what you can (nudge, resume, fix); what only I can answer, ask me once, in one clear question.
2. Ready: check the work (diff, checks, proof). Tell me in a line if it looks right to Accept; a clear defect, send it back saying what's wrong.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. New tasks: only follow-ups I asked for or a finished task named. At most 2 a wake, each with a full brief.
5. End by saving progress and your next step.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Ask before anything risky, costly or outside this space (deploys, pushes to main, emails, posts, payments, sign-ups).
- Work only through herdr-task tasks; never write the code yourself.
- Same thing failed twice: stop retrying and tell me.
- 3 or more tasks waiting on me: start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines, only what's new that I must know or decide; never repeat what you told me before. Nothing new: reply only <hc no-reply/>, never with other words. Alert me only for what can't wait (something down, work at risk).

Stopping goal: none. Runs until I switch it off.
`, `Direction: what Autopilot works toward in this space.

Priorities:
-

Constraints: what it must not do (e.g. never merge; ask before anything risky).

Reporting: what to tell me after a wake, and when to alert me.

Stopping goal (optional): a finite goal; when it's proven, Autopilot turns itself off.
`];
// 心跳的文字,旧版本的引导语当作今天的(herdr-task:取 current)。
export const currentBeat = (words) => (OLD_STARTERS.some((x) => x.trim() === String(words ?? "").trim()) ? STARTER : words);
// 无人撰写的心跳:为空(引导语是真实内容;herdr-task:空白)。
export const blankBeat = (words) => !String(currentBeat(words) ?? "").trim();

const textOf = (e) => (e && typeof e === "object" ? e.text ?? null : e || null);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o ?? {}, k) && o[k] !== undefined;
// 事件按 herdr-task 的顺序排列,每条只出现一次。
export const eventsIn = (list) => EVENTS.map(([v]) => v).filter((v) => (list ?? []).includes(v));

// Everywhere 的 schedule(文字原样)与 events,取自文件的 "everywhere"(或 herdr-task 眼中的它)。
export function everywhereOf(file) {
  const e = file?.everywhere ?? {};
  return { every: has(e, "every") ? textOf(e.every) : DEFAULT.every, events: eventsIn(has(e, "events") ? e.events : DEFAULT.events),
    ...(e.trigger ? { trigger: e.trigger } : {}) };
}

// herdr-winapp 设置中某一级的 Autopilot(null:Everywhere 的),只含其设置项:{ every, events, heartbeat }。
export function levelOf(settings, space = null) {
  const a = (space ? settings?.spaces?.[space] : settings?.everywhere)?.autopilot;
  if (!a || typeof a !== "object") return {};
  return Object.fromEntries(FIELDS.filter((k) => a[k] !== undefined && a[k] !== null).map((k) => [k, a[k]]));
}
const ruleText = (x) => { const t = String(x ?? "").trim(); return !t || /^(off|none|never)$/i.test(t) ? null : t; };

// space 内生效的内容:自己的开/关(开启前为关);schedule 与 events 在 herdr-winapp 中设置
// 设置,否则该机 Everywhere 的,否则之前的 Everywhere(file.everywhere),否则默认值;own:它自己
// 自行设定。记录中的其余字段(next_run、pending、last_wake、progress 等)原样保留。
// file.spaces:文件的映射,或 herdr-task 的视图列表(即生效内容:原样采用)。
export function pilotFor(file, space, settings = null) {
  const list = file?.spaces;
  if (Array.isArray(list)) {
    const v = list.find((x) => x.space === space);
    if (v) return v;
  }
  const a = (Array.isArray(list) ? null : list?.[space]) ?? {};
  const e = everywhereOf(file);
  const own = [];
  for (const [layer, mine] of [[levelOf(settings), false], [levelOf(settings, space), true]]) {
    if (typeof layer.every === "string") { e.every = ruleText(layer.every); if (mine) own.push("every"); }
    if (Array.isArray(layer.events)) { e.events = eventsIn(layer.events); if (mine) own.push("events"); }
    if (mine && typeof layer.heartbeat === "string") own.push("heartbeat");
    if (mine && typeof layer.direction === "string" && layer.direction.trim()) own.push("direction");
  }
  return { ...a, space, on: Boolean(a.on), every: e.every, events: e.events, own, ...(e.trigger && !a.trigger ? { trigger: e.trigger } : {}) };
}

// schedule 的选择:其 preset 的值,否则为 null(即 Custom)。
export const presetOf = (every) => {
  const v = String(every ?? "").trim().toLowerCase();
  return PRESETS.find(([x]) => x === v)?.[0] ?? null;
};

export function when(ms, today = new Date()) {
  if (!ms) return "";
  const d = new Date(ms);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return `Today ${hm}`;
  return `${d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })} ${hm}`;
}

// 开启期间 Assistant 标题中 "Autopilot" 之后的字样:waking(唤醒轮次运行中)、queued(等待空闲
// Assistant),下次计划唤醒(一小时内显示 "Next in 7 min",一天内显示 "Next 14:30",否则 "Next Fri"),
// 否则显示唤醒它的事件("On events";两者皆无:"No schedule",仅 Run now 时唤醒)。关闭时无。屏幕
// 正在显示时约每半分钟重查一次。
export function headerDetail(a, now = Date.now()) {
  if (!a?.on) return "";
  if (a.inflight) return "Waking";
  if (a.pending) return "排队中";
  if (a.next_run) {
    const d = new Date(a.next_run), left = a.next_run - now;
    if (left < 60000) return "1 分钟后";
    if (left < 3600000) return `Next in ${Math.ceil(left / 60000)} min`;
    return left < 86400000 ? `Next ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : `Next ${d.toLocaleDateString("en", { weekday: "short" })}`;
  }
  return a.events?.length ? "按事件" : "没有计划";
}

// 开关拨动瞬间 header 的显示,直到 herdr-task 的应答到达:开启时,它
// 立即唤醒(herdr-task 排入首次唤醒),显示 "Waking" 而非关闭时的空计划;切换后
// 关闭时不等待。
export function flipped(a, on) {
  return on ? { ...a, on: true, inflight: a?.inflight || { reason: "已开启" } }
    : { ...a, on: false, next_run: null, pending: null, inflight: null };
}
