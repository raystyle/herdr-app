// Jump(Ctrl+K,同 herdr-winapp 的 ⌘K):一个搜索框,可找到 space、task、artifact 或 machine 并
// 跳转过去。用 mod.open:jump 打开(再按一次关闭),窗口顶部的 popup。
// 输入以过滤:输入的每个词都须出现在条目的某处,不区分大小写(herdr-winapp 的
// matches())。任务按 id、标题、状态行、摘要与运行位置匹配,Done 与已归档
// 同样适用(输入内容后才归档);artifacts 按标题及其来源任务
// 及其文件夹;spaces 按名称、文件夹与机器。各组新的在前,因此无
// 输入后最新工作在最上。↑/↓ 与 Enter,或点击,执行:
// space     space.select
// machine   它的第一个 space
// task      其 worker 在 Tasks panel 内的 chat(chat/panel.js 的 drill-in);没有
// 活跃 worker(to do、queued、done、archived):即 Tasks 列表中搜索该项。一个
// layout 若没有 Tasks panel,会先切换到带它的我们的版本(TASKS_LAYOUT)。
// artifact   聚焦 pane 为 chat 时其上的查看器(或 Tasks panel 中任务的
// panel,若键盘原在那里),因为那边的卡片会打开它(artview.js);否则
// (终端,或其位置未知时)是 Artifacts sidebar,否则是整个窗口
// Ctrl+Shift+K 也可打开这里:它是唯一的切换器。
// 任务与 artifact 从每台 machine 的 ~/.local/share/herdr-winapp/tasks 和 ~/.local/share/herdr-winapp/artifacts 读取一次
// 打开时即取,与 Tasks、Artifacts 面板的读取一致。

import { div, svg } from "gpui-kit";
import { View } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, VirtualListScrollHandle, v_virtual_list, Scrollbar } from "gpui-base";
import { machines, layout, layouts, exec, home, run, theme, props, closeOverlay, shared, setShared } from "herdr";
import { note } from "./usage.js";
import { spaces, terminals, agents, inRender } from "./live.js";
import { taskDot } from "./dot.js";
import { READ_LISTS, taskLists } from "./core/tasklists.js";
import { SH } from "./core/paths.js";
import { busyAgain, onIt, readyWait } from "./core/tasks.js";
// space 的名字,与 sidebar(及 web app)所示一致:绝不会是 "~"(core/spaces.js)。
import { spaceName } from "./core/spaces.js";
import { openViewer, showViewer, chatArea } from "./artview.js";
import { showInSidebar, hasSidebarView } from "./artifact-sidebar.js";
import { TEXT, RADIUS } from "./ui.js";

// 我们的带 Tasks panel 的 layout,用于当前视图没有任务而用户选了任务的情况。
const TASKS_LAYOUT = "herdr-winapp";

const KINDS = ["space", "task", "artifact", "machine"];
const GROUP = { space: "Spaces", task: "任务", artifact: "工件", machine: "机器" };
const SHOWN = 8; // 一组在 “显示另外 N 条” 之前显示的行数
const ROW = 48, HEAD = 30, MORE = 32;
// popup 高度与其内容一致:列表占其自身高度,上限为此值。
const LIST_MAX = 420;
// task id 用等宽列(JetBrains Mono:每字符 0.6 em),使标题对齐。
const ID_FONT = "JetBrains Mono", ID_SIZE = TEXT.id, ID_CHAR = ID_SIZE * 0.6;
const STATUS = { needs: "需要你", working: "进行中", merging: "合并中", ready: "就绪", queued: "排队中", scheduled: "已排期", todo: "待办", done: "完成" };

// Tasks 面板的读取(tasklists.js:READ_LISTS、taskLists);其所涉及的每个 artifact 注册表
// 同样的方式。
const READ_ARTS = SH + 'cd "$SHEP_ARTIFACTS" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && cat "$f" && printf "\\n\\036\\n"; done; true';
// 每个文件夹的 git repo(其公共 .git 文件夹),各占一行:"<folder>\t<common dir>",用于 space 命名。
const READ_REPOS = 'for f in "$@"; do r=$(git -C "$f" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); printf "%s\\t%s\\n" "$f" "$r"; done; true';
// 取公共 .git 文件夹得出 repo 名称(与服务端 model.ts 和侧栏的取名一致)。
const repoName = (common) => (common ? (common.endsWith("/.git") ? common.slice(0, -5) : common.replace(/\.git$/, "")).split("/").filter(Boolean).pop() ?? null : null);

