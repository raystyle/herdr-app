// chat 中对 space 的 #-mention,窗口端与 web app 通用:输入 "#" 会列出运行此
// 聊天 agent 可达的范围(herdr-task 的 reach map,`herdr-task assistants` 与 `tell-assistant` 依据的同一份:
// herdr-core 链接和可登录的 ssh,每台 machine 各有视角),选中后以…形式发给 agent
// `[#shop](space:vm-demo/sp1)`:先显示名称,其后是 `herdr-task tell-assistant` 接受的目标(从 agent
// machine,再加 space 的 id;agent 本机上的 space 只有 id)。各行以 chip 显示;
// agent 不可达(或查看者不可见)的显示为锁定,如同 Slack 私有频道链接。
// Shared core:源文件为 core/mentions.js;bin/sync-shared 会把它复制进 lib/COPIES 中的各 mod。

// 每台机器的 herdr-task 存放 reach map 的位置(其 scheduler 每 5 分钟刷新)。
import { SH } from "./paths.js";
export const REACH_FILE = SH + 'cat "${HERDR_TASK_STORE:-$SHEP_TASKS}/.reach.json" 2>/dev/null';

// reach map 中每台 machine 各一次,由近及远,附从 map 起点到它的路径(如
// herdr_task/machines.py 的 nodes():herdr-core 链接排在 ssh 之前)。
export function nodes(graph) {
  const out = [], seen = new Set();
  let level = graph ? [[graph, []]] : [];
  while (level.length) {
    const next = [];
    for (const [node, route] of level) {
      const key = node.core?.id ?? `host:${node.host}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ node, route });
      const links = [...(node.links ?? [])].sort((a, b) => (a.how !== "herdr-core") - (b.how !== "herdr-core"));
      for (const l of links) if (l.next && typeof l.next === "object" && Array.isArray(l.next.links)) next.push([l.next, [...route, l.to]]);
    }
    level = next;
  }
  return out;
}

// reach map 起点可达的 spaces,自身排在首位:[{ id, name, route, machine, target, emoji?, assistant }]。
// route:此处为 "",或 "vm-demo"、"laptop>vm-x";machine:该 machine 自己的名称;target:tell-assistant 接受的值。
// 只取每台 machine 自己的 spaces(其他 machine 镜像进其文档的带 machine 字段,予以排除)。
export function reachable(graph) {
  const out = [], seen = new Set();
  for (const { node, route } of nodes(graph)) {
    const r = route.join(">");
    const live = new Set((node.assistants ?? []).map((a) => a.space).filter(Boolean));
    for (const s of node.spaces ?? []) {
      if (!s?.id || s.machine || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, name: s.name || s.id, route: r, machine: node.core?.name || route[route.length - 1] || node.host || "",
        target: targetOf(r, s.id), ...(s.icon ? { emoji: s.icon } : {}), assistant: live.has(s.id) });
    }
  }
  return out;
}

export const targetOf = (route, id) => (route ? `${route}/${id}` : id);

// 输入框末尾正在输入的 "#word",否则为 null。
export function typing(text) {
  const m = /(?:^|\s)#([\w.-]*)$/.exec(String(text ?? "").replace(/\n+$/, ""));
  return m ? m[1] : null;
}

// 为输入内容匹配 spaces:以其开头的名字在前,然后是包含它的名字或 machine。
export function match(list, word, n = 6) {
  const w = String(word ?? "").toLowerCase();
  const starts = list.filter((s) => s.name.toLowerCase().startsWith(w));
  const has = list.filter((s) => !s.name.toLowerCase().startsWith(w) && (s.name.toLowerCase().includes(w) || s.machine.toLowerCase().includes(w)));
  return [...starts, ...has].slice(0, n);
}

// 选中的 space 会写入消息的内容。
export const token = (s) => `[#${s.name}](space:${s.target})`;

// 输入框中正输入的 "#word" 会被替换成所选 space 的简写("#shop ");完整 token 在发送时写入
// 发送(expand()),输入框因此保持可读。
export const pickInto = (text, s) => String(text ?? "").replace(/\n+$/, "").replace(/#[\w.-]*$/, `#${s.name} `);

// 发送时:用户选的每个 "#name" 转成对应 token(picked: [{ name, target }],同名以后选为准)。
export function expand(text, picked) {
  if (!picked?.length) return text;
  const by = new Map(picked.map((s) => [s.name, s]));
  return String(text).replace(/(^|[\s(])#([\w.-]+)(?![\w.-]|\]\()/g, (all, pre, name) => {
    const s = by.get(name) ?? by.get(name.replace(/[.]+$/, ""));
    if (!s) return all;
    const tail = name.slice(s.name.length);
    return `${pre}${token(s)}${tail}`;
  });
}

// space 写作 [#name](space:target),task 写作 [@REF](task:target)(taskTarget())。
const RE = /\[([#@])([^\]\n]{1,80})\]\((space|task):([^)\s]+)\)/g;

// 消息的文字及其中的 mention:[{ text } | { mention: { name, target, id, route } } | { task: { ref, target,
// route、folder } }]。
export function split(text) {
  const out = [], s = String(text ?? "");
  let at = 0;
  for (const m of s.matchAll(RE)) {
    if ((m[1] === "#") !== (m[3] === "space")) continue;
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push(m[3] === "space" ? { mention: parse(m[2], m[4]) } : { task: parseTask(m[4]) });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

export function parse(name, target) {
  const i = target.lastIndexOf("/");
  return { name, target, id: i < 0 ? target : target.slice(i + 1), route: i < 0 ? "" : target.slice(0, i) };
}

export const hasMention = (text) => /\[#[^\]\n]+\]\(space:[^)\s]+\)|\[@[^\]\n]+\]\(task:[^)\s]+\)/.test(String(text ?? ""));

// 锁定 chip 的文字及其原因(放在其 label 里)。
export const LOCKED = { label: "无法连接", why: "此对话的 agent 无法访问那个空间,无法操作。" };
export const UNSEEN = "那个空间不在这里的侧栏。";
export const LOCKED_TASK = "此对话的 agent 无法访问那个任务的空间,无法操作。";
export const UNSEEN_TASK = "那个任务不在这里的列表。";

// 以普通 markdown 形式的 mention,用于不绘制 chip 的地方(窗口的消息文本):以名称和
// machine 以代码样式显示并锁定,文案说明这一点。任务则显示 "@REF · 标题"(titleOf(task),已知时)。
export function plain(text, reach, machineOf, titleOf) {
  return split(text).map((p) => {
    if (p.text !== undefined) return p.text;
    if (p.task) {
      const title = titleOf?.(p.task), where = p.task.route.split(">").pop();
      return "`@" + p.task.ref + (title ? ` · ${short(title)}` : "") + (where ? ` · ${where}` : "") + "`";
    }
    const m = p.mention, ok = !reach || reach.has(m.id);
    const where = machineOf?.(m) || m.route.split(">").pop() || "";
    return "`#" + m.name + (where ? ` · ${where}` : "") + (ok ? "" : ` · ${LOCKED.label.toLowerCase()}`) + "`";
  }).join("");
}

// ---------- 任务:@----------
// "@" 列出该 chat 的 agent 可触达的 space 中的任务(同一触达图:任务的 space
// 时),选中后以 `[@](task:vm-demo/?folder=~/dev/shop)` 形式发给 agent:route 来自
// agent 所在机器(此处为 "",经一跳时为 "laptop>vm-x"),然后是其 ID,再是所属任务的文件夹,它
// `herdr-task show --folder <folder>` 接受的参数(另一台机器上为 `herdr-task --on vm-demo show ...`)。
// 聊天自己的 space 则省去文件夹:`[@](task:)`。用 "@" 而非 "#":# 表示 spaces,而任务是其
// agent,如同提及一个人。各 agent CLI 自带的 @file picker 看不到它:由 hc send 把文字粘贴进去。

// 输入框末尾正在输入的 "@word",否则为 null(邮箱的 "a@b" 不算)。
export function typingTask(text) {
  const m = /(?:^|\s)@([\w.-]*)$/.exec(String(text ?? "").replace(/\n+$/, ""));
  return m ? m[1] : null;
}

// 目标中的文字:含空格或 ")" 的文件夹不会破坏链接。
const enc = (folder) => String(folder).split("/").map(encodeURIComponent).join("/");

// tell 发给任务 agent 时 "task:" 之后的格式:[route/]REF[?folder=<folder>]。
export const taskTarget = ({ route = "", ref, folder = "" }) => `${route ? `${route}/` : ""}${ref}${folder ? `?folder=${enc(folder)}` : ""}`;

// 选中的任务会写入消息的内容。
export const taskToken = (t) => `[@${t.ref}](task:${taskTarget(t)})`;

export function parseTask(target) {
  const q = target.indexOf("?folder="), head = q < 0 ? target : target.slice(0, q);
  let folder = q < 0 ? "" : target.slice(q + 8);
  try { folder = decodeURIComponent(folder); } catch {}
  const i = head.lastIndexOf("/");
  return { ref: i < 0 ? head : head.slice(i + 1), target, route: i < 0 ? "" : head.slice(0, i), folder };
}

// 输入框中正输入的 "@word" 会被替换成所选任务的简写("@");其 token 在发送时写入。
export const pickTaskInto = (text, t) => String(text ?? "").replace(/\n+$/, "").replace(/@[\w.-]*$/, `@${t.ref} `);

// 发送时:用户选的每个 "@REF" 转成对应 token(picked: [{ ref, route, folder }])。
export function expandTasks(text, picked) {
  if (!picked?.length) return text;
  const by = new Map(picked.map((t) => [t.ref.toLowerCase(), t]));
  return String(text).replace(/(^|[\s(])@([\w.-]+)(?![\w.-]|\]\()/g, (all, pre, word) => {
    const t = by.get(word.toLowerCase()) ?? by.get(word.replace(/[.]+$/, "").toLowerCase());
    return t ? `${pre}${taskToken(t)}${word.slice(t.ref.length)}` : all;
  });
}

// 决定任务靠前排的优先级:等你的最先,工作中次之,ready 再次;done 最后。
export const TASK_RANK = { need: 0, work: 1, ready: 2, merging: 3, queued: 4, todo: 5, done: 9 };

// 为输入内容匹配 tasks:[{ ref, title, status, at?, space?, machine? }]。以其开头的 ID 在前,然后是其他 ID,
// 包含它的标题、space 或 machine;组内先按 TASK_RANK 再按最新,Done 的排最后。
export function matchTasks(list, word, n = 8) {
  const w = String(word ?? "").toLowerCase();
  const order = (a, b) => (TASK_RANK[a.status] ?? 6) - (TASK_RANK[b.status] ?? 6) || (b.at ?? 0) - (a.at ?? 0);
  const starts = list.filter((t) => t.ref.toLowerCase().startsWith(w)).sort(order);
  const has = list.filter((t) => !t.ref.toLowerCase().startsWith(w) && [t.ref, t.title, t.space, t.machine].some((x) => String(x ?? "").toLowerCase().includes(w))).sort(order);
  const all = [...starts, ...has];
  const live = all.filter((t) => t.status !== "done");
  return (w ? all : [...live, ...all.filter((t) => t.status === "done")]).slice(0, n);
}

// 短到能放进 chip 的标题。
export const short = (title, n = 28) => { const t = String(title ?? "").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
