// 用户眼中的 spaces:每台机器的 spaces(Herdr 自己的 layout 文档 “herdr-app”,按
// 机器),每个带其 tabs、其 Assistant(为它标注的 live coordinator terminal),以及该
// Assistant 有新消息(unread:核心 label herdr.chat.read,在每个设备上一致)。窗口
// 从 Herdr 获取 spaces(spaces());service 和 web app 在这里由相同文档构建。
// 共享核心:源为 core/spaces.js;bin/sync-shared 会把它复制到 lib/COPIES 里的各 mod。

export const READ = "herdr.chat.read";
export const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);

// agent 停靠其后的 chat pane:核心 label herdr.chat。与所有 label 一样,它保存的是自己所在
// 机器给 pane 命名(不带 “<machine>/” 前缀),因此无论怎么称呼那台机器,窗口和 service 读到的都是同一 pane,
// 怎么称呼那台机器。自己写 “<machine>/<pane>” 的窗口会让别的窗口找不到该 pane,
// 并把该 agent 当作 chat 已关闭而结束(#761)。
export const CHAT = "herdr.chat";
// 写入 herdr.chat 的 chat pane 内容(app id:其他机器的为 “<machine>/<pane>”)。
export const chatLabel = (pane) => (pane ? String(pane).split("/").pop() : "");
// terminal 停靠在其后的 chat pane,以本窗口的 app id 表示(null:无)。早期版本
// 带机器前缀写入的读取结果相同。
export function chatPane(k) {
  const c = k?.labels?.[CHAT];
  if (!c) return null;
  const m = machineOf(k.address ?? ""), id = chatLabel(c);
  return m ? `${m}/${id}` : id;
}

// space 的 Assistant:该 space 所在机器上为它标注的 live coordinator terminal(label 保存该机器给 pane 的名字,不带 “<machine>/” 前缀,因此无论各窗口怎么称呼那台机器,窗口和 service 读到的都是同一个 pane。
// 该机器自己的 id,不带 app id 的 “<machine>/” 前缀)。
export function assistantOf(space, ts) {
  const id = String(space.id).split("/").pop();
  return ts.find((k) => k.state === "live" && k.labels?.["herdr.role"] === "coordinator"
    && k.labels?.["herdr.coordinator.space"] === id && machineOf(k.address) === (space.machine ?? null)) ?? null;
}

// 最近读取的 turn。尚无任何标记时:窗口最后一次看到它完成的 turn(其 “chat.seen”)。
export function readTurn(k, seen = {}) {
  const mark = Number(k.labels?.[READ]);
  return Number.isFinite(mark) ? mark : seen[k.address] ?? 0;
}

// unread 语义同 Slack:只有 Assistant 计入;task chat 永远不会使行加粗。
export function isUnread(k, seen = {}, asked = 0) {
  if (!k || k.labels?.["herdr.role"] !== "coordinator") return false;
  return (k.turn ?? 0) > Math.max(readTurn(k, seen), asked);
}

// layout 节点显示的每个 terminal:terminal 块的,或 chat 块的 agent。
function terminalsIn(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const c = node.content;
  if (c?.terminal) out.push(c.terminal);
  if (c?.props?.terminal) out.push(c.props.terminal);
  for (const ch of node.children ?? []) terminalsIn(ch, out);
  return out;
}

// 从某台机器的 “herdr-app” 文档取它的 spaces。machine 此处为 null,否则为机器名(此时 id 的读取带
// “<machine>/<id>”,与窗口的 spaces() 一致)。
export function spacesFromDoc(doc, machine = null) {
  const at = (id) => (machine ? `${machine}/${id}` : id);
  // 窗口已带机器写入的 terminal(“<machine>/t6”)保留原样:绝不出现 “<machine>/<machine>/t6”(#818)
  const atTerm = (id) => (machine && String(id).startsWith(`${machine}/`) ? id : at(id));
  return (Array.isArray(doc?.spaces) ? doc.spaces : []).map((s) => ({
    id: at(s.id),
    machine,
    name: s.name ?? "",
    folder: s.folder ?? "",
    tabs: (s.tabs ?? []).map((t) => ({ id: at(t.id), name: t.name ?? "", terminals: terminalsIn(t.root).map(atTerm) })),
  }));
}

