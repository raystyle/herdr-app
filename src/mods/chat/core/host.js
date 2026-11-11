// Serve from(herdr-winapp settings › Web,`herdr-winapp web serve-from <machine>`):由哪台 machine 提供 web app,以及
// 每台 machine 如何与它保持同一份事实。
// - host 提供 web app 并持有权威数据:共享文档("herdr-winapp":pins、侧边栏、Notify、
// Window switches)和设置文件(~/.config/herdr-winapp/settings.json,角色指令)。另一台机器的 service
// 经 herdr-core 的链接在彼处读写;其窗口继续使用自己的副本,并保持同步。
// - 是哪台机器:每台机器上都有 herdr-core document "herdr-winapp.host" = { id, at }(id:host 的 herdr-core
// id,每台机器相同)。最新记录胜出,各 service 把它转发给与其链接的机器,
// 迁移时休眠的机器在唤醒后也能得知。无记录时:各机器服务自己(同 3.1.1 之前)。
// - 每个 service 在 "herdr-winapp.node" = { id, name, os, version, link, links: { name: id }, at } 中表明身份:
// 另一台机器读取 host 的记录来了解其命名。
// - 名称是各机器自己的:笔记本称 mini 为 "mac-mini",mini 称笔记本为 "m3",而共享
// data 就是这样命名 space 和机器的("mac-mini/sp1" 在那边即 "sp1" 在这边)。relocate() 把值从一台
// 机器的命名换成另一台的(经由 id);对方无法命名的部分被舍弃,keepForeign()
// 变更回来时,保留只有 host 知道的部分。
// Shared core:源文件为 core/host.js;bin/sync-shared 会把它复制进 lib/COPIES 中的各 mod。

export const HOST_DOC = "herdr-winapp.host";
export const NODE_DOC = "herdr-winapp.node";
// web 应用的链接,{ link, id }(id:host 的),由 host 在本机及每台链接的 machine 上写入:某台 machine 上的 agent
// 无自身服务的机器(如 VM)仍能给用户链接(herdr-artifact link,)
export const WEB_DOC = "herdr-winapp.web";
// 节点记录比这更旧:该机器的服务已消失(各节点每分钟写一次)
export const NODE_STALE = 3 * 60_000;

/* 多条记录中最新且有效的 host 记录(null:未设置)。 */
export function newestHost(records) {
  let best = null;
  for (const r of records) if (r && typeof r.id === "string" && r.id && Number.isFinite(r.at) && (!best || r.at > best.at)) best = r;
  return best;
}

/* 节点记录是否表明其 service 正在运行。 */
export const nodeAlive = (n, now = Date.now()) => Boolean(n?.id && now - (Number(n.at) || 0) < NODE_STALE);

/* 把 `from` 命名下的机器名换成 `to` 的命名:null 表示机器自身。from 与 to:{ id, links: { name: id } }。undefined:`to` 未链接该机器。 */
export function renamer(from, to) {
  return (name) => {
    const id = name === null || name === undefined || name === "" || name === "local" ? from?.id : from?.links?.[name];
    if (!id || !to?.id) return undefined;
    if (id === to.id) return null;
    const hit = Object.entries(to.links ?? {}).find(([, v]) => v === id);
    return hit ? hit[0] : undefined;
  };
}

/* 把 space、tab 或 terminal id("sp1" 在本地,"vm/sp1" 在远端)换成另一套命名;undefined:那边无法命名。 */
export function moveId(id, rename) {
  const s = String(id);
  const cut = s.indexOf("/");
  const m = rename(cut < 0 ? null : s.slice(0, cut));
  if (m === undefined) return undefined;
  const rest = cut < 0 ? s : s.slice(cut + 1);
  return m === null ? rest : `${m}/${rest}`;
}

