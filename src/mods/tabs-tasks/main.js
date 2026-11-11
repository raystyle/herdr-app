import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, run, openOverlay, theme, window, shared, setShared, layout, settings, nextCommand, readTextFile, appHome, home } from "herdr";
import { spacesWithChats as spaces, sweep } from "./parked.js";
import { agentIn, isCoordinatorTab, closeTab, watchNewSpaces, newSpace, openCoordinator, renameTab, renameSpace } from "./coordinator.js";
import { startInbox, count as inboxCount, countsByTab, readyCount, readyByTab, showInbox, toAlert } from "./inbox.js";
import { watchService } from "./service.js";
import { countBadge, H, TEXT, RADIUS } from "./ui.js";
import { on as addonOn } from "./addons.js";
import { watchViews } from "./usage.js";
// tab 的名字(Herdr 命名时其中运行的内容):core/menus.js,与 web app 的 tab bar 命名一致。
import { tabName } from "./core/menus.js";
import { inRender } from "./live.js";
import { dirsReady } from "./dirs.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    // 停在某个 chat 之后而该 chat 的 tab 或 space 已关闭的 agent 会结束,正如其 pane 那样(
    // 以前由 Agents 列表承担;现在的 layout 已没有它)。
    cx.timer.every(5000, () => sweep());
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // herdr-winapp 的 service,运行期间负责后台工作(lib/service.js)。
    watchService(cx);
    // 用户的置顶、侧栏分区、图标与 Notify,与 web 应用保持同步(lib/bridge.js)。
    // Tasks 的队列与合并 watcher(mods/tasks 所有):运行期间交给 service。
    // 需要用户处理的事项,用于 Tasks 的 "Needs you" 与红色计数(inbox.js)。
    startInbox(cx);
    // 用量洞察(lib/usage.js,insights add-on):显示过的 space 与 tab,以及在各自上的时长。
    watchViews(cx);
    // 已关闭的 add-on(lib/addons.js):~/.config/herdr-winapp/settings.json 中 Everywhere 级的 "off",例如
    // 设置窗口最后保存(或推送)的值,写入 shared state 供各 mod 读取。
    dirsReady().then((d) => readTextFile(d.settings)).then((s) => {
      const list = JSON.parse(s ?? "{}")?.everywhere?.off;
      const want = Array.isArray(list) ? list : [];
      if (JSON.stringify(want) !== JSON.stringify(shared("addons.off") ?? [])) setShared("addons.off", want);
    }).catch(() => {});
    // Ctrl+Shift+W 也走这里,让带存活 worker 的 coordinator 先询问,如其 × 一样。
    // 每次等待最多 5 秒(最多一个待处理 nextCommand),让 reload 后的旧 build 在下一个
    // 改用 cx,而不是留在内存里。
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        const tab = spaces().find(s => s.active)?.tabs.find(t => t.active);
        if (c === "close" && tab) closeTab(tab.id);
        // F2 / Shift+F2(keys.json):为当前显示的 tab 与 space 打开我们的 Rename dialog。
        if (c === "rename-tab" && tab) renameTab(tab);
        if (c === "rename-space") { const sp = spaces().find(s => s.active); if (sp) renameSpace(sp.id); }
        // Ctrl+Shift+N:New space dialog,作用于当前显示 space 的 machine。
        if (c === "newspace") newSpace(spaces().find(s => s.active));
        // Spaces 侧栏中本机的 +:在此打开对话框,无论当前显示哪个 space。
        if (c === "newspace-local") newSpace(null);
        // 机器在 Spaces 侧边栏的 New space:彼处的对话框(shared "newspace.on" =
        // { machine, at },machine 为 null 即本机)。脚本方式:data/newspace-on.json
        // ({ machine })。
        if (c === "newspace-on") {
          let on = shared("newspace.on");
          if (!on || Date.now() - on.at >= 10000) {
            try { on = { ...JSON.parse(await readTextFile(`${appHome()}/data/newspace-on.json`) ?? "null"), at: Date.now() }; } catch { on = null; }
          }
          newSpace(on?.machine ? { machine: on.machine } : null);
        }
        // space 的 coordinator tab 已打开(脚本打开 + 菜单中 Coordinator 的途径):该 space
        // 写入 data/coordinator-openreq.json({ space }),否则用当前显示的。
        if (c === "coordinator") {
          let id = null;
          try { id = JSON.parse(await readTextFile(`${appHome()}/data/coordinator-openreq.json`) ?? "null")?.space ?? null; } catch {}
          const s = spaces().find(s => (id ? s.id === id : s.active));
          if (s) openCoordinator(s, true);
        }
        // toast 的 "需要你":跳到 Tasks panel 的 Active tab。
        if (c === "inbox") showInbox();
        // agent 的提醒(herdr-task alert)被点击:生成 "alert-<terminal>"("/" 写作 "~"),发给该 agent(inbox.js)。
        if (c.startsWith("alert-")) toAlert({ terminal: c.slice(6).replace(/~/g, "/") });
      }
    });
  }

  // 侧面板按 space 记忆:切换时显示该 space 的选择
  // (从未有过则关闭),打开或关闭它都会记录。
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        // Inbox 面板已移除:原先打开它的 space 现在显示 Tasks,条目都在 Tasks 里。
        const stored = this.panels[space.id] === "inbox" ? "tasks" : this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // 在恢复落地(或被其他结果取代)之前,旧状态不作为选项。
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // 整个 render 共用一份 Herdr 实时列表副本(live.js):超过约 50 毫秒 Herdr 会中止它。
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    // 另一台 machine 的 agent 使用 secret:由这里应答(secrets.js,bin/herdr-secret serve)。
    watchNewSpaces(spaces());
    const t = theme();
    const space = spaces().find(p => p.active);
    // coordinator 的 tab 置于最前。
    const shown = [...(space?.tabs ?? [])].sort((a, b) => isCoordinatorTab(b.id) - isCoordinatorTab(a.id));
    // tab 菜单的高度:Rename、Close,以及该 tab 适用的行(menu-tasks):coordinator
    // tab 的 Edit instructions,agent 的 Switch agent 与 Restart。
    const menuHeight = (id) => 19 + 32 * (2 + (isCoordinatorTab(id) ? 1 : 0) + (agentIn(id) && !agentIn(id).address.includes("/") ? 2 : 0));
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(H.sm).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer().text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    // 需要用户处理的事项,按 tab 分(即 Inbox 条目),以及 Tasks 的 Ready:一红一绿
    // tab 上的计数。herdr-winapp settings 的 "Red counts" 关闭(shared "counts.red" false)时:无
    // 此处,也不在 Tasks 上。
    const counts = shared("counts.red") !== false, greens = shared("counts.green") !== false;
    const needs = counts ? countsByTab() : new Map(), readies = greens ? readyByTab() : new Map();
    // 其 "Tab bar" 关闭(shared 的 "tabbar.tabs" 为 false):栏保留 +、各面板和窗口的
    // 按钮(及其后台工作),不含 tab。
    const tabsShown = shared("tabbar.tabs") !== false;
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = tabName(c.name, program?.name);
      return h_flex().id(`tab-${c.id}`).h(H.sm).px(8).gap(6).rounded(RADIUS.control).items_center().flex_none().text_size(TEXT.body)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) renameTab(c); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu-tasks", kind: "popup", width: 236, height: menuHeight(c.id), props: { tab: "tab", target: { id: c.id, space: space.id }, right: this.right } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(needs.get(c.id) > 0 || readies.get(c.id) > 0, el => el.child(countBadge(needs.get(c.id), readies.get(c.id), c.active ? t.raised : t.chrome)))
        .when(!(needs.get(c.id) > 0 || readies.get(c.id) > 0) && (c.status === "blocked" || c.status === "done"), el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).cursor_pointer().text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); closeTab(c.id); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // 旧的已存 rail 和被拖窄的 sidebar 可能比窗口按钮还小。
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    // 提供 Tasks 和 Artifacts(Artifacts 除非其 add-on 关闭),并排于
    // Files 和 Changes 开启时。
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"])];
    this.syncPanel(space, panel, body, enabled);
    // 侧面板按钮,统一样式:先图标;栏宽足够时才显示标签
    // (展开的那个保留其 label);图标后的计数(Tasks 的:需要用户处理的数量,红色,
    // 与 Ready 的事项,绿色:[need, ready])。
    const roomy = (this.width ?? 0) >= 1100;
    const panelButton = (id, label, icon, [need, ready] = [0, 0]) => {
      const badge = need + ready;
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(H.sm).pl(5).pr(roomy || on || badge ? 8 : 5).gap(5).flex_none().items_center().rounded(RADIUS.control)
        .text_size(TEXT.label).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .cursor_pointer().hover(s => s.bg(on ? t.selected : t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14).flex_none())
        .when(roomy || on, el => el.child(label))
        .when(badge > 0, el => el.child(countBadge(need, ready, on ? t.selected : t.chrome)));
    };
    return h_flex().id("tabs-bar").size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .on_mouse_up("left", () => { this.pressed = null; })
      // 该栏延伸到窗口右缘:从它打开的菜单据此排布子菜单。
      .on_mouse_move((e) => { this.right = e.position.x - e.local_position.x + e.bounds.width; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(tabsShown ? shown.map(item) : []))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu-tasks", kind: "popup", width: 250, height: 543, props: { right: this.right } })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-tasks/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-tasks/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-tasks/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
