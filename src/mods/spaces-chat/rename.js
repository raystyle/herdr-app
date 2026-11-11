// Rename,作用于 space、section 或 machine(其 emoji 与 sidebar 显示的名字),以及 New section:一个小 dialog,画成 New space 的样式
// (mods/newspace:自有 panel,frame "none",居中)。其图标按钮位于名称输入框左侧:点击打开
// emoji 选择器(icon.js),其选择经 shared "spaces-chat.iconpick" 返回,并
// 在保存前显示于此。名称字段初始聚焦且文本全选。
// Enter 保存,Esc 取消。space 名经 space.rename(空串则用 Herdr 自己的名字
// 返回);分区名在其机器上须不重名。New section 会新建一个
// 排在其机器末尾,并带所选图标(未选:用文件夹图标)。
// 以 dialog 打开:props { view: "rename", space }、{ view: "rename", section } 或
// { view: "rename", new: "section", machine } 或 { view: "rename", renameMachine: true, machine }。
// space 的 `name`:sidebar 为它显示的名字(main.js 的 nameOf),也是其输入框的 placeholder。

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, run, shared } from "herdr";
import { spaces } from "./live.js";
import { data, iconOf, setIcon, setSectionIcon, renameSection, addSection, nameFree, machineLook, setMachineLook } from "./sections.js";
import { logSpace } from "./spacelog.js";
import { dialogFooter, TEXT, RADIUS, H } from "./ui.js";

// 与 New space 的相同(tabs-tasks/coordinator.js 的 NEWSPACE):应用唯一的 dialog footer(ui.js),高 32。
const K = { pad: 18, title: 20, label: 16, gap: 4, field: H.lg, buttons: H.lg, section: 16 };
export const RENAME = { width: 380, height: K.pad * 2 + K.title + K.section + K.label + K.gap + K.field + K.section + K.buttons };
export const PICK = "spaces-chat.iconpick";

// 元素在窗口中的位置,取自对它的点击。
export const rectOf = (e) => ({ x: e.position.x - (e.local_position?.x ?? 0), y: e.position.y - (e.local_position?.y ?? 0),
  width: e.bounds?.width ?? 0, height: e.bounds?.height ?? 0 });

export function openRename(of) {
  openOverlay({ mod: "spaces-chat", kind: "dialog", frame: "none", width: RENAME.width, height: RENAME.height, props: { view: "rename", ...of } });
}

// New section,在 `machine` 上(null 为本机):同一个 dialog,内容为空。
export const openNewSection = (machine) => openRename({ new: "section", machine: machine ?? null });

// 机器(null:本机):侧边栏显示的名称,及其 emoji。
export const openRenameMachine = (machine) => openRename({ renameMachine: true, machine: machine ?? null });

export class Rename {
  init(cx) {
    const p = props() ?? {};
    this.p = p;
    this.isSection = Boolean(p.section || p.new === "section");
    this.isMachine = Boolean(p.renameMachine);
    const look = this.isMachine ? machineLook(p.machine) : null;
    this.sec = p.section ? data().sections.find((s) => s.id === p.section) ?? null : null;
    const w = p.space ? spaces().find((s) => s.id === p.space) : null;
    this.icon = look ? look.icon : this.sec ? this.sec.icon ?? null : iconOf(p.space);
    this.picked = shared(PICK)?.at ?? 0;
    this.error = "";
    // 无人命名的 space 以 Herdr 的名字作 placeholder:保存为空即保持该名。
    // 机器也一样:其自身名称(hc 的,或 "This computer")。
    // 名为 "~" 的 space(我们的 New space 曾这样命名 home 类 space)视为未命名。
    const value = look ? (look.named ? look.name : "") : this.sec ? this.sec.name : w?.named && w.name !== "~" ? w.name : "";
    const placeholder = this.isMachine ? p.machine ?? "本机" : this.isSection ? "分区名" : p.name ?? w?.name ?? "空间名";
    this.input = InputState.new({ placeholder, value });
    this.input.on("submit", (_e, cx) => { this.save(); cx.notify(); });
    this.input.on("change", (_e, cx) => { if (this.error) { this.error = ""; cx.notify(); } });
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    const focus = () => { this.input.focus(); this.input.set_selected_range({ start: 0, end: value.length }); };
    // 打开它的菜单释放键盘后再来一次(与 New space 的做法一致)。
    focus();
    cx.timer.after(120, focus);
    cx.timer.after(300, () => { if (!this.focused) focus(); });
  }

