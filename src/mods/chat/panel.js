// task 在 Tasks panel 内的聊天(由用户决定:深入查看,而非旁路聊天)。
// layout 的 "tasks" 栈包含列表("tasks-list",mod tasks)与本 view
// ("tasks-thread",一列):一个 header("tasks-thread-head",mod chat,props { panel: true,
// head: true }:‹ 返回任务列表、任务本身、其 worker 状态、Accept 与主
// 聊天的 Chat / Terminal 切换器)盖在 worker 聊天的堆叠("tasks-thread-body")上
// ("tasks-thread-chat",mod chat,props { panel: true }:为每条
// worker)及其原始 terminal("tasks-thread-term",一个 layout terminal block)。任务 worker 有
// 没有 pane 或 tab,也不新建:terminal block 原地显示它。
// 哪个 worker:shared "tasks.thread" = { terminal, task, title, at }(openTaskThread())。
// Tasks list 以此方式发送每个任务,并附带 { key: { machine, folder, slug, id } }:
// 已结束任务的最后一个 agent(其聊天从 { log: { path, kind } } 读取,带 Resume),或,绝不
// 未启动(terminal 为 null)则给出 { note } 说明等待原因(mods/tasks 的 target())。
// Ready 任务(worker 说过 ready)在 header 中出现 Accept,与其列表行一致:
// 用户对任务的单一操作(herdr-task accept:有内容可合并时先合并,
// 合并,否则直接完成)。任务记录从其列表文件读取(其 herdr.task 标签)。
// 在聊天与 terminal 之外,body stack 还容纳 task 的 Pull request(mods/task-pr)、其
// Artifacts(mods/task-artifacts)及其 Browser(mods/task-browser:terminal 中的实时查看器
// 独立块),在 header 第二行选择,与 herdr-winapp 的
// 任务侧面板。全部同属一个切换器(同时只显示一个),主聊天 header 的切换
// (ui.js segmented);只有任务有了 PR 才显示 Pull request。它们展示 header
// 发布位置(shared "tasks.thread.where",取自其记录:lib/taskwhere.js)。

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared, setShared, run, theme, exec, appHome, home, readTextFile, writeTextFile, notify, layout, openOverlay } from "herdr";
import { terminals, agents } from "./live.js";
import { taskDot, ownProgress, estimated } from "./dot.js";
import { busyAgain, onIt, readyWait } from "./core/tasks.js";
import { button, segmented, TEXT, RADIUS, toast, plainError } from "./ui.js";
import { on as addonOn } from "./addons.js";
import { artifactCli } from "./artview.js";
import { GREP, publishedIds, taskArtifacts } from "./core/task-artifacts.js";
import { SH } from "./core/paths.js";
import { dirs } from "./dirs.js";

// 任务标题共用的左缘,以及 Tasks 列表等宽字体的任务 id(mods/tasks)。
const EDGE = 12, ID_FONT = "JetBrains Mono";

export const STACK = "tasks", LIST = "tasks-list", THREAD = "tasks-thread";
export const BODY = "tasks-thread-body", CHAT = "tasks-thread-chat", TERM = "tasks-thread-term";
export const PR = "tasks-thread-pr";
export const BROWSER = "tasks-thread-browser";
// 任务的 Artifacts(mods/task-artifacts,):其 agent 与 helper 产出的内容。
export const ARTIFACTS = "tasks-thread-artifacts";
// 其 artifact 在展示期间的重查频率(一次 python 启动加一次日志 grep)。
const ARTS_EVERY = 15000;

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

// 内部显示的聊天,用于其清理:嵌套 view 自己没有 close()。
export const inner = { chat: null };

// "tasks.thread" 所指的任务:取其 agent 的终端,否则取其 key(从未启动的)。
const wantId = (w) => (w ? w.terminal ?? (w.key ? `${w.key.machine ?? ""}:${w.key.slug}#${w.key.id}` : null) : null);

// 当前 layout 是否有 drill-in 视图(否则调用方转向 agent)。
export function hasTaskThread(node) {
  if (!node || typeof node !== "object") return false;
  if (node.id === THREAD) return true;
  return (node.children ?? []).some(hasTaskThread);
}

export function openTaskThread(terminal, task, title) {
  setShared("tasks.thread", { terminal, task: task ?? null, title: title ?? null, at: Date.now() });
  run("layout.select", { stack: "panel-body", child: STACK });
  run("layout.select", { stack: STACK, child: THREAD });
  // task 打开时显示其聊天;header 的开关可切到其 terminal。
  if (find(layout(), BODY)) run("layout.select", { stack: BODY, child: CHAT });
  run("layout.show", { id: "panel" });
}

