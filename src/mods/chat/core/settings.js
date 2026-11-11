// herdr-winapp 设置各行的数据:每行在 ~/.config/herdr-winapp/settings.json 中的键、文案与选项,以及所有
// 与窗口 Settings(mods/herdr-winapp-settings)一致的标题、行与按钮文字,因此窗口、service 与
// web 应用的 Settings 三处说法一致。herdr-task 读取该文件(herdr_task/settings.py 的 settings_for);其默认值
// 那边的 DEFAULTS 与这边的一致。
// Shared core:源文件为 core/settings.js;bin/sync-shared 会把它复制进 lib/COPIES 中的各 mod。
import { NAMES, levelName, current, rowFor, menuFor, permAcross } from "./agents.js";
import { SERVE } from "./host.js";

// // ---- 外框 -------------------------------------------------------------------------------------------------
// 各页面,按窗口顺序。space:space 自身的设置也含此页("local":仅限本机上的 space);
// 其余是对所有 space 生效的单一设置(docs/settings.md 说明哪些及原因)。
export const SECTIONS = [
 { id: "agents", title: "Agent", icon: "bot", space: true },
 { id: "tasks", title: "任务", icon: "list-checks", space: true },
 // Everywhere 的 heartbeat、schedule 与 events,以及 space 自己的(core/autopilot.js);space 在其
 // Assistant 的 header
 { id: "autopilot", title: "Autopilot", icon: "plane", space: true },
 { id: "notify", title: "通知", icon: "bell", space: true },
 { id: "secrets", title: "密钥", icon: "key", space: true },
 { id: "machines", title: "机器", icon: "network" },
 { id: "window", title: "窗口", icon: "layout" },
 { id: "web", title: "网页", icon: "globe" },
];
// 窗口在各页面上的标题:Everywhere 的,或 space 自己的。
export const TITLE = "设置";
export const SPACE_TITLE = "空间设置";
export const EVERYWHERE = "Everywhere";
export const THIS_COMPUTER = "本机";
export const LOCAL = "local";
export const machineLabel = (key) => (key === LOCAL || key == null ? THIS_COMPUTER : key);
// space 自身设置的顶部:标明是哪个 space、在哪台 machine 上。
export const onlyFor = (space, machine) => `Only for ${space} on ${machine}`;

// // ---- 级别切换 ------------------------------------------------------------------------------------------
// 每页顶部,space 可设置自己的:页面设置的、Everywhere 的或某个 space 的,还有一个选择器
// 修改它的位置(Everywhere,然后各 space,按 machine)。对所有 space 唯一的页面则改为说明这一点。
export const LEVEL = {
 label: "适用于",
 everywhere: "所有空间,除非单独设置。",
 space: (machine) => `Only this space, on ${machine}. What it doesn't set is inherited from Everywhere.`,
 find: "查找空间…",
 spaces: "Spaces",
 none: "没有匹配的空间。",
 global: "对所有空间相同。",
};

// // ---- 行下方 -----------------------------------------------------------------------------------------------
// 在 space 中:"Set for this space · Reset" 或 "Inherited from Everywhere";在 Everywhere 上,列出已自行设置的 spaces
// 自身。在 machine 自己的行(Machines)上:"Set for this machine · Reset" 或 "Inherited from all machines"。
export const CHANGED_HERE = "此空间设置";
export const SET_FOR_MACHINE = "此机器设置";
export const RESET = "Reset";
export const RESET_TIP = (from) => `Back to ${from}'s`;
// 继承值来自何处:Everywhere,或此前设值且仍生效的那台 machine
export const fromWord = (level, key) => (level === "machine" ? machineLabel(key) : EVERYWHERE);
export const inheritedFrom = (from) => `Inherited from ${from}`;
export const sameAs = (level, key) => inheritedFrom(fromWord(level, key));
export const spacesOwn = (n) => (n === 1 ? "1 space sets its own" : `${n} spaces set their own`);
export const machinesOwn = (n) => (n === 1 ? "1 machine uses its own" : `${n} machines use their own`);
export const SAME_AS_ALL_MACHINES = "继承自所有机器";

