// pane 的 header,供给 pane 加边框的 layout 使用:
// { "tab": "active", "pane": { "header": { "content": { "mod": "pane-chat" } } } }
// 显示程序的图标(应用的程序表)、agent 的名字,或
// terminal 标题、文件夹与 agent 状态;按钮为 split、zoom、close
// 本 pane。应用传入的 props:{ pane, terminal }。点击:聚焦该 pane。
//
// Agent pane(Claude Code、Codex)也有 Chat / Terminal 开关。Chat 会把 `chat`
// mod 正好落在 agent pane 的位置:先在 agent pane 旁分屏,随后 agent 的
// terminal 被驻留(继续运行,但不占 pane),聊天因此占据整个槽位,且
// 其余 pane 一律保持原样。Terminal 则相反:终端获得 pane
// 回到聊天旁边,聊天随之关闭。停靠会关掉 core keep;聊天再把它
// 再恢复。每次交换的最后一步是移除本 header 所在的 pane,因此它排在最后。
// 哪个聊天对应哪个 agent,由 agent 的 core 标签 herdr.chat=<chat pane> 决定:每一屏
// 可见,agents 列表、tab 栏、spaces 与状态栏都会读取(chat/parked.js)。

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, theme, home, exec, hc, notify, nextCommand, shared, setShared } from "herdr";
import { panes, terminals, spaces, inRender } from "./live.js";
import { spaceName, chatPane, chatLabel } from "./core/spaces.js";
import { apSpace, apWatch, apPoll, apGroup, apHeartbeatLink, COMPACT_BELOW } from "./autopilot.js";
import { button as uiButton, segmented, TEXT, RADIUS, toast, plainError } from "./ui.js";
import { on as addonOn } from "./addons.js";
// "End Claude Code?" 及其按钮:core/menus.js(web app 的 header 用相同措辞询问)。
import { endAgent } from "./core/menus.js";

const CHAT = "chat";
const LABEL = "herdr.chat";
// toggle 上次交换 pane 的时刻(此构建的每个副本共享)。
let lastSwap = 0;

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// 聊天读取 Claude Code 和 Codex 各自的 session log;其他 agent 没有聊天。
const chatty = (p) => Boolean(p?.terminal) && (["claude-code", "codex"].includes(p.app) || ["claude", "codex"].includes(p.program?.key));

const chatPanes = () => new Set(panes().filter((p) => p.mod === CHAT).map((p) => p.pane));
// 显示该 terminal 的 chat pane,若已打开。
function chatOf(terminal) {
  const c = chatPane(terminals().find((x) => x.address === terminal));
  return c && chatPanes().has(c) ? c : null;
}
// 还没有 agent 的 Coordinator tab chat(mods/coordinator 将其记录在 shared
// "coordinator.slots"):它也有该开关;Terminal 先启动其 agent(mods/chat)。
const lazySlot = (pane) => Object.values(shared("coordinator.slots") ?? {}).find((r) => r?.pane === pane) ?? null;

// 聊天 pane 所显示的 agent。
const agentOf = (chat) => terminals().find((x) => chatPane(x) === chat && x.state === "live")?.address ?? null;

// 一条 app 命令,等待其完成(切换步骤必须按序执行)。
async function app(name, args) {
  const r = await exec("herdr-app", ["do", name, ...Object.entries(args).flatMap(([k, v]) => [`--${k}`, typeof v === "string" ? v : JSON.stringify(v)])]);
  let out = {};
  try { out = JSON.parse(r.stdout || "{}"); } catch {}
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr.trim() || `${name} failed`);
  return out;
}

