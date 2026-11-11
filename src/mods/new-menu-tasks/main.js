import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, knownAgents, run, openOverlay, closeOverlay, props, window, keys } from "herdr";
import { spaces, panes, inRender } from "./live.js";
import { coordinatorTab, requestCoordinator } from "./coordinator.js";
import { H, TEXT, RADIUS } from "./ui.js";
// 行的文案、Assistant 行与可选 agents:core/menus.js(web 端的 + 菜单读同一份)。
import { NEW_MENU, assistantRow, agentChoices, agentHint } from "./core/menus.js";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    this.agents = [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try { this.agents = await knownAgents({ on: spaces().find(s => s.active)?.machine }); }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    // lib/ui.js 的菜单行尺寸(32,16 图标位);图标可能是图片,故在此绘制。
    return h_flex().id(id).h(H.lg).px(8).gap(8).rounded(RADIUS.control).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(div().size(16).flex_none().flex().items_center().justify_center().child(icon))
      .child(div().flex_1().min_w(0).truncate().child(name)).child(div().flex_none().text_size(TEXT.label).text_color(t.dim).child(hint));
  }
  // 整个 render 共用一份 Herdr 实时列表副本(live.js):超过约 50 毫秒 Herdr 会中止它。
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = agentChoices(this.agents);
    // 每个 space 一个 coordinator:一旦有了,行就归它。在另一台 machine 上则在那边运行。
    const coordTab = coordinatorTab(space);
    const coordinate = () => coordTab ? run("tab.select", { id: coordTab.id }) : requestCoordinator(space);
    const canCoordinate = Boolean(coordTab || space);
    const aRow = assistantRow({ open: Boolean(coordTab) });
    return v_flex().min_h(0).w_full().h(209 + Math.min(10, Math.max(1, choices.length)) * H.lg).bg(t.popover).p(5).text_size(TEXT.body)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        // 精简:无 Assistant 快捷方式
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), NEW_MENU.terminal, () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().h(28).flex_none().px(8).flex().items_center().text_size(TEXT.label).font_medium().text_color(t.dim).child(NEW_MENU.agents))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), agentHint(a, i), a.installed)))
        .when(this.agents.length === 0, el => el.child(div().px(8).py(6).text_color(t.dim).child(this.failed ? NEW_MENU.failed : NEW_MENU.loading))))
      .child(div().h(1).mx(8).my(5).bg(t.border))
      .child(this.row("space", svg("mods/workspace-chrome/plus.svg").size(14), NEW_MENU.space, () => run("tabs-tasks.newspace"), shortcut("tabs-tasks.newspace") || shortcut("space.new")));
  }
}