export const backToTasks = () => run("layout.select", { stack: STACK, child: LIST });

// Chat / Terminal:视图当前显示哪个(body stack 的子项)。
export const terminalShown = () => find(layout(), BODY)?.active === TERM;
export const showWorkerChat = () => run("layout.select", { stack: BODY, child: CHAT });
// 向 header 请求 worker 的 terminal(聊天自带的 "Open terminal",一个 slash 菜单):它
// 持有切换所等待的定时器。shared "tasks.thread.termreq" = { terminal, at }。
export const requestWorkerTerminal = (terminal) => setShared("tasks.thread.termreq", { terminal, at: Date.now() });

// terminal 块显示 worker:对 layout 文件中那一个块的修改(mod
// 无法绘制终端,而 layout 块可不分配 pane 显示任意 core 终端;
// 而非 layout.set,理由见 Artifacts 侧边栏)。仅当文件自上次读取后未被改动
// 已读则不再读;否则重读。随后 Herdr 读取文件(不到一秒):等待该 block。
async function pointTerm(addr, cx) {
  const path = `${appHome()}/layouts/${shared("layout")}.json`;
  for (let i = 0; ; i++) {
    const text = await readTextFile(path);
    const tree = JSON.parse(text ?? "null"), body = find(tree, BODY);
    if (!body) throw new Error("此布局没有任务终端。");
    const node = { id: TERM, type: "block", content: { terminal: addr } };
    const at = body.children.findIndex((c) => c.id === TERM);
    if (at < 0) body.children.push(node); else body.children[at] = node;
    try { await writeTextFile(path, JSON.stringify(tree, null, 2), text); break; }
    catch (e) { if (i >= 2) throw e; }
  }
  for (let i = 0; i < 30 && find(layout(), TERM)?.content?.terminal !== addr; i++) await new Promise((r) => cx.timer.after(100, () => r()));
  if (find(layout(), TERM)?.content?.terminal !== addr) throw new Error("Herdr didn't load the layout with this terminal.");
}

export class PanelHost {
  // 两份副本:头部(head: true)与主体,主体承载嵌套聊天。
  constructor(Chat, head) {
    this.Chat = Chat;
    this.head = head === true;
    this.termReqAt = shared("tasks.thread.termreq")?.at ?? null;
    this.restartReqAt = shared("chat.restartreq")?.at ?? null;
    this.busy = false;     // header 向 terminal 的切换,进行中
    this.cur = null;
    this.entity = null;
    this.swapping = false;
    this.rec = null;       // 当前显示 worker 的任务记录(其列表文件中的条目),或 null
    this.accepting = false;
    this.ticks = 0;
  }

  // worker 的任务:{ machine, slug, id },取自其 herdr.task 标签("<slug>#<id>"),无则 null。
  taskOf(addr) {
    const key = terminals().find((k) => k.address === addr)?.labels?.["herdr.task"];
    const [slug, id] = String(key ?? "").split("#");
    return key && slug && id ? { machine: addr.includes("/") ? addr.split("/")[0] : null, slug, id: Number(id) } : null;
  }

  // 重读其 task 的记录(开销小:一个小文件;另一台 machine 的读得更少)。
  async loadTask(addr, cx) {
    const cur = this.cur;
    // 已从 core 消失的 terminal 没有标签可用:就用列表发来的 task key。
    const k = (addr && this.taskOf(addr)) || cur?.key || null;
    let rec = null;
    if (k) {
      const text = k.machine
        ? (await exec("sh", ["-c", SH + 'cat "$SHEP_TASKS/$1.json"', "sh", k.slug], { on: k.machine }).catch(() => null))?.stdout
        : await readTextFile(`${dirs().tasks}/${k.slug}.json`).catch(() => null);
      try {
        const d = JSON.parse(text || "null");
        const t = d?.tasks?.find((x) => x.id === k.id);
        rec = t ? { ...t, folder: d.folder, machine: k.machine, ref: d.prefix ? `${d.prefix}-${t.id}` : String(t.id) } : null;
      } catch {}
    }
    if (this.cur !== cur) return;
    // 任务侧视图的指向(taskwhere.js):其 worktree,否则取列表所在文件夹。
    if (this.head) {
      const w = rec ? { terminal: addr, ref: rec.ref, folder: rec.worktree || rec.folder || null, machine: rec.machine ?? null,
        branch: rec.branch ?? null, base: rec.base ?? null, start: rec.start ?? null, pr: rec.pr ?? null } : null;
      if (JSON.stringify(w) !== JSON.stringify(shared("tasks.thread.where") ?? null)) setShared("tasks.thread.where", w);
    }
    if (JSON.stringify(rec) !== JSON.stringify(this.rec)) { this.rec = rec; cx.notify(); }
    if (this.head && rec && find(layout(), ARTIFACTS) && addonOn("artifacts")) this.loadArts(rec, addr, cx);
  }