// 驻留的 agent,显示在 chat pane 中:header 为其展示的内容。
function parked(terminal) {
  const k = terminals().find((x) => x.address === terminal);
  if (!k) return null;
  const st = ["working", "blocked", "done", "idle"].includes(k.status) ? k.status : null;
  return { program: k.program, status: st, cwd: k.foreground?.cwd ?? k.cwd ?? null, title: k.title ?? "" };
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    // Assistant 的 header:其 Autopilot 状态,会定期重新查看(scheduler 会改动它)。
    cx.timer.every(4000, (cx) => apPoll(this, cx));
    this.opening = false;
    // 刚启动的副本(swap 的新 pane)可能仍会收到触发它的切换指令:
    // 否则会立刻切回。toggle 只作用于至少 2 秒前的副本,每 3 秒至多切换一次。
    this.born = Date.now();
    // "pane-chat.toggle"(一个键,或 `herdr-app do`):切换聚焦的 pane。
    // 每次等待最多 5 秒(最多一个待处理 nextCommand),让 reload 后的旧 build 在下一个
    // 改用 cx,而不是留在内存里。
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        const self = this.me();
        if (c !== "toggle" || !self?.focused) continue;
        if (Date.now() - this.born < 2000 || Date.now() - lastSwap < 3000) continue;
        lastSwap = Date.now();
        if (self.mod === CHAT) { if (agentOf(self.pane)) this.toTerminal(self.pane, cx); }
        else if (chatty(self)) this.toChat(self, cx);
      }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // 24 px 图标按钮(split、zoom、close)。
  button(t, id, icon, command, args, fn = null) {
    return h_flex()
      .id(id)
      .size(24)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(RADIUS.control)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (fn) fn(cx); else run(command, args);
        cx.notify();
      })
      .child(svg(`mods/pane-chat/${icon}.svg`).size(14));
  }

  // Terminal → Chat:聊天占据此 agent pane 的位置。
  toChat(p, cx) {
    const open = chatOf(p.terminal);
    if (open) { run("pane.focus", { pane: open }); return; }
    if (this.busy) return;
    this.busy = true;
    const terminal = p.terminal;
    cx.spawn(async (cx) => {
      try {
        const out = await app("pane.split", { direction: "right", pane: p.pane, mod: CHAT, props: { terminal } });
        if (!out.pane) throw new Error("Herdr 没有打开对话");
        // agent 知道自己的聊天:若该 pane 随其 tab 或 space 一起消失,agents 列表
        // 结束该 agent(parked.js sweep),效果等同关闭其自己的 pane。
        await hc(["label", terminal, `${LABEL}=${chatLabel(out.pane)}`]);
        // 对话换进终端原来的位置,再停驻终端:避免两步换位时中间状态的残影。
        await app("pane.swap", { pane: out.pane, target: p.pane });
        run("pane.focus", { pane: out.pane });
        // 最后:停驻会移除此 pane,连同此 header。聊天转为 core keep
        // 停靠完成后再恢复(mods/chat)。
        await app("terminal.park", { terminal });
      } catch (e) {
        toast({ title: "对话没有打开", body: plainError(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // Chat → Terminal:agent 的 terminal 在聊天旁获得 pane,然后聊天关闭,
  // 使 terminal 回到原位。
  toTerminal(chat, cx) {
    const terminal = agentOf(chat);
    const live = Boolean(terminal);
    // 未在运行,或仍占着自己的 pane(聊天开在其旁):直接关掉聊天即可。
    const own = live && panes().find((x) => x.terminal === terminal);
    if (!live || own) {
      const zoomed = panes().find((x) => x.pane === chat)?.zoomed;
      run("pane.close", { pane: chat });
      if (terminal) hc(["label", terminal, `${LABEL}=`]);
      if (own) { if (zoomed && own.zoomed) run("pane.zoom", { pane: own.pane }); run("pane.focus", { pane: own.pane }); }
      return;
    }
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await app("pane.focus", { pane: chat });
        const out = await app("terminal.keep", { terminal, place: "right" });
        await hc(["label", terminal, `${LABEL}=`]);
        // 终端换进聊天原来的位置,再关聊天:换位一步到位,无中间残影。
        if (out.pane) await app("pane.swap", { pane: out.pane, target: chat });
        if (out.pane) run("pane.focus", { pane: out.pane });
        // 最后:关闭聊天时此 header 一并移除。
        await app("pane.close", { pane: chat });
      } catch (e) {
        toast({ title: "终端没有回来", body: plainError(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // chat pane 的 ✕ 与 agent pane 的一样:结束 agent,pane 随之消失。它会询问
  // 优先,直接在 header 上("End Claude Code?" End agent / Cancel):this.ending。
  closeChat(chat) {
    this.ending = false;
    const terminal = agentOf(chat);
    if (terminal) run("terminal.kill", { terminal });
    run("pane.close", { pane: chat });
  }

  // Chat | Terminal:共用的分段开关(ui.js 的 segmented),与 task 视图 header 的相同。
  switcher(t, id, chatMode, onChat, onTerminal) {
    return segmented(id, [["chat", "对话"], ["terminal", "终端"]], chatMode ? "chat" : "terminal",
      (v, _e, cx) => (v === "chat" ? onChat(cx) : onTerminal(cx)));
  }

  // 整个 render 共用一份 Herdr 实时列表副本(live.js):超过约 50 毫秒 Herdr 会中止它。
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const t = theme();
    const self = this.me();
    if (!self) return div();
    // chat pane 使用其 agent 的 header:同名、同文件夹、同状态。
    const chatMode = self.mod === CHAT;
    const agent = chatMode ? agentOf(self.pane) : null;
    const entry = agent ? { terminal: agent } : null;
    const p = (entry && parked(entry.terminal)) ?? self;
    const lazy = chatMode && !entry && lazySlot(self.pane);
    // artifact(mods/artifacts:mod "art-<id>")显示其标题和版本。
    const art = self.mod?.startsWith("art-") ? shared("artifacts.titles")?.[self.mod] ?? self.title : null;
    const prog = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "Shell";
 // Assistant 以其 space 呈现("tor-gameboy"),绝不显示其角色或运行内容(composer 的 model
    // 菜单标明是哪个 agent):先 space 名称,再其文件夹,样式更淡。
    const isAssistant = Boolean(lazy) || terminals().find((x) => x.address === (agent ?? self.terminal))?.labels?.["herdr.role"] === "coordinator";
    const space = isAssistant ? spaces().find((s) => s.tabs?.some((x) => x.id === self.tab)) : null;
    const name = art ?? (isAssistant ? spaceName(space, { home: home() }) : chatMode && p === self ? "Chat" : prog);
    const pic = art !== null ? svg("mods/artifacts/artifacts.svg").size(14).flex_none().text_color(t.dim) : icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = self.pane;
    const canSwitch = chatMode ? Boolean(entry) || Boolean(lazy) : chatty(self);
    // Assistant(聊天或 terminal):其 Autopilot 开关在右侧,位于 hover 按钮之前(无按钮时…
    // Autopilot add-on 关闭时)。
    const apFor = null;
    apWatch(this, apFor, cx);
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(TEXT.label)
      .on_hover((hovered, cx) => { this.hovered = hovered; if (!hovered) this.ending = false; cx.notify(); })
      .on_size_change((size, cx) => { if (Math.round(size.width) !== this.width) { this.width = Math.round(size.width); cx.notify(); } })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().max_w(260).min_w(0).truncate().font_medium().text_color(t.foreground).child(name))
      // 文件夹名先被压缩;开关保持自身宽度;其后的间隔把其余内容推向右侧。
      .child(div().flex_shrink_1().min_w(0).truncate().text_color(t.dim).child(folder(p.cwd)))
      .child(div().flex_1())
      // 文字状态,与控件右对齐:"Working…" 带其 spinner、"Needs you",结束时无字
      // 其余(已完成是常态,不加标记)。
      .when(st === "working", el => el.child(h_flex().flex_none().gap(6).items_center().text_color(t.muted)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .when((this.width ?? Infinity) >= COMPACT_BELOW, el => el.child(div().whitespace_nowrap().child("进行中…")))))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(RADIUS.control).bg(t.blocked + "26").text_size(TEXT.id).font_semibold().text_color(t.blocked).child("Needs you")))
      // Autopilot 与其他控件一起放在右侧,而不是夹在栏中间、folder 之后。
      // "Write a heartbeat" 链接置于其前,这样开关之后的内容不会随之出现又消失。
      .when(Boolean(apFor), (el) => el.child(apHeartbeatLink(this, apFor, pane) ?? div())
        .child(apGroup(this, t, apFor, pane, (this.width ?? Infinity) < COMPACT_BELOW)))
      // 结束聊天中的 agent 前先询问,替代 hover 按钮的位置。
      .when(Boolean(entry) && this.ending === true, el => el
        .child(div().flex_none().whitespace_nowrap().text_color(t.foreground).child(endAgent(prog).ask))
        .child(uiButton(`ph-end-no-${pane}`, endAgent(prog).cancel, { kind: "plain", onClick: () => { this.ending = false; } }))
        .child(uiButton(`ph-end-${pane}`, endAgent(prog).verb, { kind: "primary", onClick: () => this.closeChat(pane) })))
      // hover 按钮放在开关之前,让 Chat | Terminal 位置恒定。
      .when(this.hovered && !(entry && this.ending === true), el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, self.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .when(!entry, el => el.child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })))
        .when(Boolean(entry), el => el.child(this.button(t, `ph-x-${pane}`, "close", null, null, () => { this.ending = true; }))))
      .when(canSwitch, (el) => el.child(this.switcher(t, `ph-mode-${pane}`, chatMode,
        (cx) => this.toChat(self, cx),
        // 尚无 agent:聊天先启动它(无首条消息),再显示其 terminal。
        (cx) => (lazy && !agentOf(pane) ? setShared("chat.startreq", { pane, at: Date.now() }) : this.toTerminal(pane, cx)))));
  }
}