// // ---- Agent ----------------------------------------------------------------------------------------------------
export const ROLES = [
 { id: "coordinator", title: "Assistant", about: "新空间里的对话助手。", file: "assistant.md",
 told: "每个 Assistant 首先被告知的" },
];
export const EDIT_INSTRUCTIONS = "编辑指令";
// instructions 编辑器(mods/coordinator 的 instructions view,叠在 Settings 上):文本下方按角色给出的说明,
// 以及变更写入文件后它显示的内容。
export const INSTRUCTIONS = {
 title: "Instructions", done: "完成", saved: "已保存。", notSaved: (why) => `Not saved: ${why}`,
 notes: {
 coordinator: "Every Assistant uses this. Repo-specific rules go in the repo's AGENTS.md or CLAUDE.md. Changes apply when an Assistant restarts.",
 worker: "Every worker gets this first. Repo-specific rules go in the repo's AGENTS.md or CLAUDE.md. Changes apply to the next task that starts.",
 reviewer: "Every reviewer gets this first. Repo-specific rules go in the repo's AGENTS.md or CLAUDE.md. Changes apply to the next review.",
 heartbeat: "Autopilot's heartbeat, plain text: an Assistant on Autopilot gets it on every wake. Changes apply from the next wake.",
 },
};
export const USE_OTHER_CLI = "使用另一个 CLI";
export const LOADING_AGENTS = "加载 agent…";
// 未设置 Reviewer 的按钮:运行的是另一个 CLI。
export const otherCliWords = (cli) => `Other CLI (${NAMES[cli] ?? cli})`;
export const otherCli = (worker) => (worker === "codex" ? "claude" : "codex");
// Reactions(herdr-task 的 reactions.py):每个 agent(Assistant、task worker、automation 运行、agent tab)都可对…作出 reaction
// 为部分消息添加表情回应;关闭则全部不加。保存为 agents.reactions;保留为 assistant.reactions
// (由 upgradeReactions 迁移)。
export const REACTIONS = { title: "Reactions", about: "agent 会对你的部分消息用表情回应,像真人一样。" };
// settings 文件的各层(everywhere、machines、spaces),其中 将 assistant.reactions 移到 agents.reactions
// (两层都有时保留 agent 层)。原地修改 cfg 并返回;有变动时返回 true。
export function upgradeReactions(cfg) {
 const layers = [cfg?.everywhere, ...Object.values(cfg?.machines ?? {}), ...Object.values(cfg?.spaces ?? {})];
 for (const l of layers) {
 const old = l && typeof l === "object" ? l.assistant : null;
 if (!old || typeof old !== "object" || !("reactions" in old)) continue;
 if (typeof old.reactions === "boolean" && typeof l.agents?.reactions !== "boolean") l.agents = { ...(l.agents ?? {}), reactions: old.reactions };
 delete old.reactions;
 if (!Object.keys(old).length) delete l.assistant;
 }
 return cfg;
}
// 请求加星:一生一次,在事情顺利完成后,Assistant 可显示一个小的
// 卡片,只附一个指向 GitHub 上 herdr-winapp 的普通链接。仅 Everywhere;以 star_prompt 保存(显示前为 { off },随后
// { asked, answer })。问过一次就不再显示,无论开关状态如何。
export const STAR = {
 title: "求个 GitHub star",
 about: "Once, ever, after things go well, your Assistant may show a small card with a link to herdr-winapp on GitHub.",
 asked: (at, answer) => `Asked on ${new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}${answer === "github" ? " (you opened GitHub)" : answer === "no" ? " (no thanks)" : ""}. It won't ask again.`,
};
// Everywhere 的 star_prompt 内容:开关是否开启(关闭则从不询问),以及询问过之后其下方的说明行。
export function starState(cfg) {
 const s = cfg?.everywhere?.star_prompt;
 const v = s && typeof s === "object" ? s : {};
 return { on: !v.off && !v.asked, asked: Number.isFinite(v.asked) ? v.asked : null, answer: v.answer ?? null,
 about: Number.isFinite(v.asked) ? `${STAR.about}\n${STAR.asked(v.asked, v.answer)}` : STAR.about };
}
// 反馈提议(herdr-task 的 feedback.py,):agent 在 herdr-winapp 自身遇到问题时,主动提出一次
// 将其整理为 GitHub issue,仅经确认才提交。以 agents.feedback 保存(默认开,可关),以及 Everywhere 的
// 专用,agents.feedback_repo(提交到的 repo;为空即上游 herdr-winapp)。
export const FEEDBACK = {
 title: "反馈建议",
 about: "When herdr-winapp itself misbehaves, agents offer once to file it as a GitHub issue, only with your yes.",
 repoTitle: "反馈仓库",
 repoAbout: "反馈 issue 提交到哪,格式 owner/name。留空:herdr-winapp 自己的仓库。",
 repo: "eliasstravik/herdr-winapp",
 bad: "写成 owner/name,比如 eliasstravik/herdr-winapp。",
};
// 从输入中解析 owner/name(owner/name 或 github.com 链接),空返回 "",不是则返回 null。
export function feedbackRepo(v) {
 const s = String(v ?? "").trim.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\// , "").replace(/\/+$/, "").replace(/\.git$/, "");
 if (!s) return "";
 return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(s) ? s : null;
}
export const BACKUP = { title: "备用 agent", about: "当任务的 agent 无法继续时,另一个 CLI 会接手一次。" };
// 另一 CLI 无法接管的机器(herdr-task 的检查,~/.local/state/herdr-winapp/cli-check.json 的 machines:此
// 本机为 ""),单行显示。m:scope 的机器("local" 或其名称),Everywhere(所有机器)时为 null。
export function backupProblem(checks, m, cli) {
 const here = Object.entries(checks ?? {}).filter(([k]) => m === null || k === (m === LOCAL ? "" : m));
 return here.filter(([, c]) => c?.[cli] === "missing" || c?.[cli] === "signed-out")
 .map(([k, c]) => `Can't on ${k || "本机"}: ${NAMES[cli] ?? cli} is ${c[cli] === "missing" ? "not installed" : "signed out"}.`).join(" ");
}