// space 的名称,窗口 sidebar 与 web 上一致:用户起的名字,否则沿用
// 位置(`at`):home 文件夹显示 “Home”,repo 用其名,其他文件夹用自身名。绝不用 “~”(如 New space
// 且 tab 栏曾把 home 下的命名为此:这也算未命名)。named:false 表示 Herdr 自己起的名。
const HOME_AT = /^\/(home\/[^/]+|Users\/[^/]+|root)(?=\/|$)/;
// sidebar 所显示的文件夹,来自本机或其他机器上的 home 文件夹:“~/dev/app”。
export const tilde = (path) => String(path ?? "").replace(HOME_AT, "~");
// 同一机器上同名的两个 space(worktree 挂在其 repo 下除外:此时显示 branch):各自显示其文件夹。
// rows:[{ id, machine, name, linked }];与其他项同名的那些 id。
export function sharedNames(rows) {
  const key = (r) => `${r.machine ?? ""}\u0000${String(r.name).toLowerCase()}`;
  const count = new Map();
  for (const r of rows) if (!r.linked) count.set(key(r), (count.get(key(r)) ?? 0) + 1);
  return new Set(rows.filter((r) => (count.get(key(r)) ?? 0) > 1).map((r) => r.id));
}
export const isHomeFolder = (path, home = null) => { const p = String(path ?? "").replace(/\/+$/, ""); return (!!home && p === home) || (HOME_AT.test(p) && !p.replace(HOME_AT, "")); };
export function spaceName(s, { at = s?.folder, repo = null, home = null, named = true } = {}) {
  if ((named && s?.name && s.name !== "~") || !at) return s?.name && s.name !== "~" ? s.name : "Home";
  return isHomeFolder(at, home) ? "Home" : repo ?? String(at).replace(/\/+$/, "").split("/").pop();
}

// sidebar 自己的数据(mods/spaces-chat:sections、icons、Pinned):{ sections, icons, pinned }。
export function sidebarOf(s) {
  return {
    sections: Array.isArray(s?.sections) ? s.sections : [],
    icons: s?.icons && typeof s.icons === "object" ? s.icons : {},
    pinned: Array.isArray(s?.pinned) ? s.pinned : [],
  };
}

// // ---- 侧栏自身数据的变化(shared "spaces-chat",mods/spaces-chat/sections.js 的格式)----
const tidyBar = (d) => ({ ...(d ?? {}), sections: (d?.sections ?? []).map((s) => ({ ...s, spaces: [...(s.spaces ?? [])] })), icons: { ...(d?.icons ?? {}) },
  pinned: [...(d?.pinned ?? [])], machines: { ...(d?.machines ?? {}) } });

// 移动 space:移入 Pinned、某个 section(其 id),或回到所属机器的顶层(null);before:它原来排在其前面的 space。置顶的 space 保留其所属 section(Unpin 时放回),与窗口一致。
// 之前。置顶的 space 保留其所属 section(Unpin 时放回),与窗口一致。
export function withMove(d, space, to, before = null) {
  const x = tidyBar(d);
  const put = (list) => { const i = before ? list.indexOf(before) : -1; list.splice(i < 0 ? list.length : i, 0, space); };
  if (to === "pinned") { x.pinned = x.pinned.filter((s) => s !== space); put(x.pinned); return x; }
  x.pinned = x.pinned.filter((s) => s !== space);
  for (const s of x.sections) s.spaces = s.spaces.filter((id) => id !== space);
  const sec = to ? x.sections.find((s) => s.id === to) : null;
  if (sec) put(sec.spaces);
  return x;
}

export function withSection(d, { id, name, machine = null, icon = null }) {
  const x = tidyBar(d);
  x.sections.push({ id, machine, name, folded: false, spaces: [], ...(icon ? { icon } : {}) });
  return x;
}

export function withoutSection(d, id) {
  const x = tidyBar(d);
  x.sections = x.sections.filter((s) => s.id !== id);
  return x;
}

// 删除一个 section(其菜单的 Delete,立即生效):为 Undo 保留的内容(共享 “spaces-chat.deleted”)及其 toast。
export const DELETED = "spaces-chat.deleted";
export function deletedSection(d, id) {
  const at = (d?.sections ?? []).findIndex((s) => s.id === id);
  return at < 0 ? null : { section: d.sections[at], at };
}
export const sectionDeletedToast = (name) => ({ title: `Deleted the section “${name}”`, body: "它的空间已上移到机器。点击撤销。" });
// Undo:恢复到原位,其间未被其他 section 收编的 spaces 一并恢复。
export function withRestoredSection(d, gone) {
  const x = tidyBar(d);
  if (!gone?.section || x.sections.some((s) => s.id === gone.section.id)) return x;
  const filed = new Set(x.sections.flatMap((s) => s.spaces ?? []));
  x.sections.splice(Math.min(gone.at, x.sections.length), 0, { ...gone.section, spaces: (gone.section.spaces ?? []).filter((s) => !filed.has(s)) });
  return x;
}

export function withSectionName(d, id, name, icon) {
  const x = tidyBar(d);
  for (const s of x.sections) if (s.id === id) { s.name = name; if (icon !== undefined) { if (icon) s.icon = icon; else delete s.icon; } }
  return x;
}

// sidebar 里 space 名之后只显示异常情况:“herdr · spike”。当名字
// 已经说明(a worktree 以其 branch 命名),master/main 也省去:几乎每个 space 都在其中一个分支上。
// g:{ name(repo), branch };tree:嵌套在其 repo 下;tag:其机器,位于 Pinned。
export function gitTail(g, { name = "", tree = false, tag = null } = {}) {
  const raw = g?.branch ?? "detached";
  const same = (a) => String(a ?? "").toLowerCase() === String(name).toLowerCase();
  const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
  const repo = tree || same(g?.name) ? "" : g?.name ?? "";
  return { where: [tag, repo, branch].filter(Boolean).join(" \u00b7 ") };
}

