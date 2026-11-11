import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";
import { red } from "./ui.js";
import { on as addonOn } from "./addons.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// 侧边栏 rail 由宽度决定,而非 flag:拖动其边缘同样会收窄。
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// 收缩到侧栏(macOS 上宽度足够容纳红绿灯),或恢复原有宽度。
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // 在 rail 改为按宽度判断之前编辑的 mod,仍读取该标志。
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/sidebar/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
        // Herdr 自身设置,出厂状态(含其更新圆点),然后是 herdr-winapp 的
        // (mods/herdr-winapp-settings),带 herdr-winapp 的标记,即那个弯钩。
        .child(row("settings", "settings", "设置", () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded_full().bg(t.accent))));
    }
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
 // 语音通话,位于 Search 旁:mods/spaces-chat 发起(shared 的 "voice.startreq");通话中,其
      // Mute 和 End 各在其位
      // 精简:已移除语音按钮
      .when(!collapsed, el => el.child(this.button("search", svg("mods/sidebar/search.svg").size(15), () => run("mod.open", { name: "jump" }))))
      // 在 macOS rail 上红绿灯占满整行;agents 列表的 » 可将其展开。
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/sidebar/sidebar.svg").size(15), toggleSidebar)));
  }
}
