// 侧栏自己的弹出菜单,与 Herdr 的画法一致(mods/menu):机器标题的 + 与
// 右键菜单、space 的右键菜单(也含 Pin / Unpin)以及分区 header 的。每处都是将本 mod 作为 popup 打开,附
// props { view, ... }。Rename 打开重命名对话框(rename.js),图标也在此更改;
// New section 打开空表单,同 New section。
// spaces 只能靠拖拽在 section 间移动。↑/↓ 移动,Enter 执行,Esc 关闭。行为
// 应用的菜单行(ui.js menuRow,高 32);会打开对话框的标签以 "…" 结尾。

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, setShared } from "herdr";
import { spaces } from "./live.js";
import { deleteSection, data } from "./sections.js";
import { withMachineOrder } from "./core/spaces.js";
import { assistantOf, markRead } from "./unread.js";
import { NOTIFY, notifyOf, setNotify } from "./notify.js";
import { openRename, openNewSection, openRenameMachine } from "./rename.js";
import { logSpace } from "./spacelog.js";
import { menuRow, segmented, TEXT } from "./ui.js";
import { addMenu, spaceMenu, machineMenu, sectionMenu } from "./core/menus.js";

const ROW = 32, PAD = 5, SEP = 9, W = 210;
// Notify 设置(space 菜单):一行带标签的设置,其下是一行小字说明。含此项的菜单
// 更宽,“Notify” 及其三个选项完整放下(绝不截断)。
const SETTING = 32, NOTE = 20, W_SETTING = 270;
// 每行共用的列(ui.js 的 menuRow):16 图标位于行内边距处,文字排在图标 + 间距之后。
const ROW_X = 8, ICON = 16, ICON_GAP = 8, TEXT_X = ROW_X + ICON + ICON_GAP;
const icon = (name) => (name.includes("/") ? name : `mods/workspace-chrome/${name}.svg`);

// 关闭 space:用我们的 confirm(mods/confirm-chat),按钮显示动词;然后执行 Herdr 的关闭(需确认)。
function closeSpace(id, name) {
  const w = spaces().find((s) => s.id === id);
  openOverlay({ mod: "confirm-chat", kind: "dialog", width: 400, height: 168, props: {
    title: `Close “${name ?? w?.name ?? "此空间"}”?`,
    detail: "它的标签页会关闭,其中所有程序都会结束。",
    verb: "关闭空间",
    command: { name: "space.close", args: { id, confirmed: true } } } });
  logSpace("close", id, "spaces-chat: space menu Close (asks in confirm-chat)");
}

export { rectOf } from "./rename.js";

// New space,在 `machine` 上(null 为本机):指向该处的 New space dialog(mods/newspace)。
// 由 tab 栏(tabs-tasks)打开:它知道该给多高的高度。
export function newSpace(machine) {
  setShared("newspace.on", { machine: machine ?? null, at: Date.now() });
  run("tabs-tasks.newspace-on");
}

// popup 为其内容设定的高度:行、分隔线和内边距。
const heightOf = (items) => items.reduce((h, it) => h + (it.sep ? SEP : it.notify ? SETTING + NOTE : ROW), PAD * 2);

export function openMenu(view, p, at = "pointer") {
  const items = ITEMS[view](p);
  const width = items.some((it) => it.notify) ? W_SETTING : W;
  openOverlay({ mod: "spaces-chat", kind: "popup", width, height: heightOf(items), at, props: { view, ...p } });
}

