// 工作区 spaces:稳定的彩色头像,worktree 归入其 checkout 之下,
// 已知多台时按 machine 分组。space 名称之后是 repo
// 其首个 terminal 所在处,只标出异常项:branch。agent 状态存于 agents 列表,不在此处。点击以
// 开关、右键打开菜单、拖动排序。每台 machine 之下是其分区
// (sections.js):header 上的 + 创建新分组,space 可拖入拖出(仅能
// 拖动;space 悬停其上时折叠分区会展开)。机器之上是 Pinned
// (space 菜单中的 Pin / Unpin,或拖入拖出)。机器 header 的右键可重命名
// 它:sidebar 显示的名称与 emoji。未被命名的 space 按其所在位置命名
// (nameOf:"Home"、其仓库、其文件夹);同一机器上同名的两个会在 dim 状态下显示各自文件夹。
// 未连接的机器显示 "Offline",变暗折叠,无 + 号和 meter。
// 以 overlay 打开(props.view)时,该 mod 变为其菜单之一(popups.js),
// 重命名与新建分区对话框(rename.js)或其中的图标选择器(icon.js)。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { machines, run, props, exec, hc, home, theme, shared, setShared, watchFolder, window, layout, nextCommand, readTextFile } from "herdr";
import { panes, spaces as allSpaces, inRender } from "./live.js";
import { countsByTab, readyByTab } from "./inbox.js";
import { spacesWithChats } from "./parked.js";
import { sectionsOf, sectionOf, iconOf, placeSpace, foldSection, prune, data, pin, foldPinned, machineLook, restoreSection } from "./sections.js";
import { Menu, openMenu, rectOf } from "./popups.js";
import { IconPicker } from "./icon.js";
import { Rename } from "./rename.js";
import { unreadSpaces, readShown } from "./unread.js";
import { muted } from "./notify.js";
import { MachinePopup, openMachine, openMachineSettings } from "./machine-popup.js";
import { startPolling, allStats, healthMeters, bars } from "./machines.js";
import { countBadge, red, green, H, TEXT, RADIUS, toast } from "./ui.js";
import { on as addonOn } from "./addons.js";
import { spaceName, gitTail, tilde, sharedNames, inOrder, withOrder, machinesInOrder, machineOrderOf, withMachineOrder } from "./core/spaces.js";
import { coordinatorTab } from "./coordinator.js";
import { WORKTREE_RE } from "./core/paths.js";
import { dirsReady } from "./dirs.js";

const POPUPS = { add: Menu, space: Menu, section: Menu, icon: IconPicker, rename: Rename, machine: MachinePopup };

// 以聊天形式呈现的 agent 的 space 计入其状态。
const spaces = spacesWithChats;

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

// 为工作创建的 checkout(~/.herdr/worktrees/<repo>/<branch>,任意 machine 上):coordinator 的
// task worker 在其中运行,worktree space 也建于其中。
const WORKTREES = WORKTREE_RE;   // ~/.herdr/worktrees(Herdr 的对话框,较旧任务)或 herdr-winapp 的 data/worktrees
const inside = (path, folder) => path === folder || path.startsWith(`${folder.replace(/\/+$/, "")}/`);

// space 当前位置:其首个终端的实时文件夹,否则取创建处。任务
// worker 的 checkout 不代表 space(其 branch 不是 space 的):terminal
// ~/.herdr/worktrees 下的只统计 space 自身文件夹内(worktree space 的)。
// `ps`:panes(),由调用方读一次(每次读取都会复制所有 pane)。
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  const own = (cwd) => !WORKTREES.test(`${cwd}/`) || (s.folder && inside(cwd, s.folder));
  return ps.find((p) => tabs.has(p.tab) && p.cwd && own(p.cwd))?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
// drag() 对 Pinned 位置的机器处理:来自任何机器的 space 都可落入。
const ANY = "\u0000any";
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// 主目录(本机或其他机器上,其 home() 在本地未知),及其下的路径(tilde),以及
// 同一 machine 上重名的,显示其文件夹(sharedNames):用 shared core 的,与 web 的行一致。
// Herdr 之外发生的变更(编辑器保存、其他应用中的 commit):会被查看
// 为此轮询,列表展示 repo 内容,且窗口在前台时进行。
const FALLBACK = 60000;

// 存储的颜色名在头像上的呈现(每个 mod 一致
// 绘制 space 头像的):每个色相一种饱和色,深浅色主题通用。
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// space 只有在其中有事需要你处理时才会发声。
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