// model 菜单的文案(mods/chat-models,settings 模式)及其按钮的:"Opus 5.5 · 1M · High"。
// 模型列表的分组标题来自 core/agents.js 的 modelSections(Pinned、Recent、Models)
export const MODEL_MENU = { reasoning: "Reasoning", fast: "Fast", permissions: "Permissions" };
const modelOf = (menus, sel) => menus?.[sel?.agent]?.models?.find((m) => m.id === sel.model) ?? null;
export function modelLabel(menus, sel) {
 const m = modelOf(menus, sel);
 const level = sel?.effort ?? m?.defaultEffort ?? null;
 return [m?.name ?? sel?.model, levelName(level), sel?.fast ? "Fast" : null].filter(Boolean).join(" · ") || "选择模型";
}
// 各 agent 提供的选项,取自各自 CLI 的设置(agents.js parseDefaults),以及哪些已安装:
// { menus, permDefault, defaults }(defaults:首个已安装 CLI 自身的,未设角色时运行它)。
export function choicesFrom(dflts, installed = { claude: true, codex: true }) {
 const menus = Object.fromEntries(["claude", "codex"].filter((k) => installed[k]).map((k) => [k, menuFor(k, dflts[k])]));
 const permDefault = { claude: dflts.claude?.mode ?? "manual", codex: "auto" };
 const first = menus.claude ? "claude" : Object.keys(menus)[0] ?? "claude";
 const c = current(first, [], {}, dflts[first]);
 const model = rowFor(first, c) ?? menus[first]?.models?.[0]?.id ?? null;
 return { menus, permDefault, defaults: { agent: first, model, effort: c.effort ?? null, fast: false, perm: permDefault[first] } };
}
// role 的 model 按钮初始值:自己的选择,否则 Reviewer 取另一 CLI,再否则用默认值。
export function roleSel(role, own, choices, worker) {
 if (own) return { sel: { ...own }, unset: false };
 const o = otherCli(worker);
 if (role === "reviewer" && choices?.menus?.[o])
 return { sel: { agent: o, model: choices.menus[o].models[0]?.id ?? null, effort: null, fast: false, perm: choices.permDefault?.[o] ?? null }, unset: true };
 return { sel: choices?.defaults ? { ...choices.defaults } : null, unset: true };
}
// 菜单中选定模型:effort 和速度保持该模型现有的;换 agent 则带来其自身的 permission
// 模式中取最接近所选的一个(agents.js 的 permAcross)。
export function chooseModel(menus, permDefault, sel, agent, id) {
 const m = menus?.[agent]?.models?.find((x) => x.id === id);
 if (!m) return sel;
 const next = { ...sel, agent, model: id };
 if (next.effort && !m.efforts.includes(next.effort)) next.effort = null;
 if (!m.fast) next.fast = false;
 if (agent !== sel.agent) {
 next.perm = permAcross(sel.perm, agent, permDefault);
 next.fast = false;
 }
 return next;
}