  close() { this.input.release(); }

  cancel() { closeOverlay(this.p.overlay); }

  save() {
    const name = this.input.value().trim();
    if (this.p.new === "section") {
      const machine = this.p.machine ?? null;
      if (!name) { this.error = "分区需要名字。"; return; }
      if (!nameFree(machine, name)) { this.error = "这里的另一个分区叫这个名字。"; return; }
      const id = addSection(machine, name);
      if (this.icon) setSectionIcon(id, this.icon);
    } else if (this.isMachine) {
      setMachineLook(this.p.machine ?? null, name, this.icon);
    } else if (this.p.section) {
      if (!this.sec) return this.cancel();
      if (!name) { this.error = "分区需要名字。"; return; }
      if (!nameFree(this.sec.machine, name, this.sec.id)) { this.error = "这里的另一个分区叫这个名字。"; return; }
      if (name !== this.sec.name) renameSection(this.sec.id, name);
      setSectionIcon(this.sec.id, this.icon);
    } else {
      const w = spaces().find((s) => s.id === this.p.space);
      if (w && name !== (w.named && w.name !== "~" ? w.name : "") || w?.name === "~" && !name) {
        logSpace("rename", w.id, "spaces-chat: Rename dialog", { to: name });
        run("space.rename", { id: w.id, name });
      }
      setIcon(this.p.space, this.icon);
    }
    this.cancel();
  }

  // picker 位于图标按钮下方;其选择仅对本对话框生效。
  pick(at) {
    openOverlay({ mod: "spaces-chat", kind: "popup", width: 360, height: 420, at: at ? { x: at.x, y: at.y + at.height + 4 } : "pointer",
      props: { view: "icon", for: this.p.overlay, current: this.icon, section: this.isSection,
        machine: this.isMachine ? (this.p.machine ? "server" : "monitor") : null, width: 360, height: 420 } });
  }

  render(cx) {
    const t = theme();
    const rq = shared(PICK);
    if (rq?.for === this.p.overlay && rq.at > this.picked) {
      this.picked = rq.at;
      this.icon = rq.emoji ?? null;
      cx.timer.after(0, () => this.input.focus());
    }
    // 它在侧栏中的标识:emoji,否则 "#"(space)、文件夹(section)或
    // server / monitor(即一台 machine)。
    const mark = this.icon
      ? div().text_size(16).child(this.icon)
      : this.isMachine
        ? svg(`mods/workspace-chrome/${this.p.machine ? "server" : "monitor"}.svg`).size(14).text_color(t.muted)
      : this.isSection
        ? svg("mods/workspace-chrome/folder.svg").size(14).text_color(t.muted)
        : div().text_size(16).text_color(t.muted).child("#");
    const panel = v_flex().id("rename").w_full().flex_none().p(K.pad).rounded(10).border(1).border_color(t.border).bg(t.popover).shadow_lg().text_size(TEXT.body)
      .on_key_down((e) => { if (e.key === "escape") this.cancel(); })
      .child(div().h(K.title).flex_none().text_size(TEXT.title).font_semibold().text_color(t.foreground).child(this.p.new ? "新建分区" : this.isMachine ? "重命名机器" : this.p.section ? "重命名分区" : "重命名空间"))
      .child(div().h(K.section).flex_none())
      .child(div().h(K.label).flex_none().text_size(TEXT.label).text_color(t.dim).child("图标和名字"))
      .child(div().h(K.gap).flex_none())
      .child(h_flex().h(K.field).flex_none().gap(8).items_center()
        .child(h_flex().id("icon").size(K.field).flex_none().justify_center().items_center().rounded(RADIUS.control).border(1).border_color(t.input).bg(t.background)
          .cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (e) => { this.at = rectOf(e); })
          .on_click(() => this.pick(this.at))
          .child(mark))
        .child(Input.new(this.input).flex_1().h(K.field).px(10).items_center().rounded(RADIUS.control).border(1)
          .border_color(this.error ? t.blocked : this.focused ? t.accent : t.input).bg(t.background).text_color(t.foreground)))
      .child(div().h(K.section).flex_none())
      .child(dialogFooter({ onCancel: () => this.cancel(), note: this.error, error: true,
        primary: { id: "save", label: this.p.new ? "创建分区" : "Save", onClick: () => this.save() } }));
    return v_flex().size_full().justify_center().child(panel);
  }
}