  // 其 artifact(core/task-artifacts.js,与 web 的 Artifacts tab 查找方式相同):其文件夹的列表(herdr-artifact,
  // 在其 machine 上),以及其 agent 聊天日志声称发布的内容(在那边 grep),供 shared
  // "tasks.thread.artifacts" = { terminal, ref, machine, list: [{ id, title, v, at, proof }] }:header 统计
  // 时,由 mods/task-artifacts 列出。任务显示期间每 ARTS_EVERY 刷新;切换任务则立即。
  async loadArts(rec, addr, cx) {
    const key = `${rec.machine ?? ""}|${rec.folder}|${rec.ref}`;
    if (this.artsBusy || (this.artsKey === key && Date.now() - this.artsAt < ARTS_EVERY)) return;
    this.artsBusy = true;
    try {
      const on = rec.machine ?? null;
      const out = await artifactCli(on, ["list", "--folder", rec.folder]).catch(() => null);
      const arts = Array.isArray(out?.artifacts) ? out.artifacts : [];
      const logs = (Array.isArray(rec.agents) ? rec.agents : []).map((a) => a.log).filter((x) => typeof x === "string");
      const said = logs.length ? await exec("grep", ["-ohE", GREP, ...logs], on ? { on } : {}).catch(() => null) : null;
      const ids = taskArtifacts(arts, { ref: rec.ref, folder: rec.folder, machine: null, agents: rec.agents, proof: rec.proof?.id ?? null }, publishedIds(said?.stdout));
      const list = ids.map((id) => arts.find((a) => a.id === id)).map((a) => ({ id: a.id, title: a.title, v: a.version, at: a.at, proof: a.id === rec.proof?.id }));
      const v = { terminal: addr ?? null, ref: rec.ref, machine: on, list };
      if (this.cur?.terminal === v.terminal && JSON.stringify(v) !== JSON.stringify(shared("tasks.thread.artifacts") ?? null)) setShared("tasks.thread.artifacts", v);
      this.artsKey = key;
      this.artsAt = Date.now();
    } finally {
      this.artsBusy = false;
    }
    cx.notify();
  }

  // Ready 且无阻碍(同列表的 Ready 组):未在请求、无问题、未在合并、也未
  // 回到工作状态。
  acceptable(st, addr) {
    const r = this.rec;
    return Boolean(r && r.state === "ready" && !r.attention && st !== "blocked" && !readyWait(r, [addr]))
      && !this.again(st, addr);
  }

  // 其 worker 自报 ready 后又恢复工作(core/tasks.js 的 busyAgain()):Working,无 Accept。
  again(st, addr) {
    const r = this.rec, k = addr ? terminals().find((x) => x.address === addr) : null;
    return Boolean(r && k) && busyAgain(r, [{ address: addr, status: st, turn: k.turn, role: k.labels?.["herdr.role"] ?? "worker" }]);
  }

  // Accept 先展示你要批准的内容:Accept 卡片(mods/accept-card)会运行 herdr-task
  // 由其自身的 Accept 接受;header 在自己的定时器上重读任务。
  accept(_cx) {
    const r = this.rec;
    openOverlay({ mod: "accept-card", kind: "dialog", modal: true, width: 640, height: 640,
      props: { ref: r.ref, folder: r.folder, machine: r.machine ?? null, title: r.title } });
  }

  // 请求了另一个 worker:关闭并释放旧聊天,为它新建一个。
  async swap(want, cx) {
    const old = this.entity, oldChat = inner.chat;
    this.entity = null;
    inner.chat = null;
    if (old) {
      try { await oldChat?.close(cx); } catch {}
      old.release();
    }
    this.cur = want;
    this.rec = null;
    this.loadTask(want?.terminal, cx);
    if (want?.terminal) this.entity = cx.new(this.Chat, { inner: true, thread: true, terminal: want.terminal, task: want.task, title: want.title,
      log: want.log ?? null, key: want.key ?? null });
    this.swapping = false;
    cx.notify();
  }

