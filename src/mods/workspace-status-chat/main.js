// 状态栏:当前 space 的机器(按侧栏叫法)与分支、红色 Needs-you
// 角标(Tasks 面板的计数,来自 inbox.js),用于有待用户处理时,以及 palette 键。
// 不显示 agent 数量:Tasks panel 已呈现工作。
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, window, keys, shared } from "herdr";
import { spaces, inRender } from "./live.js";
import { count as needsYou } from "./inbox.js";
import { countBadge, TEXT, RADIUS } from "./ui.js";

// 机器在侧边栏中的呈现(mods/spaces-chat sections.js machineLook):其被赋予的名称
// 使用此处给定值,否则用它自己的。
const machineName = (m) => (shared("spaces-chat")?.machines?.[m ?? ""]?.name) || (m ?? "本机");

export default class WorkspaceStatus extends View {
  // 实际绑定的 palette 按键,而非硬编码;没有绑定时
  // 绑定后提示仍然有效("Commands"),不会误导。
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  Commands` : "Commands";
  }

  // 整个 render 共用一份 Herdr 实时列表副本(live.js):超过约 50 毫秒 Herdr 会中止它。
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const needs = needsYou();
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(14)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(TEXT.label).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", machineName(space?.machine ?? null)))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .when(needs > 0, el => el.child(h_flex().gap(6).items_center().child(countBadge(needs, 0, t.chrome)).child("需要你")))
      .child(div().flex_1())
      .child(div().id("palette").px(6).h(20).flex().items_center().rounded(RADIUS.control).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("app.palette")).child(this.hint()));
  }
}