// 机器在 sidebar 里的名字和 emoji(machines[""] 是本机):名字为空则退回其自带名称。
export function withMachineLook(d, machine, name, icon) {
  const x = tidyBar(d), k = machine ?? "";
  const m = { ...(x.machines[k] ?? {}) };
  if (name) m.name = name; else delete m.name;
  if (icon !== undefined) { if (icon) m.icon = icon; else delete m.icon; }
  if (Object.keys(m).length) x.machines[k] = m; else delete x.machines[k];
  return x;
}

export function withIcon(d, space, icon) {
  const x = tidyBar(d);
  if (icon) x.icons[space] = icon; else delete x.icons[space];
  return x;
}

// // ---- 用户拖动各机器空间的顺序----
// 保存在 sidebar 自己的数据里(共享 “spaces-chat”.order:{ [机器名,本机为 ""]: [space id 列表] }),
// 因此对每个设备、每个 space 都成立,包括 Herdr 不保存的那些(service 创建的无
// 窗口从不在 Herdr 列表里,且总是排最后)。web、service 和窗口都显示它;它创建的 spaces
// 未命名的保持 Herdr 在其余对象中的位置(排在当地前一者之后)。
export const orderKey = (machine) => machine ?? "";

// ids 按新顺序排列,`was` 有而 ids 缺的项放回其原来跟随者之后(无跟随者:置于顶部)。
export function keptOrder(was, ids) {
  const out = [...new Set(ids)];
  for (const [i, id] of was.entries()) {
    if (out.includes(id)) continue;
    const after = was.slice(0, i).findLast((x) => out.includes(x));
    out.splice(after === undefined ? 0 : out.indexOf(after) + 1, 0, id);
  }
  return out;
}

// 列表(任意机器的,按 Herdr 顺序),各机器的 spaces 按保存顺序;每台机器的 spaces 保持
// 在 list 中的原有位置,机器顺序因此不变。
export function inOrder(list, order, idOf = (s) => s.id, machineOf = (s) => s.machine ?? null) {
  if (!order || typeof order !== "object" || !Object.keys(order).length) return list;
  const by = new Map();
  for (const x of list) {
    const k = orderKey(machineOf(x));
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(x);
  }
  const sorted = new Map();
  for (const [k, xs] of by) {
    const want = Array.isArray(order[k]) ? order[k] : [];
    const ids = xs.map(idOf);
    const of = new Map(xs.map((x) => [idOf(x), x]));
    sorted.set(k, keptOrder(ids, want.filter((id) => of.has(id))).map((id) => of.get(id)));
  }
  const at = new Map();
  return list.map((x) => {
    const k = orderKey(machineOf(x)), n = at.get(k) ?? 0;
    at.set(k, n + 1);
    return sorted.get(k)[n];
  });
}

// sidebar 数据,机器的 spaces 按新顺序排列:id 按显示顺序(有的可能在 section 里或被隐藏),
// `now` 为该机器当前显示的全部 spaces;其余保持它们之间原有的位置。
export function withOrder(d, machine, ids, now = []) {
  const x = tidyBar(d);
  const order = x.order && typeof x.order === "object" && !Array.isArray(x.order) ? { ...x.order } : {};
  order[orderKey(machine)] = keptOrder(now, ids);
  return { ...x, order };
}

// // ---- 用户拖动机器的顺序----
// 与 spaces 顺序一同保存(共享 “spaces-chat”.machineOrder:[机器名,本机为 ""]),因此
// sidebar 在每个设备上、窗口和 task 列表都以一致方式显示机器。未保存时:本机在前,其余
// 其余按原顺序。未命名的新机器排在末尾;消失的机器不再显示。
export const machineOrderOf = (d) => (Array.isArray(d?.machineOrder) ? d.machineOrder.filter((k) => typeof k === "string") : []);

// keys(本机为 "",否则为机器名;null 读作 "")按保存的顺序,其余按原顺序排在其后。
export function machinesInOrder(keys, saved) {
  const all = [...new Set(keys.map(orderKey))];
  const first = [...new Set(saved ?? [])].filter((k) => all.includes(k));
  return [...first, ...all.filter((k) => !first.includes(k))];
}

// 列表(凡带 machine 的)按机器顺序,各机器自己的按原有顺序。
export function byMachineOrder(list, saved, machineOf = (x) => x.machine ?? null) {
  if (!saved?.length) return list;
  const keys = machinesInOrder(list.map(machineOf), saved);
  const at = (x) => keys.indexOf(orderKey(machineOf(x)));
  return list.map((x, i) => [x, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([x]) => x);
}

// sidebar 数据,机器按新顺序排列:key 按显示顺序(本机为 "");原有但 keys 中
// 缺少的(机器在别处离线,或本机未知)保持在其原跟随者之后。
export function withMachineOrder(d, keys) {
  const x = tidyBar(d);
  return { ...x, machineOrder: keptOrder(machineOrderOf(d), keys.map(orderKey)) };
}