// 任务的置顶键(core/tasks.js taskKey):"<machine, 此处为空>:<folder>#<id>"
function movePin(key, rename) {
  const s = String(key);
  const cut = s.indexOf(":");
  if (cut < 0) return s;
  const m = rename(s.slice(0, cut) || null);
  return m === undefined ? undefined : `${m ?? ""}:${s.slice(cut + 1)}`;
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const mapKeys = (o, fn) => {
  const out = {};
  for (const [k, v] of Object.entries(isObj(o) ? o : {})) { const n = fn(k); if (n !== undefined) out[n] = v; }
  return out;
};
const keep = (list, fn) => (Array.isArray(list) ? list.map(fn).filter((x) => x !== undefined) : list);
// 侧栏 machines 中的机器键(此处为 "")与 Notify 的("local")
const machineKey = (here) => (rename) => (k) => { const m = rename(k === here ? null : k); return m === undefined ? undefined : m ?? here; };

/* 共享文档一个键的值,换成另一台机器的命名(不含机器名的键原样返回)。 */
export function relocate(key, value, rename) {
  if (value === null || value === undefined) return value;
  if (key === "tasks.pinned") return keep(value, (k) => movePin(k, rename));
  if (key === "spaces-chat" && isObj(value)) {
    const sections = Array.isArray(value.sections) ? value.sections.flatMap((s) => {
      const m = rename(s?.machine ?? null);
      return m === undefined ? [] : [{ ...s, machine: m, spaces: keep(s.spaces ?? [], (id) => moveId(id, rename)) }];
    }) : value.sections;
    return { ...value, sections, icons: mapKeys(value.icons, (id) => moveId(id, rename)), pinned: keep(value.pinned, (id) => moveId(id, rename)),
      ...(isObj(value.machines) ? { machines: mapKeys(value.machines, machineKey("")(rename)) } : {}),
      // 每台机器被拖动后的 spaces 顺序(core/spaces.js withOrder):其 key 与 ids
      // machine 的拖拽顺序(core/spaces.js 的 withMachineOrder):"" 表示本机,与 machines
      ...(Array.isArray(value.machineOrder) ? { machineOrder: keep(value.machineOrder, machineKey("")(rename)) } : {}),
      ...(isObj(value.order) ? { order: Object.fromEntries(Object.entries(mapKeys(value.order, machineKey("")(rename))).map(([k, ids]) => [k, keep(ids, (id) => moveId(id, rename))])) } : {}) };
  }
  if (key === "notify" && isObj(value)) {
    return { ...value, ...(isObj(value.machines) ? { machines: mapKeys(value.machines, machineKey("local")(rename)) } : {}),
      ...(isObj(value.spaces) ? { spaces: mapKeys(value.spaces, (id) => moveId(id, rename)) } : {}) };
  }
  return value;
}

/* 整份文档换成另一套命名。 */
export const relocateDoc = (doc, rename) => Object.fromEntries(Object.entries(isObj(doc) ? doc : {}).map(([k, v]) => [k, relocate(k, v, rename)]));

/* 把键的新值写给 host(已换成 host 的命名),并把 host 原有的、写入方无法命名的那些机器的值放回去:对它们调用 back(host 命名下的 name) 返回 undefined。 */
export function keepForeign(key, next, old, back) {
  if (old === null || old === undefined || next === null || next === undefined) return next;
  const foreignId = (id) => moveId(id, back) === undefined;
  if (key === "tasks.pinned" && Array.isArray(next) && Array.isArray(old)) return [...next, ...old.filter((k) => movePin(k, back) === undefined && !next.includes(k))];
  if (key === "spaces-chat" && isObj(next) && isObj(old)) {
    const out = { ...next };
    if (Array.isArray(old.sections)) out.sections = [...(next.sections ?? []), ...old.sections.filter((s) => back(s?.machine ?? null) === undefined)];
    if (isObj(old.icons)) out.icons = { ...Object.fromEntries(Object.entries(old.icons).filter(([id]) => foreignId(id))), ...(next.icons ?? {}) };
    if (Array.isArray(old.pinned)) out.pinned = [...(next.pinned ?? []), ...old.pinned.filter((id) => foreignId(id) && !(next.pinned ?? []).includes(id))];
    if (isObj(old.machines)) out.machines = { ...Object.fromEntries(Object.entries(old.machines).filter(([k]) => back(k === "" ? null : k) === undefined)), ...(next.machines ?? {}) };
    // 写入方无法识别名称的 machine 保持原位,排在其原跟随者之后
    if (Array.isArray(old.machineOrder) && Array.isArray(next.machineOrder)) {
      const mo = [...next.machineOrder];
      for (const [i, k] of old.machineOrder.entries()) {
        if (mo.includes(k) || back(k === "" ? null : k) !== undefined) continue;
        const after = old.machineOrder.slice(0, i).findLast((x) => mo.includes(x));
        mo.splice(after === undefined ? 0 : mo.indexOf(after) + 1, 0, k);
      }
      out.machineOrder = mo;
    }
    if (isObj(old.order)) out.order = { ...Object.fromEntries(Object.entries(old.order).filter(([k]) => back(k === "" ? null : k) === undefined)), ...(next.order ?? {}) };
    return out;
  }
  if (key === "notify" && isObj(next) && isObj(old)) {
    const out = { ...next };
    if (isObj(old.machines)) out.machines = { ...Object.fromEntries(Object.entries(old.machines).filter(([k]) => back(k === "local" ? null : k) === undefined)), ...(next.machines ?? {}) };
    if (isObj(old.spaces)) out.spaces = { ...Object.fromEntries(Object.entries(old.spaces).filter(([id]) => foreignId(id))), ...(next.spaces ?? {}) };
    return out;
  }
  return next;
}

// // ---- 设置文件 ----------------------------------------------------------------------------------------
// { version, everywhere, machines: { "local" | name: {...} }, spaces: { id | "m/id": { name, machine, folder, ... } } }:
// 机器自己的文件没有 "pushed_from"(herdr-task 推送到其他机器时不改动自身文件)。

/* 另一台机器命名下的设置文件:那边自己的文件(绝不是推送过来的副本)。 */
export function relocateSettings(file, rename) {
  const f = isObj(file) ? file : {};
  const { pushed_from: _p, here: _h, ...rest } = f;
  const spaces = {};
  for (const [id, v] of Object.entries(isObj(f.spaces) ? f.spaces : {})) {
    const n = moveId(id, rename);
    if (n === undefined) continue;
    const m = isObj(v) && typeof v.machine === "string" ? rename(v.machine) : null;
    spaces[n] = isObj(v) && "machine" in v ? (m ? { ...v, machine: m } : (({ machine: _m, ...o }) => o)(v)) : v;
  }
  return { ...rest, machines: mapKeys(f.machines, machineKey("local")(rename)), spaces };
}

// settings 文件的每个叶子,以 path -> JSON 表示(三方合并会比较这些)。
function leaves(o, at = [], out = new Map()) {
  if (isObj(o) && Object.keys(o).length) { for (const [k, v] of Object.entries(o)) leaves(v, [...at, k], out); }
  else if (at.length) out.set(JSON.stringify(at), JSON.stringify(o));
  return out;
}
function put(o, path, v) {
  let t = o;
  for (const k of path.slice(0, -1)) { if (!isObj(t[k])) t[k] = {}; t = t[k]; }
  if (v === undefined) delete t[path[path.length - 1]]; else t[path[path.length - 1]] = v;
}
// 移除后残留的空对象
function prune(o) {
  for (const [k, v] of Object.entries(o)) if (isObj(v)) { prune(v); if (!Object.keys(v).length) delete o[k]; }
  return o;
}

/* 两份副本自上次一致(base)后都有改动:每个叶子取改动它的那一方,双方都改时取 host 的。三者使用同一套命名。返回合并后的文件。 */
export function merge3(base, mine, theirs) {
  const b = leaves(base ?? {}), m = leaves(mine ?? {}), t = leaves(theirs ?? {});
  const out = JSON.parse(JSON.stringify(theirs ?? {}));
  for (const k of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
    const bv = b.get(k), mv = m.get(k), tv = t.get(k);
    if (mv === bv || mv === tv || tv !== bv) continue; // 只有自己的改动:写入自己的
    put(out, JSON.parse(k), mv === undefined ? undefined : JSON.parse(mv));
  }
  return prune(out);
}

// // ---- 设置 › 网页的服务来源 ------------------------------------------------------------------------------
export const SERVE = {
  title: "服务来源",
  about: "The machine that serves the web app. An always-on one keeps it up while this computer sleeps.",
  here: "本机",
  moving: (m) => `Moving the web app to ${m}…`,
  failed: (why) => `Couldn't move it: ${why}`,
  offline: "离线",
  elsewhere: (m) => `On, served from ${m} and private to your tailnet. This computer stays in step with it.`,
  unreachable: (m) => `Served from ${m}, which can't be reached now. This computer keeps its own copy until it's back.`,
  // 该选择,已确认(窗口用内联确认,web 用对话框)
  confirm: (m, here) => (here ? "从这台电脑提供网页应用?" : `Serve the web app from ${m}?`),
  detail: (m, here) => (here
    ? "Its link moves here and the other machine stops sharing it. Pins and settings come along."
    : `herdr-winapp's web service is installed or updated on ${m}, its link moves there and this computer stops sharing it. Pins and settings come along.`),
  verb: "移动它",
};

/* picker 中一台机器的行:"mac-mini · macOS"、"vm-demo · Linux · 离线"。 */
export function serveChoice(m) {
  const os = m.os === "darwin" ? "macOS" : m.os === "linux" ? "Linux" : m.os || null;
  return [m.here ? SERVE.here : m.name, os, m.state && m.state !== "connected" ? SERVE.offline : null].filter(Boolean).join(" · ");
}