// 每个菜单的条目:{ label, icon, hint, act },或 { sep: true }:core/menus.js 的列表(web app 构建其菜单)
// 来自同一批),每一项都在这里完成。
const MENU_ICON = { "check-check": "mods/spaces-chat/check-check.svg", "arrow-up": "mods/spaces-chat/arrow-up.svg", "arrow-down": "mods/spaces-chat/arrow-down.svg", "trash-2": "mods/spaces-chat/trash-2.svg", network: "mods/coordinator/network.svg" };
const built = (list, acts) => list.map((it) => (it.sep ? it : it.setting ? { ...acts[it.id], note: it.note } : { label: it.label, icon: MENU_ICON[it.icon] ?? it.icon, act: acts[it.id] }));
const ITEMS = {
  // 机器标题的 +。
  add: (p) => built(addMenu(), { "new-space": () => newSpace(p.machine), "new-section": () => openNewSection(p.machine) }),
  space: (p) => built(spaceMenu({ unread: p.unread }), {
    // 启动 agent:打开 + 菜单(已安装的 agent 列表,选一个开新标签页)。
    agent: () => run("mod.open", { name: "new-menu-tasks" }),
    // 新建终端:在该 space 开一个终端标签页。
    terminal: () => run("tab.new", { space: p.space }),
    read: () => markRead(assistantOf({ id: p.space, machine: p.machine })),
    rename: () => openRename({ space: p.space, name: p.name }),
    close: () => closeSpace(p.space, p.name),
  }),
  // 机器 header 的右键:其名称和 emoji(rename.js),以及它在机器中的排序(p.order:按其
  // 生效;shared "spaces-chat".machineOrder,对应 web 应用的 Move up / Move down)。
  machine: (p) => {
    const order = Array.isArray(p.order) ? p.order : [], i = order.indexOf(p.machine ?? null);
    const step = (by) => {
      const next = order.filter((k) => k !== (p.machine ?? null));
      next.splice(i + by, 0, p.machine ?? null);
      setShared("spaces-chat", withMachineOrder(data(), next));
    };
    return built(machineMenu({ first: i <= 0, last: i < 0 || i >= order.length - 1 }), { rename: () => openRenameMachine(p.machine), up: () => step(-1), down: () => step(1) });
  },
  // 删除立即执行;其 toast 提供 Undo(sections.js)。
  section: (p) => built(sectionMenu(), { rename: () => openRename({ section: p.section }), delete: () => deleteSection(p.section) }),
};


// 单一菜单:普通对象,作为 popup 期间由 mod 的 View(main.js)驱动。
export class Menu {
  init(cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const p = props();
    const it = ITEMS[p.view](p).filter((x) => !x.sep && !x.notify)[i];
    if (!it) return;
    closeOverlay(p.overlay);
    it.act();
  }

  render() {
    const t = theme();
    const p = props();
    const all = ITEMS[p.view](p);
    const count = all.filter((x) => !x.sep && !x.notify).length;
    const space = all.find((x) => x.notify)?.notify;
    let n = -1;
    return v_flex().id("menu").track_focus(this.handle).w_full().min_h(0).p(PAD).bg(t.popover).text_size(TEXT.body)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % count;
        else if (e.key === "up") this.at = (this.at + count - 1) % count;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(p.overlay);
        // ←/→ 逐个切换 Notify 的选项。
        else if (space && (e.key === "left" || e.key === "right")) {
          const at = NOTIFY.indexOf(notifyOf(space)) + (e.key === "right" ? 1 : -1);
          if (at >= 0 && at < NOTIFY.length) setNotify(space, NOTIFY[at]);
        }
        else return;
        cx.notify();
      })
      .children(all.map((it, k) => {
        if (it.sep) return div().id(`sep-${k}`).mx(7).my(4).h(1).flex_none().bg(t.border);
        if (it.notify) return notifySetting(it.notify, t, it.note);
        const i = ++n;
        return menuRow(`mi-${i}`, it.label, { icon: it.icon ? icon(it.icon) : null, hint: it.hint, onClick: () => this.choose(i) })
          .when(i === this.at, (el) => el.bg(t.selected));
      }));
  }
}

// Notify:图标列为铃铛(关闭时加斜杠),文字列为 "Notify",以及其
// 右侧的选项(ui.js segmented:各按文字宽度,绝不截断;选中项为柔和
// pill)。其下文字栏内是一条浅色说明。就地选择:菜单保持打开。
// 选回 Everywhere 提供的值即恢复跟随。
function notifySetting(space, t, note) {
  const now = notifyOf(space);
  return v_flex().id("notify").flex_none()
    .child(h_flex().h(SETTING).px(ROW_X).gap(ICON_GAP).items_center().text_size(TEXT.body).text_color(t.foreground)
      .child(svg(`mods/spaces-chat/${now === "Off" ? "bell-off" : "bell"}.svg`).size(ICON).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).child("通知"))
      .child(segmented("notify", NOTIFY.map((v) => [v, v]), now, (v) => setNotify(space, v))))
    .child(h_flex().h(NOTE).pl(TEXT_X).pr(ROW_X).pb(4).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.id).text_color(t.dim).child(note)));
}
