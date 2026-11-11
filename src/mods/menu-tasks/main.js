// 上下文菜单(Herdr 的条目)。以 popup 方式打开,使用
// props { tab: "pane" | "tab" | "space" | "global", target }。
// ↑/↓ 移动,Enter 运行,Esc 关闭。条目为 [label, command, args];
// 而 "worktree" 命令改为打开 worktree 对话框。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, exec, knownAgents, window } from "herdr";
import { terminals, spaces, panes, inRender } from "./live.js";
import { TEXT, menuRow } from "./ui.js";
import { tabMenu, appMenu } from "./core/menus.js";
import { rectOf, besideRow, agentIn, coordinatorIn, isCoordinator, isCoordinatorTab, entryFor, restartAgent, closeTab, taskOf, switchTask, renameTab, renameSpace, closeSpace } from "./coordinator.js";

// space 当前位置:其首个终端的实时文件夹,否则取创建处。
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// space 的 checkout:"main"(repo 自身)、"linked"(worktree),或 null。
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git, known) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // 被保留的 sub-agent 可以回到其父 agent 之下,且仍在运行。
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // 即便交给程序处理,Shift+右键仍会打开此菜单。
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      return [
        ["向右分屏", "pane.split", { direction: "right", pane: tg.pane }],
        ["向下分屏", "pane.split", { direction: "down", pane: tg.pane }],
        ["Zoom", "pane.zoom", { pane: tg.pane }],
        ...(term
          ? [
              toProgram
                ? ["使用 Herdr 右键菜单", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["右键发送到窗格", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ["关闭窗格", "pane.close", { pane: tg.pane }],
      ];
    }
    case "tab": {
      // agent tab 可重启或切换到另一个 agent;coordinator 的还能编辑其角色。
      // 重启经本机的 core:仅限本机 agent。
      const agent = agentIn(tg.id)?.address.includes("/") ? null : agentIn(tg.id);
      const coord = coordinatorIn(tg.id);
      // coordinator tab:或已有其 agent,或仍在等待用户的首条消息。
      const coordTab = isCoordinatorTab(tg.id);
      const restartable = agent && (taskOf(agent) || (coord ? !agent.labels?.["herdr.agent"] || entryFor(agent, known ?? []) : entryFor(agent, known ?? [])));
      // 其条目与文字:core/menus.js 的 tabMenu(web app 的 tab 菜单读取同一列表)。
      const does = {
        rename: ["tab.rename", { id: tg.id }],
        instructions: ["coordinator.edit", { tab: tg.id, terminal: coord?.address }],
        switch: ["coordinator.switch", { terminal: agent?.address }],
        restart: ["coordinator.restart", { terminal: agent?.address }],
        close: ["tab.close", { id: tg.id }],
      };
      return tabMenu({ assistant: coordTab, switchable: Boolean(agent && known?.some((a) => a.installed)), restartable: Boolean(restartable) })
        .filter((it) => !it.sep).map((it) => [it.label, ...does[it.id]]);
    }
    case "space":
      return [
        ["Rename\u2026", "space.rename", { id: tg.id }],
        ...(git ? [["新建 worktree", "worktree", { space: tg.id, action: "new" }], ["打开 worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Close\u2026", "space.close", { id: tg.id }],
      ];
    default:
      // 其条目与文字:core/menus.js 的 appMenu(web app 的 tab bar 提供同样的项,但不含主题)。
      return appMenu().filter((it) => !it.sep).map((it) =>
        // 经 tab 栏在当前 space 所在机器上打开 New space 对话框(mods/newspace);我们自己的按键列表
        // (mods/keybinds):普通名称,已分组(Herdr 的帮助页显示原始 id);以及 Herdr 的主题。
        it.id === "new-space" ? [it.label, "tabs-tasks.newspace", {}] : it.id === "keybinds" ? [it.label, "mod.open", { name: "keybinds" }] : [it.label, "app.theme", { name: it.theme }]);
  }
}

function menuIcon(command) {
  const own = { "mod.open": "mods/keybinds/keyboard.svg", "coordinator.edit": "mods/workspace-chrome/file-text.svg", "coordinator.switch": "mods/coordinator/arrow-left-right.svg", "coordinator.restart": "mods/coordinator/rotate-ccw.svg" }[command];
  if (own) return own;
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") || command === "tabs-tasks.newspace" ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// 绑定到命令的按键,用于右侧提示。
function shortcut(name, args) {
  if (name === "coordinator.switch") return "\u203a";
  // 绑定在本 layout 的按键里,用的是 New space 在其他地方所用的键。
  if (name === "tabs-tasks.newspace") return shortcut("space.new");
  // `pane.split:right` 表示以 { direction: "right" } 绑定 pane.split。
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? keyText(k.keys) : "";
}

// keys.json 的 “ctrl-shift-t” 转为人读格式:“Ctrl+Shift+T”(macOS 为 ⌃⇧T),如 new-menu-tasks 所示。
function keyText(keys) {
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return keys.trim().split(/\s+/).map((stroke) => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter((m) => held.has(m)).map((m) => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.known = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    if (p?.tab === "tab")
      cx.spawn(async (cx) => {
        this.known = await knownAgents().catch(() => []);
        cx.notify();
      });
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git, this.known)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1].startsWith("coordinator.") || it[1] === "tab.close") this.agentAction(it[1], it[2]);
    // 用我们的 dialog(应用唯一的 footer),而非 Herdr 的 prompt 和 confirm。
    else if (it[1] === "tab.rename") renameTab(spaces().flatMap((s) => s.tabs).find((x) => x.id === it[2].id));
    else if (it[1] === "space.rename") renameSpace(it[2].id);
    else if (it[1] === "space.close") closeSpace(it[2].id);
    else if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  agentAction(command, args) {
    const k = terminals().find((x) => x.address === args.terminal);
    if (command === "tab.close") closeTab(args.id);
    else if (command === "coordinator.edit") {
      // 位于 coordinator 旁:已有 instructions pane 就用它,否则新建一个。
      const open = panes().find((p) => p.tab === args.tab && p.mod === "coordinator");
      // 处于 Chat 模式的 agent,或尚无 agent:位于 tab 的 chat pane 旁边。
      const beside = panes().find((p) => p.terminal && p.terminal === args.terminal) ?? panes().find((p) => p.tab === args.tab && p.mod === "chat");
      if (open) run("pane.focus", { pane: open.pane });
      else run("pane.split", { direction: "right", pane: beside?.pane, mod: "coordinator", props: { view: "instructions" } });
    } else if (command === "coordinator.switch") {
      const n = (this.known ?? []).filter((a) => a.installed).length;
      // 位于 Switch agent 行旁,作为子菜单(点击打开;键盘操作时出现在指针处)。
      openOverlay({ mod: "coordinator", kind: "popup", width: 210, height: Math.min(420, 40 + n * 32),
        at: this.rowAt ? besideRow(this.rowAt, 236, 210, props()?.right) : "pointer", props: { view: "agents", terminal: args.terminal } });
    } else if (command === "coordinator.restart" && k && taskOf(k)) {
      switchTask(k);
    } else if (command === "coordinator.restart" && k) {
      // 从模板启动的 coordinator 会从模板重启(编辑过的指令生效)。
      const entry = k.labels?.["herdr.agent"] || !isCoordinator(k) ? entryFor(k, this.known ?? []) : null;
      restartAgent(k, entry?.run);
    }
  }

  // 整个 render 共用一份 Herdr 实时列表副本(live.js):超过约 50 毫秒 Herdr 会中止它。
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const t = theme();
    const list = items(props(), this.git, this.known);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(TEXT.body)
      .on_key_down((e, cx) => {
        this.rowAt = null; // 用按键选择时:没有被点击的行可在其旁展开子菜单
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[0] === "Keybinds" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(8).my(4).h(1).bg(t.border)))
            // lib/ui.js 的 32 高菜单行;键盘所在行同样选中。
            .child(menuRow(`mi-${i}`, it[0], { icon: menuIcon(it[1]), hint: shortcut(it[1], it[2]), onClick: (_e, cx) => this.choose(i, cx) })
              .on_mouse_down("left", (e) => { this.rowAt = rectOf(e); })
              .when(i === this.at, (el) => el.bg(t.selected))),
        ),
      );
  }
}