  async close(cx) {
    if (!this.head) await inner.chat?.close(cx);
  }

  // 任务的状态点,按 Tasks 列表的规则(mods/tasks place()):先看记录,再看其
  // worker 自身状态。读取其记录前什么都不显示(与圆点等大的空位)。
  dot(st, addr) {
    const r = this.rec;
    if (!r) return div();
    const live = terminals().find((x) => x.address === addr)?.state === "live";
    const last = r.agents?.[r.agents.length - 1];
    const starting = !last?.ended && Date.now() - Math.max(0, ...[r.started, last?.at].filter((x) => typeof x === "number")) < 90000;
    // 问题(检查失败)其 worker 正在处理(core/tasks.js onIt()):Working;无人处理:Needs you。
    const k = addr ? terminals().find((x) => x.address === addr) : null;
    const fixing = r.attention && onIt(r, live ? [{ address: addr, status: st, turn: k?.turn, role: k?.labels?.["herdr.role"] ?? "worker" }] : []);
    const s = ["todo", "queued", "scheduled", "done"].includes(r.state) ? r.state
      : (r.attention && !fixing) || st === "blocked" || r.retry?.over ? "needs"
      : fixing ? "working"
      : r.state === "ready" && !this.again(st, addr) ? (readyWait(r, live ? [addr] : []) ? "working" : "ready")
      : st === "working" || r.retry || starting ? "working" : "needs";
    return taskDot(s, { pct: ownProgress([addr])?.pct ?? r.progress?.done, halo: true });
  }

  status(addr) {
    const a = agents().find((x) => x.address === addr);
    if (a) return a.status;
    const k = terminals().find((x) => x.address === addr);
    return ["working", "blocked", "done", "idle"].includes(k?.status) ? k.status : null;
  }