// herdr-task 的 auto_prefix,用于无前缀时期的旧列表(如 mods/tasks/main.js)。
function autoPrefix(folder) {
  const name = String(folder ?? "").split("/").filter(Boolean).pop() ?? "";
  const ws = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z]+/).filter(Boolean);
  let p = ws.length > 1 ? ws.map((w) => w[0]).join("").slice(0, 5) : (ws[0] ?? "").slice(0, 4);
  if (p.length < 2) p = ws.join("").length >= 2 ? ws.join("").slice(0, 2) : "TASK";
  return p.toUpperCase();
}

// 输入的每个词都落在其中之一,不区分大小写。
function matches(q, ...fields) {
  const all = fields.filter((f) => f !== undefined && f !== null && f !== "").join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => all.includes(w));
}

const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);
const machineName = (m) => m ?? "本机";
const tilde = (p) => { const h = home(); return h && p && (p === h || p.startsWith(h + "/")) ? `~${p.slice(h.length)}` : p; };
const capital = (s) => (s && /^[a-z](?![A-Z])/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

// "now"、"5m ago"、"3h ago"、"2d ago",更久则显示日期。
function ago(at) {
  if (!at) return null;
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`;
  return new Date(at).toLocaleDateString();
}

const find = (node, id) => {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
};

// task 的 worker 聊天,位于 Tasks panel 内(mods/chat/panel.js 的 openTaskThread)。
function openTaskThread(terminal, task, title) {
  setShared("tasks.thread", { terminal, task: task ?? null, title: title ?? null, at: Date.now() });
  run("layout.select", { stack: "panel-body", child: "tasks" });
  run("layout.select", { stack: "tasks", child: "tasks-thread" });
  if (find(layout(), "tasks-thread-body")) run("layout.select", { stack: "tasks-thread-body", child: "tasks-thread-chat" });
  run("layout.show", { id: "panel" });
}

// Tasks 列表,搜索某个任务(mods/tasks/main.js 读取 shared "tasks.searchreq")。
function showInTaskList(q) {
  setShared("tasks.searchreq", { q, at: Date.now() });
  run("layout.select", { stack: "panel-body", child: "tasks" });
  run("layout.select", { stack: "tasks", child: "tasks-list" });
  run("layout.show", { id: "panel" });
}

export default class Jump extends View {
  init(_props, cx) {
    note("feature", { type: "jump" });
    this.openedAt = Date.now(); // 聊天的输入框在此前后释放键盘的,即持有键盘者(chatArea())
    this.lists = new Map(); // ""(本机)或某台机器 -> 其任务列表
    this.arts = new Map();  // 相同 -> 其 artifacts,每项含 { machine, folder }
    this.repos = new Map(); // "<machine>|<folder>" -> 其 git 仓库名(null:不是仓库)
    this.loading = new Set();
    this.more = new Set();  // 分组,显示全部行
    this.sel = null;        // 选中行的 key
    this.input = InputState.new({ placeholder: "搜索空间、任务、工件" });
    this.input.on("change", (_e, cx) => { this.sel = null; this.more.clear(); this.scroll.scroll_to_item(0, "top"); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.current, cx));
    this.scroll = VirtualListScrollHandle.new();
    this.input.focus();
    cx.timer.after(0, () => this.input.focus());
    cx.timer.after(600, () => this.input.focus());
    for (const m of [null, ...machines().filter((x) => x.name && x.layout !== "unavailable").map((x) => x.name)]) {
      cx.spawn(async (cx) => this.read(cx, m));
    }
  }

  close() { this.input.release(); this.scroll.release(); }

  // 一台 machine 的任务列表与 artifact(null 为本机的)。
  async read(cx, machine) {
    const k = machine ?? "", on = machine ? { on: machine } : {};
    this.loading.add(k);
    try {
      const folders = [...new Set(spaces().filter((s) => (s.machine ?? null) === machine && s.folder).map((s) => s.folder))];
      const [lists, arts, repos] = await Promise.all([exec("sh", ["-c", READ_LISTS], on), exec("sh", ["-c", READ_ARTS], on),
        folders.length ? exec("sh", ["-c", READ_REPOS, "repos", ...folders], on).catch(() => null) : null]);
      for (const line of (repos?.stdout ?? "").split("\n")) {
        const [f, common] = line.split("\t");
        if (f) this.repos.set(`${k}|${f}`, repoName(common));
      }
      this.lists.set(k, taskLists(lists.stdout)
        .map((d) => ({ ...d, machine, prefix: d.prefix || autoPrefix(d.folder), tasks: Array.isArray(d.tasks) ? d.tasks : [] })));
      const found = [];
      for (const part of arts.stdout.split("\x1e")) {
        try { const reg = JSON.parse(part); for (const a of reg.artifacts ?? []) found.push({ ...a, machine, regFolder: reg.folder, regName: reg.name }); } catch {}
      }
      this.arts.set(k, found);
    } catch {
      // 机器不可达:其条目不列出。
    }
    this.loading.delete(k);
    cx.notify();
  }

  // space 的叫法,与侧栏一致:自己的名称,否则取 repo 或文件夹名,home 处为 "Home"。
  nameOf(s) {
    const repo = this.repos.get(`${s.machine ?? ""}|${s.folder}`) ?? null;
    return spaceName(s, { repo, home: s.machine ? null : home(), named: Boolean(s.named) });
  }

  // 按名称标识在某机器某文件夹中工作的 space。
  spaceAt(machine, folder) {
    return spaces().find((s) => (s.machine ?? null) === (machine ?? null) && s.folder === folder) ?? null;
  }

  // task 的存活 agent:在其文件夹所在 machine 上、以 task key 标注的 terminal。
  live(list, task) {
    const key = `${list.slug}#${task.id}`, m = list.machine ?? null;
    const shown = new Map(agents().map((a) => [a.address, a]));
    return terminals().filter((k) => k.state === "live" && k.labels?.["herdr.task"] === key && machineOf(k.address) === m)
      .filter((k) => k.program?.key !== "shell" && !k.program?.shell)
      .map((k) => ({ address: k.address, status: shown.get(k.address)?.status ?? k.status, turn: k.turn, role: k.labels?.["herdr.role"] ?? "worker" }));
  }

  // task 的状态,按 Tasks panel 的简称(完整规则见 tasks/main.js 的 place())。
  status(task, live) {
    const st = task.state;
    if (["todo", "queued", "scheduled", "done"].includes(st)) return st;
    // 问题(检查失败)其 agent 正在处理(core/tasks.js onIt()):Working;无人处理:Needs you。
    const fixing = task.attention && onIt(task, live);
    if ((task.attention && !fixing) || live.some((a) => a.status === "blocked")) return "needs";
    if (fixing) return "working";
    // 说过 ready 后又开始工作(core/tasks.js 的 busyAgain()):Working。
    if (st === "ready" && !busyAgain(task, live)) return readyWait(task, live) ? "working" : "ready";
    if (live.some((a) => a.status === "working")) return "working";
    const last = task.agents?.[task.agents.length - 1];
    const started = Math.max(0, ...[task.started, last?.at].filter((x) => typeof x === "number"));
    if (!last?.ended && Date.now() - started < 90000) return "working";
    return "needs";
  }

  items(q) {
    const out = [];
    const icons = shared("spaces-chat")?.icons ?? {};
    const remote = machines().some((m) => m.name);
    for (const s of spaces()) {
      const where = [remote ? machineName(s.machine) : null, tilde(s.folder) || "~"].filter(Boolean).join(" · ");
      const name = this.nameOf(s);
      if (q && !matches(q, name, s.folder, tilde(s.folder), machineName(s.machine))) continue;
      const at = Math.max(0, ...s.tabs.map((t) => t.changed_at ?? 0));
      out.push({ kind: "space", key: `s:${s.id}`, id: s.id, icon: icons[s.id] ?? "#", label: name, sub: where, at, active: s.active, status: s.status });
    }
    for (const [, lists] of this.lists) for (const list of lists) for (const task of list.tasks) {
      if (task.archived && !q) continue;
      const ref = `${list.prefix}-${task.id}`;
      const space = this.spaceAt(list.machine, list.folder);
      const place = [space ? this.nameOf(space) : list.name, remote ? machineName(list.machine) : null].filter(Boolean).join(" · ");
      const live = task.state === "running" || task.state === "ready" ? this.live(list, task) : [];
      const status = this.status(task, live);
      const line = status === "working" ? task.progress?.text : status === "needs" ? task.waits ?? task.attention : task.summary;
      if (q && !matches(q, ref, task.title, task.progress?.text, task.summary, task.waits, task.attention, space ? this.nameOf(space) : null, list.name, machineName(list.machine))) continue;
      const at = Math.max(0, ...[task.archived, task.done_at, task.ready_at, task.progress?.at, task.started, task.created].filter((x) => typeof x === "number"));
      out.push({ kind: "task", key: `t:${list.machine ?? ""}:${list.slug}#${task.id}`, ref, label: task.title, live, status, pct: task.progress?.done,
        sub: [task.archived ? "Archived" : STATUS[status], line && capital(String(line).split("\n")[0]), place].filter(Boolean).join(" · "), at });
    }
    for (const [, arts] of this.arts) for (const a of arts) {
      const space = this.spaceAt(a.machine, a.folder ?? a.regFolder);
      const place = space ? this.nameOf(space) : a.regName ?? tilde(a.folder);
      if (q && !matches(q, a.title, a.id, a.task, place, tilde(a.folder), remote ? machineName(a.machine) : null)) continue;
      out.push({ kind: "artifact", key: `a:${a.machine ?? ""}:${a.id}`, art: a, label: a.title || a.id,
        sub: [a.task, place, remote ? machineName(a.machine) : null, `v${a.version ?? 1}`, ago(a.at)].filter(Boolean).join(" · "), at: a.at ?? 0 });
    }
    if (remote) for (const m of machines()) {
      const n = spaces().filter((s) => (s.machine ?? null) === (m.name ?? null)).length;
      if (q && !matches(q, machineName(m.name))) continue;
      out.push({ kind: "machine", key: `m:${m.name ?? ""}`, name: m.name, label: machineName(m.name),
        sub: [`${n} space${n === 1 ? "" : "s"}`, m.layout === "unavailable" ? "Offline" : null].filter(Boolean).join(" · "), at: 0 });
    }
    // 每组内最新在前;无新闻的 space 保持 sidebar 顺序(稳定排序)。
    return out.sort((a, b) => b.at - a.at);
  }

  // 绘制出的列表:每个非空分组的标题、其各行,以及 "Show N more"。
  rows(q) {
    const all = this.items(q);
    const rows = [];
    for (const kind of KINDS) {
      const mine = all.filter((x) => x.kind === kind);
      if (!mine.length) continue;
      rows.push({ kind: "head", key: `h:${kind}`, label: GROUP[kind], count: mine.length });
      const shown = this.more.has(kind) ? mine : mine.slice(0, SHOWN);
      rows.push(...shown);
      if (mine.length > shown.length) rows.push({ kind: "more", key: `more:${kind}`, group: kind, count: mine.length - shown.length });
    }
    return rows;
  }

  go(r, cx) {
    if (!r) return;
    if (r.kind === "more") {
      this.more.add(r.group);
      this.sel = null;
      cx?.notify();
      return;
    }
    closeOverlay(props().overlay);
    if (r.kind === "space") run("space.select", { id: r.id });
    else if (r.kind === "machine") {
      const s = spaces().find((x) => (x.machine ?? null) === (r.name ?? null));
      if (s) run("space.select", { id: s.id });
      else run("app.settings", { section: "machines" });
    } else if (r.kind === "task") this.openTask(r);
    else if (r.kind === "artifact") this.openArtifact(r.art);
  }

  // 其 worker 在 Tasks panel 中的聊天(worker 优先请求时);否则为 Tasks 列表,搜索
  // 为之。当前 layout 没有 Tasks 面板时,我们带面板的排在最前。
  openTask(r) {
    if (!find(layout(), "tasks-list") && layouts().includes(TASKS_LAYOUT)) run("layout.switch", { name: TASKS_LAYOUT });
    const workers = r.live.filter((a) => a.role !== "reviewer");
    const w = workers.find((a) => a.status === "blocked") ?? workers[0] ?? r.live[0];
    if (w) return openTaskThread(w.address, r.ref, r.label);
    showInTaskList(`${r.ref} ${r.label}`);
  }

  // 位于之前键盘所在的聊天上方,如同其卡片打开它;否则显示在 Artifacts sidebar。
  openArtifact(a) {
    const area = chatArea(this.openedAt);
    const show = area || !hasSidebarView() ? showViewer : (v) => showInSidebar(v) || showViewer(v);
    openViewer({ id: a.id, title: a.title, version: a.version, machine: a.machine ?? null }, area, show);
  }

  mark(r, t) {
    if (r.kind === "task") return taskDot(r.status, { pct: r.pct });
    if (r.kind === "artifact") return svg("mods/artifacts/artifacts.svg").size(14).flex_none().text_color(t.muted);
    if (r.kind === "machine") return svg("mods/workspace-chrome/server.svg").size(14).flex_none().text_color(t.muted);
    return div().w(14).flex_none().text_center().text_size(r.icon === "#" ? 15 : 13).text_color(t.muted).child(r.icon);
  }

  row(r, on, t) {
    if (r.kind === "head") {
      return h_flex().w_full().h(HEAD).px(14).pt(10).gap(6).items_center().text_size(TEXT.label).font_medium().text_color(t.dim)
        .child(r.label).child(div().text_color(t.dim).child(String(r.count)));
    }
    if (r.kind === "more") {
      return h_flex().w_full().h(MORE).px(6).child(
        h_flex().flex_1().h_full().px(8).items_center().rounded(RADIUS.card).text_size(TEXT.label).text_color(t.accent).cursor_pointer()
          .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
          .child(`Show ${r.count} more`));
    }
    return h_flex().w_full().h(ROW).px(6).child(
      h_flex().flex_1().min_w(0).h_full().px(8).gap(10).items_center().rounded(RADIUS.card).cursor_pointer()
        .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .child(this.mark(r, t))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().min_w(0).gap(8).items_center()
            .when(r.kind === "task", (el) => el.child(div().flex_none().w(this.idWidth).font_family(ID_FONT).text_size(ID_SIZE).text_color(t.dim).child(r.ref)))
            .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).text_color(t.foreground).when(Boolean(r.active), (d) => d.font_semibold()).child(r.label)))
          .when(Boolean(r.sub), (el) => el.child(div().min_w(0).truncate().text_size(TEXT.label).text_color(t.dim).child(r.sub)))));
  }

  // 整个 render 共用一份 Herdr 实时列表副本(live.js):超过约 50 毫秒 Herdr 会中止它。
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const t = theme();
    const q = this.input.value().trim();
    const rows = this.rows(q);
    this.idWidth = Math.ceil(Math.max(0, ...rows.map((r) => r.ref?.length ?? 0)) * ID_CHAR) + 1;
    const pickable = rows.filter((r) => r.kind !== "head");
    const at = Math.max(0, pickable.findIndex((r) => r.key === this.sel));
    const cur = (this.current = pickable[at] ?? null);
    const move = (d, cx) => {
      if (!pickable.length) return;
      const next = pickable[Math.max(0, Math.min(pickable.length - 1, at + d))];
      this.sel = next.key;
      const i = rows.indexOf(next);
      // 分组标题固定显示,盖在其第一行之上。
      this.scroll.scroll_to_item(rows[i - 1]?.kind === "head" && d < 0 ? i - 1 : i);
      cx.notify();
    };
    const loading = this.loading.size > 0;
    const empty = !rows.length
      ? v_flex().h(120).items_center().justify_center().gap(4).text_size(13).text_color(t.dim)
        .child(loading ? "读取任务和工件…" : q ? "没有找到。试试更少的关键词。" : "这里空空如也。")
      : null;
    const sizes = rows.map((r) => (r.kind === "head" ? HEAD : r.kind === "more" ? MORE : ROW));
    const listH = Math.min(LIST_MAX, sizes.reduce((a, b) => a + b, 0));
    return v_flex().id("jump").w_full().bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); return; }
        if (e.key === "down" || (e.key === "n" && e.modifiers.control)) move(1, cx);
        else if (e.key === "up" || (e.key === "p" && e.modifiers.control)) move(-1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/workspace-chrome/search.svg").size(15).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(14).text_color(t.foreground)))
      .child(empty ?? div().relative().h(listH + 8).py(4)
        .child(v_virtual_list("jump-list", rows.length, sizes,
          (i) => rows[i].key, (range) => rows.slice(range.start, range.end).map((r) => this.row(r, r === cur, t)))
          .track_scroll(this.scroll).size_full()
          // 行不接收 handler:由列表告知按下了哪一行。
          .on_item_click((key, cx) => this.go(this.rows(this.input.value().trim()).find((r) => r.key === key && r.kind !== "head"), cx)))
        .child(Scrollbar.vertical("jump-list").absolute().inset_0()));
  }
}