// space 的名字(rail 上为其编号):其 Assistant 有新动静时加粗提亮
// 新(unread.js),类似 Slack 的未读频道。隐藏的加粗副本撑住宽度,因此
// 加粗时旁边的元素不动。
function nameText(text, fresh, color, t) {
  return div().relative().min_w(0)
    .child(div().invisible().font_semibold().truncate().child(text))
    .child(div().absolute().top(0).left(0).right(0).truncate().text_color(fresh ? t.foreground : color)
      .when(fresh, (el) => el.font_semibold()).child(text));
}

export default class Spaces extends View {
  init(_props, cx) {
    const Popup = POPUPS[props()?.view];
    if (Popup) {
      this.popup = new Popup();
      this.popup.init(cx);
      return;
    }
    this.git = {}; // where() -> { name, branch, repo, linked },null:不是 repo
    this.checked = {}; // where() -> 上次查看的时间
    this.unsure = new Set(); // git 无法回答的那些 where()(机器在远端)
    this.pending = new Set(); // 下一步要查看的 where() 列表
    this.busy = {}; // pane -> 工作中的 agent 或位于其 shell 前台的程序
    this.ready = {}; // machine -> 上次查看时其 layout 可读取
    this.at = {}; // space -> 上次查看时的 where() 结果
    this.watching = new Set(); // 本地 repo 的 git 目录
    // 运行期间创建的 spaces 会等待其 git(至多片刻),因此
    // worktree 显示在其 repo 之下,而不是跳转过去。
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null; // 正被拖动的 space(其 id)
    this.movingMachine = undefined; // header 正被拖动的 machine(null:本机;undefined:无)
    this.machineOver = undefined; // 其悬停的 machine header
    this.over = null; // 落点:"space:<id>"、"section:<id>"(其末尾)或 "top:<machine>"
    this.peek = null; // 拖动 space 悬停其上时,折叠的分区会展开
    this.unread = new Set(); // Assistant 有新内容的 spaces(unread.js)
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.openOffline = new Set(); // 离线 machine 也可打开(初始为折叠)
    this.machinesRead = false; // hc machine ls 只问一次:不在其中的 machine 视为离线
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // 本机每个开启 Autopilot 的 space(herdr-task 的 ~/.local/share/herdr-winapp/tasks/.autopilot.json):"on" 或 "waking"
    // 唤醒正在运行或等待其 Assistant 期间;其行显示一个标记(row())。每 5 秒读取。
    this.pilots = new Map();
    this.readPilots(cx);
    cx.timer.every(5000, (cx) => this.readPilots(cx));
    // 精简:已移除语音通话监听器
    // 每台 machine 的健康与 plan 限额(machines.js):每 45 秒 / 10 分钟读取一次,而非每次 render。
    startPolling(cx);
    // spaces-chat.machine(一个键,或 `herdr-app do`):当前 space 所属 machine 的详情。
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        // 位于 sidebar 旁、靠上位置:不是由某个 meter 点击而停靠的。
        if (c === "machine") openMachine(allSpaces().find((s) => s.active)?.machine ?? null, { x: 250, y: 40, width: 320, height: 0 });
        // spaces-chat.machine-limits:Settings > Machines,由详情最后一行打开。
        if (c === "machine-limits") openMachineSettings();
        // “已删除”分区 toast 的点击(sections.js deleteSection)。
        if (c === "undo-section") restoreSection();
        cx.notify();
      }
    });
    // `git status` 遍历整棵树,在另一台机器上则由该处进程执行:
    // 仅当其答案可能已变化时(见 `due`)。
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  readPilots(cx) {
    cx.spawn(async (cx) => {
      let d = null;
      try { d = JSON.parse((await readTextFile(`${(await dirsReady()).tasks}/.autopilot.json`)) ?? "{}"); } catch { return; }
      const next = new Map(Object.entries(d?.spaces ?? {}).filter(([, a]) => a?.on).map(([id, a]) => [id, a.inflight || a.pending ? "waking" : "on"]));
      if (JSON.stringify([...next]) === JSON.stringify([...this.pilots])) return;
      this.pilots = next;
      cx.notify();
    });
  }

 // space 名字后的 Autopilot 标记:一个小火箭,与其聊天 wake line 同款;开启时变暗,位于
  // 唤醒运行或等待期间的工作色与呼吸效果。仅限本机 spaces(另一台 machine 的文件
  // 在其 header 显示处读取)。
  pilotMark(w, t) {
    const p = w.machine ? null : this.pilots?.get(w.id);
    if (!p) return null;
    return div().id(`pilot-${w.id}`).flex_none().text_color(p === "waking" ? t.working : t.dim)
      .when(p === "waking", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 }))
      .child(svg("mods/spaces-chat/rocket.svg").size(12).flex_none());
  }

 // 、与 herdr-winapp 本身的语音通话(非某个聊天),从品牌行的语音按钮发起
  // 位于 Search 旁(mods/workspace-chrome-herdr-winapp,经 shared "voice.startreq")。窗口在当前显示的
  // space 的 Assistant 聊天(mods/chat 的 voice.ts:shared "chat.callreq" { pane, at, action: "start" | "mute" | "end" }),
  // 但通话可听到并触达所有 space。通话期间品牌行的按钮是 Mute 与 End,不显示其他内容
  // 此处;窄边栏(无 brand 行按钮)上是结束通话的绿色波形,非通话时是发起通话的浅色波形。
  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // git 可能已变化的地点:新增的(新 space、cd 过的),以及
  // 命令或 agent 轮次刚结束(checkout、commit、编辑),其上
  // 恢复在线的机器,以及当前视图中到期需回退的 repo。
  due(now, sp, ps) {
    // 已移到那里:它对该处的了解可能已过时。
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane] && keys.has(at[spaceOf[p.tab].id])) due.add(at[spaceOf[p.tab].id]);
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) { this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); this.machinesRead = true; }
      } catch {}
      cx.notify();
    });
  }

  // 一次只看一处,每处只看一次,即便期间被请求多次。
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // 一处地点的 git:其分支与 repo。
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // 不用可选锁:触碰 index 的 status 会再次惊动 watch。
      // 不在 .git 下写任何内容(index lock、fsmonitor cookie):否则 watch() 会被惊动。
      // 以 repo 本身的 .git 文件夹命名;worktree 的顶层与之不同。
      const r = await exec("git", ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      if (r.code !== 0) {
        // 只有 git 自己的 "no" 才记为无 repo;其他任何回答都会再次询问。
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      const [top, repo] = r.stdout.split("\n").map((l) => l.trim());
      // 其 branch;无则 detached
      const head = await exec("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd, on });
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      this.git[key] = { name, branch: head.code === 0 ? head.stdout.trim() || null : null, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      if (!on) this.watch(repo, cx);
    } catch {
      // 无法询问(machine 不在线):保留已显示的内容,稍后再看。
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        let w = null;
        while (this.watching.has(repo)) {
          // 每次等待至多 5 秒,让 reload 前的旧构建在下一次使用 cx 时结束。
          w ??= watchFolder(repo).then(() => true);
          if (!(await Promise.race([w, cx.sleep(5000)]))) continue;
          w = null;
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // space 自己的菜单(popups.js)。
  menu(w, g, name, e) {
    openMenu("space", { space: w.id, name, machine: w.machine ?? null, git: g ? (g.linked ? "linked" : "main") : null, unread: this.unread.has(w.id),
      assistant: Boolean(coordinatorTab(w)), row: rectOf(e) });
  }

  // space 的叫法:用户起的名字,否则按其当前位置(`at`)来称呼,如
  // Herdr 来命名但绝不用 "~":home 文件夹显示 "Home",repo 用其名,其余文件夹用其
  // 自身(space 位于 /tmp/488b3d00 时显示 "488b3d00",而非其 Assistant 的 "~")。名为 "~" 的 space(如
  // 我们的 New space 与 tab 栏曾经的 home 命名)都算未命名。
  nameOf(w, g, at) {
    if (!at) return w.name;
    return spaceName(w, { at, repo: g?.name ?? null, home: home(), named: Boolean(w.named) });
  }

  // 每个 space,各自 machine 上按用户拖入的顺序(shared 的 "spaces-chat".order,web 的
  // 同样适用:core/spaces.js 的 inOrder),其余用 Herdr 的。
  sorted() {
    return inOrder(spaces(), data().order);
  }

  // 显示的 spaces,按侧栏顺序,各带 git、位置与名称:{ w, i (Herdr's index), g,
  // at、name }。
  visible() {
    const sp = this.sorted(), ps = panes(), herdr = spaces();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    return sp.filter((w) => this.shown.has(w.id)).map((w) => {
      const g = this.git[where(w, ps)] ?? null, at = place(w, ps);
      return { w, i: herdr.indexOf(w), g, at, name: this.nameOf(w, g, at) };
    });
  }

  // `list` 保持顺序,主 checkout 同在其内的 worktree space 移到其名下。
  // herdr-winapp 设置 “Worktrees in the sidebar” 关闭(shared "sidebar.worktrees" 为 false):相关
  // 嵌套的 worktree space 不列出,当前正在查看的除外。
  ordered(list = this.visible()) {
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const hide = shared("sidebar.worktrees") === false;
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    list = list.filter((r) => !hide || !nested(r) || r.w.active);
    const out = [];
    const placed = new Set(); // 其 worktrees 被列出的 repo(位于其首个 space 之下)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    return out;
  }

  // 各行排列在机器标题之下,一旦有不只本机的机器就按机器分组。
  // Pinned 的 space(sections.js)改放在顶部的 Pinned 中(不在 rail 上)。
  grouped(t, collapsed) {
    const visible = this.visible();
    // 同一 machine 上两个 space 共用的名字(其 repo 下的 worktree 除外:会显示分支)。
    this.dup = sharedNames(visible.map((r) => ({ id: r.w.id, machine: r.w.machine, name: r.name, linked: Boolean(r.g?.linked) })));
    const pins = collapsed ? [] : data().pinned;
    const all = visible.filter((r) => !pins.includes(r.w.id));
    const rows = this.ordered(all);
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    // 机器的 space:未分组的前置,然后是各分组(rail 中没有分组)。
    const body = (m, mine) => (collapsed ? mine.map(draw) : this.sectioned(m, all.filter((r) => (r.w.machine ?? null) === m), t));
    // hc 列出的其他 machine(与 web 应用一致),然后是仅被某 space 提到的
    const remote = [...new Set([...this.machines.map(m => m.name), ...rows.map(r => r.w.machine).filter(Boolean)])];
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).flex().items_center().text_size(TEXT.label).text_color(t.dim).child(collapsed ? "…" : "加载中…");
    const pinned = this.pinned(visible, pins, Boolean(remote.length), t);
    if (!remote.length) return [...pinned, ...(loading(null) && !rows.length && !pinned.length ? [loadingRow(null)] : body(null, rows))];
 // 按用户拖拽后的顺序,所有设备和 web 应用一致
    const machineNames = machinesInOrder([null, ...remote], machineOrderOf(data())).map((k) => k || null);
    this.machineOrder = machineNames;
    return [...pinned, ...machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      // 尚不可知(hc 未应答):既不算已连接也不算离线。
      const state = !m ? "connected" : machine?.state ?? (this.machinesRead ? "unreachable" : null);
      const connected = state === "connected";
      const offline = state !== null && !connected;
      // 离线时默认折叠;点击可临时展开。
      const folded = offline ? !this.openOffline.has(m) : this.folded.has(m);
      const health = this.stats?.[m ?? ""];
      // space 拖放到其 machine 的 header 上即脱离所在 section,回到顶部。
      const out = this.pressed && (sectionOf(this.pressed) || data().pinned.includes(this.pressed)) && this.over === `top:${m}`;
      // 机器标题:其分组的标题(12 号、medium、文本色),位于其各分区之上
      // 与 spaces。已连接:显示其 +(New space、New section)与计量条;仅当其
      // 无法读取健康状态。离线:只显示“离线”字样,置灰,别无其他。
      const head = h_flex().relative().id(`machine-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 2 : 8).gap(7).items_center()
        .rounded(RADIUS.card).text_size(TEXT.label).font_medium().text_color(offline ? t.dim : t.foreground)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (offline) this.openOffline.has(m) ? this.openOffline.delete(m) : this.openOffline.add(m);
          else {
            folded ? this.folded.delete(m) : this.folded.add(m);
            localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          }
          cx.notify();
        })
        .on_mouse_move((_e, cx) => { this.drag(`top:${m}`, m, cx); this.dragMachine(m, cx); })
        // 按住 header 拖动可在 machines 间移动,其 spaces 随行;按下而不移动则折叠(on_click)
        .on_mouse_down("left", () => { this.movingMachine = m; this.machineOver = m; })
        .on_mouse_down("right", (e) => openMenu("machine", { machine: m, row: rectOf(e), order: machineNames }))
        .when(out, el => el.child(this.line(t, "bottom")))
        .when(this.movingMachine === m && this.machineOver !== m, el => el.opacity(0.5))
        .when(this.movingMachine !== undefined && this.movingMachine !== m && this.machineOver === m,
          el => el.child(this.line(t, machineNames.indexOf(this.movingMachine) < machineNames.indexOf(m) ? "bottom" : "top")))
        // 其 emoji,或 server / monitor;以及被赋予的名字(Rename),否则用它自己的。
        .child(machineLook(m).icon
          ? div().w(14).flex_none().flex().justify_center().text_size(12).when(offline, el => el.opacity(0.5)).child(machineLook(m).icon)
          : svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(14).flex_none().text_color(offline ? t.dim : t.muted))
        .when(!collapsed, el => el.child(div().flex_1().min_w(0).truncate().child(machineLook(m).name))
          .when(offline, el => el.child(div().flex_none().font_normal().child(state === "connecting" ? "Connecting\u2026" : "Offline")))
 // +(New space 或 New section,在那边)紧贴其单个 meter。。
          .when(connected, el => el.child(h_flex().flex_none().gap(2).items_center()
            .child(div().id(`machine-add-${m ?? "local"}`).size(20).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
              .text_color(t.muted).cursor_pointer().hover(s => s.bg(t.raised).text_color(t.foreground))
              .on_mouse_down("left", (e) => { this.addAt = rectOf(e); })
              .on_click((_e, cx) => { cx.stop_propagation(); this.addMenu(m); })
              .child(svg("mods/workspace-chrome/plus.svg").size(14)))
            .child(this.meter(m, t))))
          .when(connected && Boolean(health?.error), el => el.child(div().id(`machine-dot-${m ?? "local"}`).size(6).rounded(3).flex_none().bg(red())))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.dim)));
      const own = !collapsed && sectionsOf(m).length;
      // 空的 machine 只剩 header:其 + 可创建 space。
      return [head, ...(folded ? [] : mine.length || own ? body(m, mine) : loading(m) ? [loadingRow(m)] : [])];
    })];
  }

  // 机器的健康状况(CPU、内存、磁盘)为一组细条,有新任务排队时呈琥珀色
 // 超过告警上限变红。旁边不显示 %:数值与剩余 plan 在
 // 点击打开的详情(machine-popup.js)。、。
  // `this.stats`:每次 render 读一次(render()),因为每次读取都会复制所有机器的数据。
  meter(m, t) {
    const s = this.stats?.[m ?? ""];
    const id = `machine-meter-${m ?? "local"}`;
    if (!s?.health) return div().id(id);
    const meters = healthMeters(s);
    return h_flex().id(id).flex_none().h(20).px(4).gap(4).items_center().rounded(RADIUS.control).cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_mouse_down("left", (e) => { this.meterAt = rectOf(e); })
      .on_click((_e, cx) => { cx.stop_propagation(); openMachine(m, this.meterAt); })
      .child(bars(t, meters, 11, `${id}-health`));
  }

  // Pinned,同 herdr-winapp:形如 section 的标题(带 pin,无菜单),只要其中还有…就显示
  // 有则列出,其后按各自顺序列出其 spaces;存在多台时名称后附其机器
  // 有多个。折叠时仍显示当前所在的 space 及其未读项。
  pinned(list, pins, many, t) {
    const byId = new Map(list.map((r) => [r.w.id, r]));
    const members = pins.map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) return [];
    const open = !data().pinnedFolded || (this.pressed !== null && this.peek === "pinned");
    const needs = open ? 0 : members.reduce((n, r) => n + this.needs(r.w), 0);
    const ready = open ? 0 : members.reduce((n, r) => n + this.readyIn(r.w), 0);
    const head = this.groupHead("section-pinned", t)
      .on_click(() => foldPinned())
      .on_mouse_move((_e, cx) => this.drag("pinned", ANY, cx))
      .child(div().w(18).flex_none().flex().justify_center().child(svg("mods/workspace-chrome/pin.svg").size(14)))
      .child(div().flex_1().min_w(0).truncate().child("Pinned"))
      .when(needs > 0 || ready > 0, (el) => el.child(countBadge(needs, ready, t.chrome)))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
      .when(this.pressed !== null && this.over === "pinned" && !open, (el) => el.child(this.line(t, "bottom")));
    const shown = open ? members : members.filter((r) => r.w.active || this.unread.has(r.w.id));
    return [head, ...shown.map((r, n) => this.row({ ...r, tree: null, pinned: true, tag: many ? machineLook(r.w.machine ?? null).name : null,
      end: open && n === shown.length - 1 ? "pinned" : null }, t))];
  }

  // + 菜单挂在其按钮下方:右缘与按钮右缘对齐。
  addMenu(m) {
    const r = this.addAt;
    openMenu("add", { machine: m }, r ? { x: Math.max(8, r.x + r.width - 210), y: r.y + r.height + 4 } : "pointer");
  }

  // 一台 machine 的行(`list`:其显示的 spaces,按 Herdr 顺序):不在
  // 分区,然后是各分区的 header 及(未折叠时)其 spaces 的顺序。
  sectioned(m, list, t) {
    const sections = sectionsOf(m);
    const byId = new Map(list.map((r) => [r.w.id, r]));
    const filed = new Set(sections.flatMap((s) => s.spaces));
    const out = this.ordered(list.filter((r) => !filed.has(r.w.id))).map((r) => this.row(r, t));
    for (const s of sections) {
      const members = s.spaces.map((id) => byId.get(id)).filter(Boolean);
      const open = !s.folded || (this.pressed !== null && this.peek === s.id);
      out.push(this.sectionHead(s, members, t, open));
      // 折叠时仍显示当前所在 space 及其未读的,与 Slack 一致。
      const shown = this.ordered(open ? members : members.filter((r) => r.w.active || this.unread.has(r.w.id)));
      // 拖到 header 上的 space 移到 section 末尾:指示线显示在其最后一行之下。
      shown.forEach((r, n) => out.push(this.row({ ...r, end: open && n === shown.length - 1 ? `section:${s.id}` : null }, t)));
      if (open && !members.length) out.push(this.emptySection(s, t));
    }
    return out;
  }

  sectionHead(s, members, t, open) {
    const needs = open ? 0 : members.reduce((n, r) => n + this.needs(r.w), 0);
    const ready = open ? 0 : members.reduce((n, r) => n + this.readyIn(r.w), 0);
    // 悬停其上时,指示线显示 space 的落点:在 section 最后一行之下("Drag spaces
    // 此处”)为空时),或 header 折叠时显示在其下方。
    const line = this.pressed !== null && this.over === `section:${s.id}` && !open;
    return this.groupHead(`section-${s.id}`, t)
      .on_click(() => foldSection(s.id))
      .on_mouse_down("right", (e) => openMenu("section", { section: s.id, row: rectOf(e) }))
      .on_mouse_move((_e, cx) => this.drag(`section:${s.id}`, s.machine, cx))
      // 它在 spaces "#" 列中的图标:文件夹,或为其挑选的 emoji。
      .child(div().w(18).flex_none().flex().justify_center()
        .child(s.icon ? div().text_size(13).child(s.icon) : svg("mods/workspace-chrome/folder.svg").size(14)))
      .child(div().flex_1().min_w(0).truncate().child(s.name))
      .when(needs > 0 || ready > 0, (el) => el.child(countBadge(needs, ready, t.chrome)))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
      .when(line, (el) => el.child(this.line(t, "bottom")));
  }

  // machine 内 section 或 Pinned 的标题:它在 spaces "#" 列中的图标,以及其
  // 其名称起点重合(读起来像 machine 的一部分),12 号、medium、淡色。
  groupHead(id, t) {
    return h_flex().relative().id(id).h(28).flex_none().px(8).gap(9).items_center().rounded(RADIUS.card)
      .text_size(TEXT.label).font_medium().text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover));
  }

  emptySection(s, t) {
    return h_flex().relative().id(`section-empty-${s.id}`).h(28).flex_none().px(8).gap(9).items_center().text_size(TEXT.label).text_color(t.dim)
      .on_mouse_move((_e, cx) => this.drag(`section:${s.id}`, s.machine, cx))
      .child(div().w(18).flex_none())
      .child("把空间拖到这里")
      .when(this.pressed && this.over === `section:${s.id}`, (el) => el.child(this.line(t, "top")));
  }

  // 被拖动 space 的落点。
  line(t, edge) {
    return div().absolute().left(0).right(0).h(2).bg(t.accent).when(edge === "top", (l) => l.top(0)).when(edge === "bottom", (l) => l.bottom(0));
  }

  // 按住 space 的指针悬停在其落点上:仅在本机上,不过
  // Pinned(machine 为 ANY)可匹配任何 machine 的。
  drag(over, machine, cx) {
    if (this.pressed === null) return;
    const from = spaces().find((s) => s.id === this.pressed);
    const next = from && (machine === ANY || (from.machine ?? null) === (machine ?? null)) ? over : null;
    // 悬于折叠 section 的 header 上时,该 section 展开直到放下;悬于另一 section 上时,展开的则是那个。
    const sec = next === "pinned" ? "pinned" : next?.startsWith("section:") ? next.slice(8) : null;
    const shut = sec === "pinned" ? data().pinnedFolded : sectionsOf(machine).find((s) => s.id === sec)?.folded;
    const peek = sec && shut ? sec : sec ? null : this.peek;
    if (this.over !== next || this.peek !== peek) {
      this.over = next;
      this.peek = peek;
      cx.notify();
    }
  }

  // 机器 header 拖到另一台之上:目标行显示落点。
  dragMachine(m, cx) {
    if (this.movingMachine === undefined || this.machineOver === m) return;
    this.machineOver = m;
    cx.notify();
  }

  // 松开:未移动的按压即选中该 space;否则放到指示线处。machine 会取代
  // 它被放置的目标(shared "spaces-chat".machineOrder,core/spaces.js 的 withMachineOrder)。
  release(cx) {
    const mm = this.movingMachine, mo = this.machineOver;
    this.movingMachine = this.machineOver = undefined;
    if (mm !== undefined && mo !== undefined && mm !== mo && this.machineOrder) {
      const order = this.machineOrder.filter((k) => k !== mm);
      order.splice(this.machineOrder.indexOf(mo), 0, mm);
      setShared("spaces-chat", withMachineOrder(data(), order));
    }
    const from = this.pressed, over = this.over;
    this.pressed = null;
    this.over = null;
    this.peek = null;
    if (from !== null && over === `space:${from}`) run("space.select", { id: from });
    else if (from !== null && over) this.drop(from, over);
    cx.notify();
  }

  // 被拖动项落在 space 行的上缘还是下缘:从上方来落在下方
  // 在同一列表中,否则在其上方。
  edge(from, to) {
    const pins = data().pinned;
    if (pins.includes(to)) {
      const a = pins.indexOf(from);
      return a >= 0 && a < pins.indexOf(to) ? "bottom" : "top";
    }
    const sec = sectionOf(to);
    if (sec) {
      const a = sec.spaces.indexOf(from);
      return a >= 0 && a < sec.spaces.indexOf(to) ? "bottom" : "top";
    }
    // 顶部,按 sidebar 的顺序(sorted())。
    const sp = this.sorted();
    return sp.findIndex((s) => s.id === from) < sp.findIndex((s) => s.id === to) ? "bottom" : "top";
  }

  // 移入 Pinned(其标题之下、其 spaces 之中),或从中移出到任意位置。
  drop(from, over) {
    if (over === "pinned") return pin(from);
    const cut = over.indexOf(":");
    const kind = over.slice(0, cut), id = over.slice(cut + 1);
    const pins = data().pinned;
    if (kind === "space" && pins.includes(id)) {
      if (id === from) return;
      const at = pins.filter((x) => x !== from).indexOf(id);
      return pin(from, true, this.edge(from, id) === "bottom" ? at + 1 : at);
    }
    if (pins.includes(from)) pin(from, false);
    if (kind === "section") placeSpace(from, id);
    else if (kind === "top") placeSpace(from, null);
    else if (kind === "space" && id !== from) {
      const sec = sectionOf(id);
      if (sec) {
        const at = sec.spaces.filter((x) => x !== from).indexOf(id);
        placeSpace(from, sec.id, this.edge(from, id) === "bottom" ? at + 1 : at);
      } else {
        const edge = this.edge(from, id);
        if (sectionOf(from)) placeSpace(from, null);
 // 新排序,存入侧栏数据以便 web 与每台设备显示一致:机器的
        // spaces 按显示顺序,本 space 落到被放置目标旁边。
        const w = spaces().find((s) => s.id === from);
        const shown = this.sorted().filter((s) => (s.machine ?? null) === (w?.machine ?? null)).map((s) => s.id);
        const rest = shown.filter((x) => x !== from), at = rest.indexOf(id);
        if (w && at >= 0) {
          rest.splice(edge === "bottom" ? at + 1 : at, 0, from);
          setShared("spaces-chat", withOrder(data(), w.machine ?? null, rest, shown));
        }
        // 以及 Herdr 自己的顺序:space.move 把目标放到指定位置(从 1 起数),其余项向其原位置收拢。
        const i = spaces().findIndex((s) => s.id === id);
        if (i >= 0) run("space.move", { id: from, index: i + 1 });
      }
    }
  }

  // space 中需要用户处理的事项(计红色数),以及处于 Ready 的任务(计绿色
  // 计数(herdr-winapp settings 的 "Red counts" / "Green counts" 关闭时无:shared
  // "counts.red" / "counts.green" 为 false)。
  needs(w) {
    if (shared("counts.red") === false) return 0;
    const m = countsByTab();
    return w.tabs.reduce((n, tab) => n + (m.get(tab.id) ?? 0), 0);
  }

  readyIn(w) {
    if (shared("counts.green") === false) return 0;
    const m = readyByTab();
    return w.tabs.reduce((n, tab) => n + (m.get(tab.id) ?? 0), 0);
  }

  // 名字后只留非常规部分:"herdr · spike"。repo 或
  // 名称已说明分支时省去分支名(worktree 以其分支命名),
  // 与 master/main 一并忽略:几乎每个 space 都在其中之一。
  gitTail(g, tree, name, t, tag) {
    // 文案来自 shared core(web 的行同样如此)
    const { where } = gitTail(g, { name, tree: Boolean(tree), tag });
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(TEXT.label)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)));
  }

  // `pinned`:位于 Pinned,`tag` 标记其在该处的机器;`end`:拖动键(分区的、Pinned 的)一
  // 落在该末行之下的拖放归它所有。
  row({ w, i, g, tree, end, pinned, tag, at, name }, t) {
    const on = w.active;
    // 本机另一个 space 占用了这个名字:用变淡的文件夹路径加以区分。
    const label = [tag, this.dup?.has(w.id) && at ? tilde(at) : null].filter(Boolean).join(" \u00b7 ") || null;
    const fresh = this.unread.has(w.id);
    // Notify Off(notify.js):静音,同 Slack 的已静音频道:变淡、铃铛加斜杠;其
    // 计数仍然显示。
    const quiet = muted(w.id);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(RADIUS.card)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== `space:${w.id}`, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.pressed !== w.id && this.over === `space:${w.id}`, (el) => el.child(this.line(t, this.edge(this.pressed, w.id))))
      .when(this.pressed !== null && end && this.over === end, (el) => el.child(this.line(t, "bottom")))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = `space:${w.id}`;
      })
      .on_mouse_move((_e, cx) => this.drag(`space:${w.id}`, pinned ? ANY : w.machine, cx))
      .on_mouse_down("right", (e) => this.menu(w, g, name, e))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          // 仿 Slack 的频道:低调的 # 与名字,当前 space 时提亮。
          // 或为其挑选的 emoji(Change icon),占同一位置,使名字保持对齐。
          .when(!tree, el => el.child(div().w(18).flex_none().text_center().text_size(iconOf(w.id) ? 14 : 15).text_color(fresh ? t.foreground : w.active && !quiet ? t.muted : t.dim)
            .when(quiet && Boolean(iconOf(w.id)), (el) => el.opacity(0.5)).child(iconOf(w.id) ?? "#")))
          .child(nameText(name, fresh, quiet ? t.dim : w.active ? t.foreground : t.muted, t))
          .when(Boolean(this.pilotMark(w, t)), (el) => el.child(this.pilotMark(w, t)))
          .child(g ? this.gitTail(g, tree, name, t, label) : h_flex().flex_1().min_w(0).justify_end().text_size(TEXT.label).text_color(t.dim)
            .when(Boolean(label), (el) => el.child(div().min_w(0).truncate().child(label))))
          .when(quiet, (el) => el.child(svg("mods/spaces-chat/bell-off.svg").size(13).flex_none().text_color(t.dim)))
          // 本 space 中需要用户处理的事项(各 tab 的 Inbox 条目),红色,以及其
          // Ready 状态的任务,绿色。
          .when(this.needs(w) > 0 || this.readyIn(w) > 0, el => el.child(countBadge(this.needs(w), this.readyIn(w), on ? t.selected : t.chrome))),
      );
  }

  // 侧栏行的内容:其编号与状态(语音通话显示在侧栏顶部,voiceRow)。
  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .items_center()
      .gap(4)
      .rounded(RADIUS.card)
      .cursor_pointer()
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(nameText(String(i + 1), this.unread.has(w.id), muted(w.id) ? t.dim : w.active ? t.foreground : t.muted, t))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  close() { this.popup?.close?.(); }

  // 整个 render 共用一份 Herdr 实时列表副本(live.js):超过约 50 毫秒 Herdr 会中止它。
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    if (this.popup) return this.popup.render(cx);
    const t = theme();
    const collapsed = narrow();
    this.stats = collapsed ? null : allStats();
    prune();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    // 有新内容的 Assistant;屏幕上可见的现在就读取。
    readShown();
    // herdr-winapp 设置 “Bold unread spaces” 关闭(shared "sidebar.unread" 为 false):不加粗。
    this.unread = shared("sidebar.unread") === false ? new Set() : unreadSpaces(sp);
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(TEXT.label).font_medium().text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        // 如同 machine 的 +:New space、New section,作用于当前显示 space 的 machine。
        .child(div().id("space-new").size(H.sm).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer()
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (e) => { this.addAt = rectOf(e); })
          .on_click(() => this.addMenu(sp.find(s => s.active)?.machine ?? null))
          .child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => this.release(cx))
        .children(this.grouped(t, collapsed)));
  }
}