  // Chat → Terminal:body stack 显示 worker 的 terminal block,先指向它,并且
  // 键盘转向它(输入直达 worker,如同主聊天的 Terminal)。
  toTerminal(addr, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (find(layout(), TERM)?.content?.terminal !== addr) await pointTerm(addr, cx);
        run("layout.select", { stack: BODY, child: TERM });
        run("pane.focus", { terminal: addr });
      } catch (e) {
        toast({ title: "终端没有打开", body: plainError(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // Chat | Terminal | Pull request | Artifacts | Browser:主聊天的 header 开关
  // (ui.js segmented,同 mods/pane-chat)。segs:{ key, label, on, dead (当前无法打开), fn }。
  switcher(t, segs) {
    return segmented("thread-mode", segs.map((x) => [x.key, x.label, { disabled: x.dead }]),
      segs.find((x) => x.on)?.key ?? null, (v, _e, cx) => segs.find((x) => x.key === v)?.fn(cx));
  }

  render(cx) {
    return this.head ? this.renderHead(cx) : this.renderBody(cx);
  }

  // 主体:worker 的聊天(其终端是旁边 layout 自己的块)。
  renderBody(cx) {
    const want = shared("tasks.thread") ?? null;
    if (wantId(want) !== wantId(this.cur) && !this.swapping) {
      this.swapping = true;
      cx.timer.after(0, (cx) => cx.spawn(async (cx) => this.swap(want, cx)));
    }
    // model picker 的 Restart(shared "chat.restartreq"):嵌套 view 不会重绘
    // shared state 变化时触发,由聊天处理;它自行判断是否与自己有关。
    const rr = shared("chat.restartreq");
    if (this.entity && rr?.at && rr.at !== this.restartReqAt) {
      this.restartReqAt = rr.at;
      const e = this.entity;
      cx.timer.after(0, (cx) => cx.notify(e));
    }
    const t = theme();
    return this.entity
      ? v_flex().id("task-thread").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).child(this.entity)
      : v_flex().id("task-thread").size_full().items_center().justify_center().px(18).bg(t.background).text_size(TEXT.label).text_color(t.dim)
        .child(want?.note ?? (want ? "打开中…" : "选一个任务看它的对话。"));
  }

  // worker 的报告(herdr-task status)或 provider 重试的说明,位于标题下方(同其
  // Tasks 行):文字先被压缩,分钟数永不被截断。当它等待
  // 用户看到已冻结,则在末尾显示其百分比。
  reportLine(st, t) {
    const r = this.rec, addr = this.cur?.terminal;
    if (!r || r.state !== "running") return null;
    let text = null, end = null, paused = false;
    if (r.retry && r.retry.address === addr && !r.retry.over && st !== "blocked") {
      text = r.retry.due ? `${r.retry.reason} · Retry in ${Math.max(1, Math.ceil((r.retry.due - Date.now()) / 60000))}m` : `${r.retry.reason} · Retrying`;
    } else if (r.progress?.text) {
      const p = r.progress;
      text = p.text;
      paused = st !== "working";
      if (paused) end = typeof p.done === "number" ? `${p.done}%` : null;
      else if (estimated(p)) {
        const rem = Math.max(0, p.left - ((p.paused_at ?? Date.now()) - (p.at ?? Date.now())));
        const n = rem < 60000 ? 0 : Math.ceil(rem / 60000);
        end = n < 1 ? "<1 min" : n < 60 ? `~${n} min` : `~${Math.round(n / 60)} h`;
      }
    }
    if (!text) return null;
    return h_flex().id("thread-report").w_full().min_w(0).gap(4).items_center().text_size(TEXT.label).text_color(paused ? t.dim : t.muted)
      .child(div().min_w(0).truncate().child(text))
      .when(Boolean(end), (el) => el.child(div().flex_none().text_color(t.dim).child(`· ${end}`)));
  }

  renderHead(cx) {
    const want = shared("tasks.thread") ?? null;
    if (wantId(want) !== wantId(this.cur)) {
      this.cur = want;
      this.rec = null;
      cx.timer.after(0, (cx) => cx.spawn(async (cx) => this.loadTask(want?.terminal, cx)));
    }
    // 任务记录,显示 worker 期间每 3 秒刷新一次(另一台机器上为 12 秒)。
    if (!this.polling) {
      this.polling = true;
      cx.timer.every(3000, (cx) => {
        const addr = this.cur?.terminal, key = this.cur?.key;
        const remote = addr ? addr.includes("/") : Boolean(key?.machine);
        if ((addr || key) && (!remote || ++this.ticks % 4 === 0)) cx.spawn(async (cx) => this.loadTask(addr, cx));
        // 其剩余分钟数倒计时:只要还有读数,每 30 秒重绘一次。
        if (this.rec?.progress && (this.redraws = (this.redraws ?? 0) + 1) % 10 === 0) cx.notify();
      });
    }
    const t = theme();
    const addr = want?.terminal ?? null;
    const k = addr ? terminals().find((x) => x.address === addr) : null;
    const st = addr ? this.status(addr) : null;
    const live = k?.state === "live";
    const term = terminalShown();
    // worker 结束(或无 worker 显示)而其终端还开着:回到其聊天,聊天保留以供阅读。
    if (term && !live && !this.busy) cx.timer.after(0, () => showWorkerChat());
    // 聊天自身切换到终端的途径(requestWorkerTerminal())。
    const rq = shared("tasks.thread.termreq");
    if (rq && rq.at !== this.termReqAt && rq.terminal === addr && live && Date.now() - rq.at < 5000) {
      this.termReqAt = rq.at;
      cx.timer.after(0, (cx) => this.toTerminal(addr, cx));
    }
    // 第二行,一个切换器:Chat、Terminal(worker 结束后置灰),其后是任务自己的视图。
    const shownNow = this.busy ? TERM : find(layout(), BODY)?.active ?? CHAT;
    const pick = (child) => () => run("layout.select", { stack: BODY, child });
    const hasPr = Boolean(this.rec?.pr) || (addr && shared("tasks.thread.pr")?.terminal === addr);
    // 仅当 task 有了 pull request 才显示;失去它时仍显示,切回其聊天。
    if (shownNow === PR && !hasPr && this.rec) cx.timer.after(0, () => showWorkerChat());
    const segs = [
      { key: "chat", label: "对话", on: shownNow === CHAT, fn: () => showWorkerChat() },
      { key: "term", label: "终端", on: shownNow === TERM, dead: !live, fn: (cx) => this.toTerminal(addr, cx) },
 // 没有 Files 或 Changes:那些由 space 的侧边面板展示;task 的变更即其 pull request 的。
      ...(hasPr ? [{ key: "pr", label: "Pull Request", on: shownNow === PR, fn: pick(PR) }] : []),
      // 其 agent 的产出(mods/task-artifacts):始终显示,有产出后开始计数。
      ...(find(layout(), ARTIFACTS) && addonOn("artifacts") ? [{ key: "artifacts", label: this.artsLabel(want), on: shownNow === ARTIFACTS, fn: pick(ARTIFACTS) }] : []),
      // 任务自己的浏览器,实时监控(mods/task-browser),layout 含它时显示。
      ...(find(layout(), BROWSER) && addonOn("browser") ? [{ key: "browser", label: "浏览器", on: shownNow === BROWSER, fn: pick(BROWSER) }] : []),
    ];
    // 三条行共用一个左缘(EDGE):细条(‹ Tasks;base、Accept)、任务行(其
    // 状态点、id 与标题,其下是 agent 正在做的事),然后是切换器。
    // 它们的高度是 layouts/herdr-winapp.json 中 "tasks-thread-head" 块的尺寸(127):两者须保持一致。
    return v_flex().id("thread-head-rows").size_full().pt(8).pb(12).gap(12).bg(t.background).border_b(1).border_color(t.border)
      .child(v_flex().flex_none().gap(8)
        .child(this.barRow(t, st, addr))
        .child(this.taskBlock(t, { want, st, addr })))
      .child(h_flex().id("thread-views").flex_none().px(EDGE).overflow_x_scroll()
        .child(this.switcher(t, segs)));
  }

  // "Artifacts",当前任务有工件时附数量("Artifacts 3")。
  artsLabel(want) {
    const a = shared("tasks.thread.artifacts");
    const n = a && a.terminal === (want?.terminal ?? null) && (want?.terminal || a.ref === want?.task) ? a.list.length : 0;
    return n ? `Artifacts ${n}` : "工件";
  }

  // 细条:左侧 ‹ Tasks 返回列表(chevron 落在共享边上,悬停
  // 越过其上方),右侧为任务的 base 与 Accept
 // (无 Pin:任务的行菜单负责置顶,)。
  barRow(t, st, addr) {
    return h_flex().id("thread-bar").h(24).flex_none().pl(EDGE - 6).pr(EDGE).gap(4).items_center()
      .child(h_flex().id("thread-back").h(24).pl(2).pr(8).gap(2).flex_none().items_center().rounded(RADIUS.control).cursor_pointer()
        .text_size(TEXT.label).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); backToTasks(); })
        .child(svg("mods/workspace-chrome/chevron-left.svg").size(14).flex_none())
        .child("任务"))
      .child(div().flex_1())
      // task 自己的 base(herdr-task add --base),即其合并目标;文件夹默认值不显示。
      .when(Boolean(this.rec?.base_set && this.rec?.base), (el) => el.child(div().id("thread-base").flex_none().max_w(160).truncate().pr(4)
        .text_size(TEXT.label).text_color(t.muted).child(`→ ${this.rec.base}`)))
      // Review:header 唯一的 primary 按钮,打开 Accept 卡片(有可合并内容时,Accept 会先合并)。
      .when(this.acceptable(st, addr), (el) => el.child(button("thread-accept", this.accepting ? "接受中…" : "审查",
        { kind: "primary", disabled: this.accepting, onClick: (_e, cx) => this.accept(cx) })));
  }