// // ---- 任务 -----------------------------------------------------------------------------------------------------
// 每行标题下的一行说明(按其 key,即 section.field)。
export const ABOUT = {
 "tasks.merge": "任务就绪后谁来合并:你通过接受来合并,或 Herdr。",
 "tasks.review_rounds": "任务的 agent 会被审查工作并修复发现的问题。",
 "tasks.must_fix": "agent 说就绪前要修的问题。其余会列出来。",
 "tasks.proof": "每个任务用一件工件展示它工作的真凭实据,从接受处链接。",
 "tasks.max_running": "按文件夹。更多的排队等候,自动启动。",
 "tasks.archive_after": "完成的任务会移入归档,保留对话和摘要。",
 "tasks.worktrees": "在 git 仓库里,每个任务有自己的 worktree 和分支。",
 "automations.enabled": "agent 设置为按计划或事件启动的任务。",
};
// 任务 agent 被要求开头与结尾做的事(tasks.start_notes / finish_notes),各为其文字下方的一个输入框。
export const NOTES = [
 { id: "start", title: "当任务开始时", about: "agent 正式工作前的步骤。",
 example: "装依赖,把 .env 从主文件夹复制过来" },
 { id: "finish", title: "当任务完成时", about: "agent 说任务就绪前要做的步骤。",
 example: "停掉你起的 dev server,删掉临时文件" },
];
export const SAVED = "Saved";
// base branch,每个 space 仅一个(tasks.base):保存前校验。
export const BASE = {
 title: "基础分支",
 about: "New tasks branch from it and merge into it. Empty: the branch the folder has checked out.",
 empty: (now) => (now ? `Its branch now: ${now}` : "它当前的分支"),
 missing: (want) => `There's no branch “${want}” here or on origin.`,
 follows: "文件夹的分支",
};
// git 可能接受的分支名(先做本地校验,再问 git 是否存在)。
export const branchShape = (b) => !/^-|[\s~^:?*[\\]|\.\.|@\{/.test(b);
// 分支名(tasks.branch,#570):文件夹新 task 用的分支,取 Everywhere 或 space 自己的;herdr-task 填充
// 校验(settings.py 的 BRANCH_PATTERN、branch_pattern_problem)。任务自己的 --branch 优先。
export const BRANCH = {
 title: "分支名",
 about: "New tasks' branches. {n} is its number, {key} its id , {slug} its title.",
 pattern: "task/{n}-{slug}",
};
// Branch names 模式不可用的原因,无问题则 ""(herdr-task 的 branch_pattern_problem 给出同样结论)。
export function branchPattern(pattern) {
 const p = String(pattern ?? "").trim;
 if (!p) return "";
 if (!p.includes("{n}") && !p.includes("{key}")) return "Put {n} or {key} in it, so each task's branch is its own.";
 if (/\{(?!(?:n|key|slug)\})[^}]*\}/.test(p)) return "Only {n}, {key} and {slug} can be filled in.";
 const sample = p.replaceAll("{n}", "4").replaceAll("{key}", "ABC-4").replaceAll("{slug}", "fix-login");
 if (/^[-/]|[/.]$|\.lock$|[\s~^:?*[\\]|\.\.|@\{|\/\/|\/\./.test(sample)) return "That isn't a name git allows for a branch.";
 return "";
}

// // ---- 通知 ----------------------------------------------------------------------------------------------------
export const NOTIFY_ABOUT = "来自空间 Assistant 的消息。任务总是提醒。";
export const notifyMachineAbout = (v) => `Its spaces use ${v}.`;

// // ---- 密钥 ---------------------------------------------------------------------------------------------------
export const SECRETS = {
 about: "agent 按名字使用这些,从不看到值。",
 asked: "问过", add: "Add", kept: "Kept", name: "Name", value: "Value", for: "For",
 namePlaceholder: "GITHUB_TOKEN", valuePlaceholder: "粘贴值",
 hint: "再发同名会替换那里的。",
 save: "Save", saving: "保存中…", loading: "加载中…",
 none: "无。需要密钥的 agent 会在它的对话里要。",
 give: "给它", replace: "Replace", remove: "Remove", keep: "Keep",
 machine: "Machine", space: "Space",
 badName: "Name it like an environment variable: letters, digits and _, such as GITHUB_TOKEN.",
 noValue: "请先粘贴值。",
 asks: (who, name) => `${who} asks for ${name}`,
 keptNote: (name, where) => `Kept ${name} for ${where}.`,
 removedNote: (name, where) => `Removed ${name} from ${where}.`,
 pasteNew: (name) => `Paste the new value for ${name}.`,
 // 保持开启:保管 vault 的 machine,所有 machine 的 agent 与语音通话都用它(herdr-winapp secrets move-to)
 keptOn: "保留于", keptHere: "本机", thisOne: "本机",
 keptAbout: "Every machine's agents and voice calls get them from there. Pick an always-on machine.",
 // 无人选择时:跟随 Serve from(core/secrets.js 的 followTo)
 sameAsServe: (name) => `Same as Serve from: ${name}`,
 sameAbout: "They stay with the machine serving the web app, and move with it. Every machine's agents and voice calls get them from there. Pick another machine to keep them there instead.",
 forNow: (name) => `${name}, for now`,
 following: (to) => `They follow Serve from: they move to ${to} on their own, with a backup, once both machines are on.`,
 unreachable: (name) => `Can't reach ${name}, which keeps them: agents on other machines can't get secrets until it's back.`,
 notLinked: "未从此处连接的机器会保留它们。",
 moveConfirm: (name) => `Keep secrets on ${name}?`,
 moveDetail: (name, from) => `Every secret is copied to ${name}, checked, and then used from there by every machine. ${from} keeps a backup copy; moving them back brings back what was added since.`,
 moveVerb: "移动它们",
 moving: (name) => `Moving them to ${name}…`,
 offline: "offline",
};
// 以文字表示的 scope,供列表和 For 选择器使用:"Everywhere"、某 machine 名,或 "Space web"。
export const secretWhere = (scope, machine, spaceName) =>
 scope === "space" ? `Space ${spaceName}` : scope === "machine" ? machine || THIS_COMPUTER : EVERYWHERE;

// // ---- 机器 --------------------------------------------------------------------------------------------------
export const MACHINES = {
 heading: "当新任务等待时,所有机器",
 limits: [
 { field: "start_memory", title: "内存高于", about: "内存占用更高时,那里的新任务会等待。" },
 { field: "start_load", title: "CPU 高于", about: "1 分钟负载,占全部核心的比例。" },
 { field: "start_disk", title: "磁盘高于", about: "它的主目录或 /tmp,哪个更满。" },
 ],
 low: { title: "worker 低优先级运行", about: "Task agents start below the Assistant and your apps, and are ended first when memory runs out." },
 cap: { title: "每个 worker 的内存上限", about: "A worker over it is slowed down, not ended. Applies to tasks started after a change." },
 own: { title: "Limits", about: "与所有机器相同。", button: "单独设置" },
 old: { title: "此前为它的空间设置", about: (names) => `${names.join(", ")}. These still apply to its spaces unless a space sets its own.` },
 home: { title: "主 Assistant", make: "设为主空间" },
};
// 旧 machine scope 可承载的内容,按用户所认知的。
export const OLD_NAMES = { coordinator: "Assistant", worker: "Workers", reviewer: "Reviewer", backup: "备用 agent",
 automations: "运行自动化", merge: "Merge", review_rounds: "审查", must_fix: "必须修", proof: "Proof",
 max_running: "同时任务数", archive_after: "完成后归档于", worktrees: "Worktrees",
 start_notes: "当任务开始时", finish_notes: "当任务完成时", base: "基础分支", branch: "分支名", agents: "Reactions" };
// Home Assistant 行:开关状态,以及 herdr-task 的 home 轮询上次在那边查到的(~/.local/share/herdr-winapp/tasks/.home.json)。
export function homeAbout(on, st) {
 return !on ? "关:没人监视它的磁盘、负载和进程。"
 : st?.assistant ? "它的主空间 Assistant 监视磁盘、负载和进程。"
 : st?.space ? "首次向它的主 Assistant 写消息时会自动启动。"
 : st?.error ? "现在读不到。每分钟重试。"
 : "那里没有主空间。";
}

// // ---- 窗口 ----------------------------------------------------------------------------------------------------
// 保存在 shared state 的 on/off 开关(非 false 即开),然后是 Add-ons(lib/addons.json 的开关)。
export const SWITCHES = [
 { id: "tabs", title: "显示标签页", about: "空间的标签页,在顶栏里。栏上的按钮不受影响。",
 key: "tabbar.tabs" },
 { id: "worktrees", title: "侧栏中的 worktree", about: "仓库的 worktree 空间,列在它下面。",
 key: "sidebar.worktrees" },
 { id: "unread", title: "未读空间加粗", about: "Assistant 有新消息的空间会加粗高亮。",
 key: "sidebar.unread" },
 { id: "counts", title: "红色计数", about: "需要你的事项,红色计数显示在空间、标签页和任务上。", key: "counts.red" },
 { id: "greens", title: "绿色计数", about: "就绪的任务,绿色计数显示在空间、标签页和任务上。", key: "counts.green" },
 { id: "filters", title: "任务的状态筛选", about: "任务搜索下方的状态筛选行。",
 key: "tasks.filters" },
 { id: "place", title: "在任务行显示空间", about: "每个任务行右侧暗色显示它的空间和机器。",
 key: "tasks.place" },
 { id: "helpers", title: "在输入框上方显示子 agent", about: "agent 自己的子 agent,列在输入框上方。",
 key: "chat.helpers" },
 { id: "assistant", title: "新空间里的 Assistant", about: "新空间会打开它的 Assistant 对话,否则打开终端。",
 key: "coordinator.auto" },
];
export const ADDONS = "Add-ons";
// 用量洞察的 Delete,位于其开关下方(窗口端与 web 端的 Settings > Window):删除所有机器的日志。
export const INSIGHTS = {
 title: "删除用量数据",
 about: "Deletes the usage log on this computer and on your other machines. It starts again from now while the add-on is on.",
 button: "Delete",
 done: "已删除。",
 missed: (names) => `Deleted here. Not reached: ${names}. Try again when they're online.`,
};
// add-on 的一行:其 about,以及阻止切换的原因(stop:挡在前面的标题)。
export function addonAbout(about, now, stop) {
 if (!stop.length) return about;
 const one = stop.length === 1, names = stop.join(", ");
 return now ? `${about} ${names} need${one ? "s" : ""} it: turn ${one ? "that" : "them"} off first.`
 : `${about} Needs ${names}: turn ${one ? "it" : "them"} on first.`;
}

// // ---- 网页 -------------------------------------------------------------------------------------------------------
export const WEB = { title: "网页版 herdr-winapp", link: "Link", copy: "Copy", copied: "Copied", phone: "在手机上打开" };
// Web 页面的状态行:关闭(Web add-on)、尚未读取、无服务,或服务最后一次的回报(web.json)。
// 由另一台 machine 提供(Serve from,core/host.js):注明是哪台;迁移进行中则先说明此事。
export const webState = (off, loaded, w) => (off ? "Off. Turn it on under Window › Add-ons." : !loaded ? "读取中…"
 : !w ? "herdr-winapp 的服务没有在这里运行。" : w.serve?.moving ? SERVE.moving(w.serve.moving)
 : w.serve?.host && !w.serve.reachable ? SERVE.unreachable(w.serve.host) : w.why ? w.why
 : w.serve?.host ? SERVE.elsewhere(w.serve.host) : "已开启,仅你的 tailnet 可见。");

// // ---- 各行的选择 -----------------------------------------------------------------------------------------
export const MERGE = [["ask", "接受时"], ["checks", "检查通过后"], ["auto", "立即"]];
export const MUST_FIX = [["blocker", "Blockers"], ["major", "Major 及以上"], ["minor", "Everything"]];
export const ROUNDS = [[0, "Off"], [1, "1 round"], [2, "2 rounds"], [3, "3 rounds"]];
export const ARCHIVE = [[0, "Off"], [1, "1 day"], [3, "3 days"], [7, "1 week"], [30, "1 month"]];
export const ONOFF = [[true, "On"], [false, "Off"]];

export const DEFAULTS = { tasks: { merge: "ask", review_rounds: 0, must_fix: "major", max_running: 10, worktrees: true, archive_after: 7, proof: true }, automations: { enabled: true },
 agents: { reactions: true, feedback: true, feedback_repo: "" } };

// [section, field, label, choices | { min, max }]
export const TASK_ROWS = [
 ["tasks", "merge", "Merge", MERGE],
 ["tasks", "review_rounds", "审查", ROUNDS],
 ["tasks", "must_fix", "必须修", MUST_FIX],
 ["tasks", "proof", "Proof", ONOFF],
 ["tasks", "max_running", "同时任务数", { min: 1, max: 10 }],
 ["tasks", "archive_after", "完成后归档于", ARCHIVE],
 ["tasks", "worktrees", "Worktrees", ONOFF],
 ["automations", "enabled", "运行自动化", ONOFF],
];

// 该行当前生效的值:Everywhere 的(文件里 "everywhere" 层,否则为默认值)。
export function valueOf(file, section, field) {
 const v = file?.everywhere?.[section]?.[field];
 return v ?? DEFAULTS[section]?.[field] ?? null;
}

// 改动了单个 Everywhere 值后的文件(null:恢复默认)。
export function withValue(file, section, field, value) {
 const f = JSON.parse(JSON.stringify(file ?? {}));
 f.everywhere ??= {};
 f.everywhere[section] ??= {};
 if (value === null) delete f.everywhere[section][field]; else f.everywhere[section][field] = value;
 return f;
}

// 选项的文字与其值之间的双向转换。
export const wordFor = (choices, v) => (Array.isArray(choices) ? choices.find(([x]) => x === v)?.[1] ?? String(v) : String(v));
export const valueFor = (choices, word) => (Array.isArray(choices) ? choices.find(([, w]) => w === word)?.[0] : Number(word));
