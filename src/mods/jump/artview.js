// artifact 查看器(用户的决定):chat 卡片、Ctrl+K 和 task 的 proof 会打开
// artifact;Artifacts sidebar 会就地显示一个(mods/artifacts)。图片
// 查看器外壳:mods/chat-image 的工具栏(props.artifact,其 artifact-bar.js)位于
// artifact 自身的 mod,衬在主题色 backdrop 上。从 chat(其卡片,或在其上的 Ctrl+K)
// 当前显示的 chat pane)则只覆盖该 chat pane,与打开的图片完全一致;没有
// 要覆盖的 pane,则整个窗口。从对话框(Accept 卡片的 Proof)打开时以 modal 形式
// 以合适尺寸的 modal 覆盖该对话框(artifact.modal),关闭后返回原对话框。
// 共享文件:源为 lib/artview.js;bin/sync-shared 会把它复制到 lib/COPIES 里的每个 mod。
// 请编辑 lib/artview.js,不要改 mod 里的副本,然后运行 bin/sync-shared。

import { exec, appHome, openOverlay, theme, shared, setShared, panes, focused, settings } from "herdr";
import { toast, plainError } from "./ui.js";

const CLI = () => `${appHome()}/mods/artifacts/bin/herdr-artifact.cmd`;

// artifact 辅助工具(herdr-artifact,--json);失败时抛出其自身的错误信息。
export async function artifactCli(machine, args) {
  const r = await exec(CLI(), [...(machine ? ["--on", machine] : []), ...args, "--json"]);
  let out = null;
  try { out = JSON.parse(r.stdout.trim().split("\n").pop() || "null"); } catch {}
  if (r.code !== 0 || !out || out.error) throw new Error(out?.error || r.stderr?.trim() || "");
  return out;
}

// 最新 version 的 mod 名,可从任一 version 的(art-<id>--v<n>)得出。
export const baseMod = (mod) => String(mod).replace(/--v\d+$/, "");

// 查看器的布局:工具栏位于 artifact 自身 mod 之上,衬在 backdrop 上。
export function viewerLayout(artifact) {
  return {
    type: "column", background: `${theme().background}f2`, children: [
      { type: "block", size: { px: 48 }, content: { mod: "chat-image", props: { artifact } } },
      { type: "column", padding: [8, 24], children: [
        { type: "block", radius: 8, background: "background", border: { width: 1, color: "border" }, content: { mod: artifact.mod } }] }],
  };
}

// modal 的尺寸:至多 900×700,且始终与窗口边缘保持 40 px(视口
// 以当前 zoom 下的像素计;overlay 的尺寸按 zoom 1。
const MODAL = { width: 900, height: 700 };
function modalSize() {
  let v = null;
  try { v = globalThis.window?.viewport_size?.(); } catch {}
  const zoom = Number(settings()?.zoom) || 1;
  const room = (px, max) => (px > 0 ? Math.max(320, Math.min(max, Math.round(px / zoom) - 80)) : max);
  return { width: room(v?.width, MODAL.width), height: room(v?.height, MODAL.height) };
}

// 从对话框打开的 artifact:其上的 modal,工具栏(标题、version、X)位于
// artifact 自身的 mod,在其内部滚动。Esc、X 或点击旁边关闭,返回
// 回到原对话框。
function showModal(artifact) {
  openOverlay({ kind: "dialog", ...modalSize(), layout: {
    type: "column", background: "popover", divider: { width: 1, color: "border" }, children: [
      { type: "block", size: { px: 48 }, content: { mod: "chat-image", props: { artifact } } },
      { type: "block", background: "background", content: { mod: artifact.mod } }] } });
}

// 显示本 app 已含其 mod 的 artifact:覆盖 artifact.area({ x, y, width, height }
// 窗口中:chat pane,如同图片查看器打开时)若有,否则整个窗口;
// artifact.modal 时为 modal。area 和 modal 保留在工具栏的 props 中,因此在版本间切换
// 版本会使其在原处重新打开。
export function showViewer(artifact) {
  if (artifact.modal) return showModal(artifact);
  const a = artifact.area;
  const at = a ? { x: Math.round(a.x), y: Math.round(a.y) } : { x: 0, y: 0 };
  const size = a ? { width: Math.round(a.width), height: Math.round(a.height) } : { width: 1, height: 1 };
  openOverlay({ kind: "popup", frame: "none", ...size, at, layout: viewerLayout(artifact) });
}