  // 任务:标题行旁是其状态点(同其 Tasks 行,Needs you 带光晕),
  // id(列表用等宽字体)与标题;其下是 agent 自述的当前工作,并带
  // 分钟("Fixing the two failing tests · ~6 min"),位于标题左缘。没有 agent
  // 图标或名称:聊天输入框的模型按钮标明是哪个 agent。两行始终保留
  // 其高度,报告来去时布局不跳。
  taskBlock(t, { want, st, addr }) {
    const report = this.reportLine(st, t);
    const title = want?.title ?? this.rec?.title ?? "";
    return h_flex().id("thread-task").flex_none().px(EDGE).gap(8).items_start().text_color(t.foreground)
      .child(h_flex().w(16).h(22).flex_none().items_center().justify_center().child(this.dot(st, addr)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().h(22).min_w(0).gap(8).items_center()
          .when(Boolean(want?.task), (el) => el.child(div().flex_none().font_family(ID_FONT).text_size(TEXT.label).text_color(t.dim).child(want.task)))
          .child(div().id("thread-title").flex_1().min_w(0).truncate().text_size(TEXT.title).font_medium().child(title)))
        .child(h_flex().h(16).min_w(0).items_center()
          .child(div().flex_1().min_w(0).when(Boolean(report), (el) => el.child(report)))));
  }
}
