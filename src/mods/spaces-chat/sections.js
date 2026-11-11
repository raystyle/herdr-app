// Sections,同 Slack 的 sidebar:一台 machine 的 spaces 归入命名的标题下,各自带
// 顺序与折叠;不属于任何分区的 space 留在顶部、machine 之下。另有每个 space 的图标:
// 用户所选的 emoji,否则 "#"。两者都存于 shared "spaces-chat"(shared.json:它
// 重启后保留)= { sections: [{ id, machine, name, folded, spaces: [space ids], icon?(emoji;
// 无则用文件夹名) }],icons: { space: emoji }、pinned: [space ids]、pinnedFolded、machines:
// { [machine 名称,本机为 ""]: { name?, icon? } } }。
// Pinned(同 herdr-winapp,即 Slack 的 star):来自任意 machine 的 spaces,按其自身顺序,显示在
// sidebar 顶部而非其 machine 之下。置顶的 space 保留其分区,因此
// 取消置顶即放回原处。此处机器的名称与 emoji 只是侧栏的
// 显示:其 hc 名称保持不变。

import { shared, setShared, machines } from "herdr";
import { spaces } from "./live.js";
import { toast } from "./ui.js";
import { DELETED, deletedSection, sectionDeletedToast, withRestoredSection } from "./core/spaces.js";

const KEY = "spaces-chat";

export function data() {
  const d = shared(KEY) ?? {};
  return { ...d, sections: d.sections ?? [], icons: d.icons ?? {}, pinned: d.pinned ?? [], machines: d.machines ?? {} };
}
const save = (d) => setShared(KEY, d);
const same = (a, b) => (a ?? null) === (b ?? null);

export const sectionsOf = (machine) => data().sections.filter((s) => same(s.machine, machine));
export const sectionOf = (space) => data().sections.find((s) => s.spaces.includes(space)) ?? null;
export const iconOf = (space) => data().icons[space] ?? null;

// 该机器其他分组尚未使用的名称(忽略大小写)。
export const nameFree = (machine, name, except) =>
  !sectionsOf(machine).some((s) => s.id !== except && s.name.toLowerCase() === name.trim().toLowerCase());

// 把 space 放入某 section 的 `at` 处(缺省为末尾),或放回顶部(section 为 null)。
// `at` 计数该分区的 spaces 时不含本项。
export function placeSpace(space, section, at) {
  const d = data();
  const sections = d.sections.map((s) => ({ ...s, spaces: s.spaces.filter((x) => x !== space) }));
  const s = sections.find((x) => x.id === section);
  if (s) s.spaces.splice(Math.min(at ?? s.spaces.length, s.spaces.length), 0, space);
  save({ ...d, sections });
}

// 在其机器分组的末尾新建分组;`space` 直接放入其中。
export function addSection(machine, name, space) {
  const d = data();
  const id = `sec-${Date.now().toString(36)}`;
  save({ ...d, sections: [...d.sections, { id, machine: machine ?? null, name: name.trim(), folded: false, spaces: [] }] });
  if (space) placeSpace(space, id);
  return id;
}

const change = (id, f) => {
  const d = data();
  save({ ...d, sections: d.sections.map((s) => (s.id === id ? f(s) : s)) });
};
export const renameSection = (id, name) => change(id, (s) => ({ ...s, name: name.trim() }));
export const setSectionIcon = (id, emoji) => change(id, (s) => { const { icon: _, ...rest } = s; return emoji ? { ...rest, icon: emoji } : rest; });
export const foldSection = (id) => change(id, (s) => ({ ...s, folded: !s.folded }));
export const unfoldSection = (id) => change(id, (s) => ({ ...s, folded: false }));

// 其 spaces 回到顶部;没有 space 被关闭。toast 在几秒内提供 Undo:点击
// 运行 spaces-chat.undo-section(main.js),依据 shared 将分区恢复原状
// "spaces-chat.deleted" = { section, at }(最后删除的一个)。
// 保留的分区、其 toast 文案与 Undo 来自共享 core(core/spaces.js):web 端 Delete 走同样的逻辑。
export function deleteSection(id) {
  const d = data();
  const gone = deletedSection(d, id);
  if (!gone) return;
  setShared(DELETED, gone);
  save({ ...d, sections: d.sections.filter((s) => s.id !== id) });
  toast({ ...sectionDeletedToast(gone.section.name), level: "info", timeout: 8000, action: { name: "spaces-chat.undo-section" } });
}

// Undo:恢复到原位,其间未被其他 section 收编的 spaces 一并恢复。
export function restoreSection() {
  const gone = shared(DELETED);
  if (!gone?.section) return;
  setShared(DELETED, null);
  const d = data();
  if (d.sections.some((s) => s.id === gone.section.id)) return;
  save({ ...d, sections: withRestoredSection(d, gone).sections });
}

export function setIcon(space, emoji) {
  const d = data();
  const icons = { ...d.icons };
  if (emoji) icons[space] = emoji;
  else delete icons[space];
  save({ ...d, icons });
}

// layout 读取正常但已消失的 space,会被静默移出 section 与图标。一台 machine
// 离开时保留自己的状态:其 spaces 只是暂时不可见。同时保证一个 space 只属于一个分区。
export function prune() {
  const d = data();
  if (!d.sections.length && !Object.keys(d.icons).length && !d.pinned.length) return;
  const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? ""));
  const live = new Set(spaces().map((s) => s.id));
  // 远程 id 形如 "<machine>/<id>"。
  const gone = (id) => !live.has(id) && ready.has(id.includes("/") ? id.split("/")[0] : "");
  const seen = new Set();
  let changed = false;
  const sections = d.sections.map((s) => {
    const kept = s.spaces.filter((id) => !gone(id) && !seen.has(id));
    kept.forEach((id) => seen.add(id));
    if (kept.length !== s.spaces.length) changed = true;
    return kept.length === s.spaces.length ? s : { ...s, spaces: kept };
  });
  const icons = Object.fromEntries(Object.entries(d.icons).filter(([id]) => !gone(id)));
  if (Object.keys(icons).length !== Object.keys(d.icons).length) changed = true;
  const pinned = d.pinned.filter((id) => !gone(id));
  if (pinned.length !== d.pinned.length) changed = true;
  if (changed) save({ ...d, sections, icons, pinned });
}

// Pinned:把 `space` 移到其末尾(或在 `at` 处,计数不含它),或移出(`on` 为 false)。
export const isPinned = (space) => data().pinned.includes(space);
export function pin(space, on = true, at) {
  const d = data();
  const pinned = d.pinned.filter((x) => x !== space);
  if (on) pinned.splice(Math.min(at ?? pinned.length, pinned.length), 0, space);
  save({ ...d, pinned });
}
export const foldPinned = () => { const d = data(); save({ ...d, pinnedFolded: !d.pinnedFolded }); };

// 机器(null:本机)在侧边栏中的呈现:未重命名时用其名称,以及一个
// emoji 或无(用其服务器或显示器图标)。
const mkey = (machine) => machine ?? "";
export function machineLook(machine) {
  const m = data().machines[mkey(machine)] ?? {};
  return { name: m.name || (machine ?? "本机"), named: Boolean(m.name), icon: m.icon ?? null };
}
// "" 返回机器自己的名称;不用 emoji,用其图标。
export function setMachineLook(machine, name, icon) {
  const d = data();
  const look = { ...(name.trim() ? { name: name.trim() } : {}), ...(icon ? { icon } : {}) };
  const all = { ...d.machines };
  if (Object.keys(look).length) all[mkey(machine)] = look;
  else delete all[mkey(machine)];
  save({ ...d, machines: all });
}