// 打开一个 { id, title, version, latest?, machine, modal? }:优先用本 app 已有的其 mod(从
// 自其机器),若该 version 比最新还旧则用它。area:要覆盖的 chat pane
// (null:整个窗口);modal:改用合适的 modal(来自对话框);show:由什么触发显示
// 首次拉取后(默认为查看器)。
export function openViewer(a, area = null, show = showViewer) {
  const machine = a.machine ?? null;
  const older = a.latest && a.version && a.version < a.latest;
  return artifactCli(null, ["pull", a.id, ...(machine ? ["--from", machine] : []), ...(older ? ["--version", String(a.version)] : [])])
    .then((out) => show({ mod: out.mod, base: baseMod(out.mod), id: a.id, title: a.title, version: a.version, latest: a.latest ?? a.version, machine, ...(area ? { area } : {}), ...(a.modal ? { modal: true } : {}) }))
    .catch((e) => { toast({ title: "工件没有打开", body: plainError(e), level: "error" }); });
}

// 每个 chat 在窗口中的位置,以及是否持有键盘(共享 “chat.areas”:{ [key]:
// { area: { x, y, width, height } | null, focus, at } };key:其 pane,task 的为 “thread”
// Tasks panel 内的 chat),因此 Ctrl+K 会在其被按下的 chat 之上打开 artifact,如同
// 卡片那样。chat 通过指针记录其区域(在其上移动或按下,事件的
// 边界),仅在其变化时,resize 时遗忘(null)直至指针回来;它
// 记录其输入框获得或失去键盘(focus,at:时间)。
const AREAS = "chat.areas";
const KEYS = ["x", "y", "width", "height"];
const same = (a, b) => (a && b ? KEYS.every((k) => Math.abs(a[k] - b[k]) < 1) : a === b);

export function noteChatArea(key, patch) {
  const all = shared(AREAS) ?? {}, was = all[key] ?? {};
  if (!key) return;
  const live = panes().filter((p) => p.mod === "chat").map((p) => p.pane);
  if (key !== "thread" && !live.includes(key)) return;
  const now = { area: was.area ?? null, focus: was.focus ?? false, at: was.at ?? 0, ...patch };
  if (now.area) now.area = Object.fromEntries(KEYS.map((k) => [k, Math.round(now.area[k])]));
  if (same(now.area ?? null, was.area ?? null) && now.focus === (was.focus ?? false) && now.at === (was.at ?? 0)) return;
  const next = Object.fromEntries(Object.entries(all).filter(([k]) => k === "thread" || live.includes(k)));
  next[key] = now;
  setShared(AREAS, next);
}

// 从 Ctrl+K 打开 artifact 所覆盖的 chat(在 `since` 时打开):聚焦的 pane,当它是
// chat(仅放大 pane,若有的话),或 Tasks panel 中该 task 的 chat,当
// 键盘当时在它那里(它的输入框在 Ctrl+K 打开时释放了键盘,晚于 pane 的释放)。null
// 键盘不在任何 chat 中,或其位置尚不知时。
export function chatArea(since = Date.now()) {
  const all = shared(AREAS) ?? {}, f = focused();
  const tab = panes().filter((p) => p.tab === f?.tab);
  const shown = tab.some((p) => p.zoomed) ? tab.filter((p) => p.zoomed) : tab;
  const pane = shown.some((p) => p.pane === f?.pane && p.mod === "chat") ? all[f.pane] : null;
  const th = all.thread;
  const thread = th && (th.focus || th.at >= since - 1500) ? th : null;
  const pick = [pane, thread].filter((x) => x?.area).sort((a, b) => (b.focus - a.focus) || (b.at - a.at))[0];
  return pick?.area ?? null;
}
