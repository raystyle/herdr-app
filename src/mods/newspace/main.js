// New space,在本机或另一台 machine:由 coordinator.js 的 newSpace 打开 dialog(
// + 菜单、Spaces 侧边栏的 +、机器的 + 及其中的 New space、Ctrl+Shift+N,经由 tab
// 栏),先查该机器的最近文件夹与 home(props { recent, machine, home })。
// 有两台及以上机器开机且可达时,Machine 选择排在最前(core/newspace.js
// 可达、startMachine):在为它打开的那台 machine 上启动,另一台则启动
// 文件夹,取自该机器的 home 与最近文件夹。仅一台时不显示。
// 它绘制自己的 panel(frame "none"),居中,高度随内容;尺寸为
// // coordinator.js 的 NEWSPACE。
// 在另一台 machine 上,文件夹在那边查找,Browse… 列出输入框文件夹的
// 字段下方的子文件夹(系统没有对应选择器):点击进入其中。
// 输入框是唯一依据:其中是创建 space 的文件夹。选中一行(点击、
// 箭头)或 Choose folder… 会把该文件夹填入;输入可编辑并过滤列表。该行
// 完全匹配的行即为选中项。无行对应的输入路径先给一条 "Use …" 行,
// 尚不存在的文件夹则给出 "New folder" 行(Create 时创建)。起始位置为
// 用户当前工作处(defaultFolder),绝不是 builder 的 scratch 文件夹。
// 输入框左侧是 space 的图标:在 Rename dialog 自身的…选了 emoji 之前显示 "#"
// 选择器(mods/spaces-chat 的 icon.js,作为该 mod 的 popup 打开;其选择经
// shared "spaces-chat.iconpick"),随 Rename 保存时一并保存到新 space(coordinator.js
// createSpace)。
// 只询问文件夹和图标(DECISIONS.md,New space dialog):每个新 space 打开时都带
// Assistant 聊天,依据 herdr-winapp settings 的 coordinator(否则用 CLI 默认);用户可修改
// 聊天自身模型按钮中的模型。任务 ID 同样不在此询问:由 herdr-task 选定
// 文件夹前缀,coordinator 可以修改(只有 agent 会建任务)。
// 不在 git 仓库中的文件夹(Create 时新建的也算,home 除外)提供 "Make it a git
// repo",默认开启(herdr-winapp 会把每个此类文件夹当作 repo):Create 在 main 上执行 git init,并
// 一个空的首次提交,好让任务能建 worktree;已有文件保持未提交状态。该行
// 字段下方始终保留空间,字段变化时其他元素不动。
// Create space 由 tab bar 在输入框的文件夹中创建 space 及其 Assistant tab
// (coordinator.js createSpace),并落入其中;assistant 在首条消息时启动。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Popup } from "gpui-base";
import { props, theme, home, exec, pickFolder, closeOverlay, openOverlay, shared, setShared, focused, machines } from "herdr";
import { keepKeys, dropKeys } from "./keyholder.js";
import { spaces, inRender } from "./live.js";
import { dialogFooter, button, TEXT, RADIUS } from "./ui.js";
import { NEWSPACE as K, readWinapp, winappFor, LOCAL_MACHINE, autoCoordinator, recentFolders, homeOf } from "./coordinator.js";
import * as N from "./core/newspace.js";
import * as S from "./core/spaces.js";

// 建议项的宽度(与输入框同宽:对话框 460 减去内边距、图标、Browse… 与各间隔)。
const LIST_W = 290;
// Machine 选择的宽度(面板宽 460 减去内边距)。
const MACHINE_W = 424;
// 机器(null:本机)在侧边栏中的呈现(mods/spaces-chat sections.js machineLook):
// 未改名时用原名,配其 emoji,无则用其 server 或 monitor 图标。
const lookOf = (m) => { const l = shared("spaces-chat")?.machines?.[m ?? ""] ?? {}; return { name: l.name || (m ?? "本机"), icon: l.icon ?? null }; };
// 可创建 space 的机器:本机与每台已连接的机器(coordinator.js newSpace 的选择逻辑)。
// 按 sidebar 的顺序(shared 的 "spaces-chat".machineOrder,)。
const reachableMachines = () => {
  const list = [{ key: null, on: true }, ...machines().filter((m) => m.name).map((m) => ({ key: m.name, on: m.layout === "ready" }))];
  const keys = S.machinesInOrder(list.map((m) => m.key), S.machineOrderOf(shared("spaces-chat")));
  return N.reachable(keys.map((k) => list.find((m) => (m.key ?? "") === k)));
};
// icon picker 的回答(mods/spaces-chat rename.js PICK):{ for(本 overlay)、emoji、at }。
const PICK = "spaces-chat.iconpick";
// home 文件夹路径的来源:对话框所选机器的(props.home)。
let HOME = home();
// builder 的临时文件夹、来自 HOME 的路径、新 repo(main,一个空 commit)、某文件夹的
// 子文件夹与文案:core/newspace.js,与 web 应用的 New space 共享。
const tilde = (p) => N.tilde(p, HOME);
const base = (p) => N.base(p, HOME);
const pathOf = (text) => N.pathOf(text, HOME);
const { scratch, parent, NEW_REPO, SUBFOLDERS, WORDS: W } = N;

// 对话框打开期间持有键盘的一方(keyholder.js)。
const HOLDER = "dialog:newspace";

export default class NewSpace extends View {
  init(_props, cx) {
    this.machine = props()?.machine ?? null; // null:本机
    this.machineOpen = false; // Machine 选择器的列表
    this.switching = false; // 另一台机器的文件夹,正在查找中
    HOME = props()?.home ?? home();
    this.recent = (props()?.recent ?? []).filter((p) => !scratch(p));
    this.browse = null; // 另一台机器的 Browse…:{ dir, rows }(列举期间 rows 为 null)
    this.extra = []; // 从“选择文件夹…”选出的文件夹,排在最前
    this.exists = new Map(this.recent.map((p) => [p, true]));
    this.repo = new Map(); // 文件夹 → 是否在 git repo 中(null:询问失败)
    this.makeRepo = true; // "Make it a git repo",在提供该选项的地方
    this.listOpen = false; // 字段下方的建议列表
    this.hi = -1; // Up/Down 当前指向的建议项
    this.busy = false;
    this.error = "";
    this.icon = null; // 一个 emoji,null 时为 "#"
    this.picked = shared(PICK)?.at ?? 0;
    this.input = InputState.new({ placeholder: W.placeholder, value: tilde(this.defaultFolder()) });
    this.text = this.input.value();
    // 输入即展开建议项(combobox):选中一项或按 Esc 时关闭。
    this.input.on("change", (_e, cx) => {
      const v = this.input.value();
      if (v === this.text) return;
      this.text = v; this.listOpen = true; this.browse = null; this.hi = -1; this.error = ""; this.check(cx); cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.enter(cx));
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    // 对话框打开期间键盘归它所有:其后的聊天不收回任何按键(#752)。
    keepKeys(HOLDER);
    cx.timer.every(2000, () => { if (!this.closed) keepKeys(HOLDER); });
    this.check(cx);
  }

  // 用户当前工作处:聚焦 pane 的文件夹,否则取当前 space 的;按其 repo 的
  // 顶部(若那是最近文件夹)。scratch 文件夹,或位于另一台 machine 的 space
  // 对话框的:该机器的 home。
  defaultFolder() {
    const here = spaces().find((s) => s.active);
    if ((here?.machine ?? null) !== this.machine) return HOME;
    const at = [focused()?.cwd, here?.folder].find((p) => p && !scratch(p));
    if (!at) return HOME;
    return this.recent.find((r) => at === r || at.startsWith(r + "/")) ?? at;
  }

  // 输入框文件夹是否存在、是否在 git repo 中,每条路径只询问一次。
  check(cx) {
    const p = pathOf(this.text);
    if (!p || this.repo.has(p)) return;
    this.repo.set(p, undefined);
    // 切走的 machine 的应答会被丢弃(switchTo 会建立新的 map)。
    const exists = this.exists, repo = this.repo;
    cx.spawn(async (cx) => {
      if (exists !== this.exists) return;
      if (!this.exists.has(p) || this.exists.get(p) === undefined) {
        this.exists.set(p, undefined);
        this.exists.set(p, (await exec("test", ["-d", p], this.on()).catch(() => ({ code: 1 }))).code === 0);
        cx.notify();
      }
      if (exists !== this.exists) return;
      if (!this.exists.get(p)) { this.repo.set(p, false); return cx.notify(); }
      const r = await exec("git", ["rev-parse", "--is-inside-work-tree"], { ...this.on(), cwd: p }).catch(() => null);
      if (repo !== this.repo) return;
      // 那边没有 git 可问:什么都不提供。
      this.repo.set(p, r ? r.code === 0 && r.stdout.trim() === "true" : null);
      cx.notify();
    });
  }

  // 输入框文件夹是否显示 "Make it a git repo":已确认不在 git 中,且不是 home。
  offersRepo() {
    const p = this.folder();
    return N.offersRepo(p, this.repo.get(p), HOME);
  }

  // 选中另一台 machine:先显示其 home 和 recent folders,然后文件夹从那边开始浏览。
  switchTo(m, cx) {
    this.machineOpen = false;
    if (m === this.machine || this.busy || this.switching) return cx.notify();
    this.switching = true; this.switchingTo = m; this.listOpen = false; this.browse = null; this.hi = -1; this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const [recent, at] = await Promise.all([recentFolders(m).catch(() => []), homeOf(m).catch(() => null)]);
      this.switching = false;
      if (!at) { this.error = `Couldn't reach ${lookOf(m).name}.`; return cx.notify(); }
      this.machine = m; HOME = at;
      this.recent = recent.filter((p) => !scratch(p));
      this.extra = []; this.exists = new Map(this.recent.map((p) => [p, true])); this.repo = new Map(); this.makeRepo = true;
      this.text = tilde(this.defaultFolder());
      this.input.set_value(this.text);
      this.check(cx);
      this.input.focus();
      cx.notify();
    });
  }

  // Machine 选择:一个形似输入框的按钮,显示机器的图标与名称,列表位于其下方。
  machineChoice(t, keys) {
    const look = lookOf(this.machine);
    const iconOf = (m, l) => (l.icon ? div().w(14).flex_none().flex().justify_center().text_size(12).child(l.icon)
      : svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(14).flex_none().text_color(t.muted));
    const field = h_flex().id("machine").w_full().h(K.field).px(10).gap(8).items_center().rounded(RADIUS.control).border(1)
      .border_color(this.machineOpen ? t.accent : t.input).bg(t.background).text_color(t.foreground).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.listOpen = false; this.browse = null; this.machineOpen = !this.machineOpen; cx.notify(); })
      .child(iconOf(this.machine, look))
      .child(div().flex_1().min_w(0).truncate().child(this.switching ? `${lookOf(this.switchingTo).name}…` : look.name))
      .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none().text_color(t.muted));
    return Popup.new("machine-list", field).w_full().anchor("top_left")
      .when(this.machineOpen, (el) => el.content(v_flex().id("machine-rows").w(MACHINE_W).mt(4).p(4).rounded(8).border(1).border_color(t.border).bg(t.popover).shadow_lg().text_size(13)
        .children(keys.map((m, i) => {
          const l = lookOf(m);
          return h_flex().id(`machine-${i}`).h(K.row).flex_none().px(9).gap(10).rounded(6).items_center().cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.switchTo(m, cx); })
            .child(iconOf(m, l))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(l.name))
            .child(div().size(14).flex_none().when(m === this.machine, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).text_color(t.foreground))));
        }))));
  }

  // exec 的执行位置:对话框所选机器。
  on() {
    return this.machine ? { on: this.machine } : {};
  }

  // 把文件夹填入输入框并关闭建议列表。
  set(path, cx) {
    this.text = tilde(path);
    this.input.set_value(this.text);
    this.listOpen = false;
    this.browse = null;
    this.hi = -1;
    this.error = "";
    this.check(cx);
    cx.notify();
  }

  // 建议项:匹配输入内容的最近文件夹(输入为空时全部),至多
  // 多数沿用 core 的 SHOWN(coordinator.js 的 NEWSPACE_SHOWN,即高度),字段自身文件夹除外。
  rows() {
    if (this.browse) return this.browse.rows ?? [];
    const all = [...this.extra, ...this.recent.filter((p) => !this.extra.includes(p))];
    return N.suggestions(all, this.text, HOME).map((path) => ({ path }));
  }

  // Create space 创建 space 所用的文件夹:即输入框中的值,待确认其是否存在
  // (缺失时在 Create 时创建)。
  folder() {
    const p = pathOf(this.text);
    return p && typeof this.exists.get(p) === "boolean" ? p : null;
  }

  close() {
    this.closed = true;
    dropKeys(HOLDER);
    closeOverlay(props().overlay);
  }

  // Browse…:本机用系统文件夹选择器;在另一台 machine 上,则列出输入框文件夹的子文件夹。
  choose(cx) {
    if (this.machine) {
      const p = pathOf(this.text);
      return this.list(p && this.exists.get(p) ? p : HOME, cx);
    }
    cx.spawn(async (cx) => {
      const f = await pickFolder({ prompt: "Choose" });
      if (f) { this.exists.set(f, true); if (!this.recent.includes(f)) this.extra = [f, ...this.extra.filter((x) => x !== f)]; this.set(f, cx); }
      this.input.focus();
      cx.notify();
    });
  }

  // 另一台 machine 的 Browse…:输入框里的 `dir`,其子文件夹列在下方(以及上级文件夹
  // 在前),列表保持展开,点击可继续选入一项。
  list(dir, cx) {
    this.exists.set(dir, true);
    this.text = tilde(dir);
    this.input.set_value(this.text);
    this.browse = { dir, rows: null };
    this.listOpen = true;
    this.hi = -1;
    this.error = "";
    this.input.focus();
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", SUBFOLDERS, "x", dir], this.on()).catch(() => null);
      if (this.browse?.dir !== dir) return;
      if (!r || r.code !== 0) { this.browse = null; this.listOpen = false; this.error = W.cantList(tilde(dir), this.machine); return cx.notify(); }
      const kids = r.stdout.split("\n").filter(Boolean).map((n) => `${dir.replace(/\/+$/, "")}/${n}`);
      for (const k of kids) this.exists.set(k, true);
      this.browse.rows = [...(dir === "/" ? [] : [{ path: parent(dir), up: true }]), ...kids.map((path) => ({ path }))];
      cx.notify();
    });
  }

  // 选中某条建议:填入输入框;浏览时,列表继续深入该目录。
  pick(path, cx) {
    if (this.browse) return this.list(path, cx);
    this.set(path, cx);
  }

  // icon picker,位于图标按钮下方(at:按钮位置,取自对它的点击)。
  pickIcon(at) {
    this.listOpen = false; this.browse = null; this.hi = -1;
    openOverlay({ mod: "spaces-chat", kind: "popup", width: 360, height: 420, at: at ? { x: at.x, y: at.y + at.height + 4 } : "pointer",
      props: { view: "icon", for: props()?.overlay, current: this.icon, section: false, width: 360, height: 420 } });
  }

  // Enter 选中高亮建议,否则创建 space。
  enter(cx) {
    const rows = this.listOpen ? this.rows() : [];
    if (this.hi >= 0 && rows[this.hi]) return this.pick(rows[this.hi].path, cx);
    this.create(cx);
  }

  create(cx) {
    const folder = this.folder();
    if (this.busy || !folder) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (this.exists.get(folder) === false) {
          const r = await exec("mkdir", ["-p", "--", folder], this.on());
          if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || W.cantMake(tilde(folder)));
          this.exists.set(folder, true);
        }
        if (this.offersRepo() && this.makeRepo) {
          for (const args of NEW_REPO) {
            const r = await exec("git", args, { ...this.on(), cwd: folder });
            if (r.code !== 0) throw new Error(W.cantRepo(r.stderr.trim().split("\n").pop()));
          }
          this.repo.set(folder, true);
        }
        // herdr-winapp 设置中的 coordinator(优先该 space 所属 machine 的,否则 Everywhere 的)已设置时;{}:
        // 模板自身的 agent。在另一台 machine 上 Assistant 在那边运行(mods/chat
        // startAgent),所选 CLI 未安装时用那边已有的。
        const choice = { ...(winappFor(await readWinapp(), `m:${this.machine ?? LOCAL_MACHINE}`).coordinator ?? {}) };
        // 由 tab 栏创建(coordinator.js watchNewSpaces):view 移动时本对话框随之移动。
        // herdr-winapp 设置 “Open the Assistant” 关闭(shared "coordinator.auto" 为 false):设置
        // 为 null,该 space 保留 Herdr 自己的首个 tab,且不配 Assistant。
        const assistant = autoCoordinator();
        setShared("newspace.createreq", { folder, machine: this.machine, settings: assistant ? choice : null, icon: this.icon, at: Date.now() });
        this.close();
        return;
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.busy = false;
      cx.notify();
    });
  }

  // Esc 先关建议列表,再关 dialog。上下键可展开并在其中移动。
  key(e, cx) {
    if (e.key === "escape") {
      if (this.machineOpen) { this.machineOpen = false; cx.stop_propagation(); return cx.notify(); }
      if (!this.listOpen) return this.close();
      this.listOpen = false; this.browse = null; this.hi = -1; cx.stop_propagation(); cx.notify(); return;
    }
    if (e.key !== "down" && e.key !== "up") return;
    const n = this.rows().length;
    if (!this.listOpen) { this.listOpen = true; this.hi = -1; }
    if (n) this.hi = e.key === "down" ? (this.hi + 1) % n : (this.hi <= 0 ? n - 1 : this.hi - 1);
    cx.stop_propagation();
    cx.notify();
  }

  // 一条建议,按 Herdr 菜单的行样式绘制:文件夹名,路径变淡。`up`:上一级文件夹
  // 上方,浏览上级时("..")。
  row(t, id, on, path, onClick, up = false) {
    return h_flex().id(id).h(K.row).flex_none().px(9).gap(10).rounded(6).items_center().cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(svg(up ? "mods/newspace/corner-left-up.svg" : "mods/workspace-chrome/folder.svg").size(14).flex_none().text_color(t.muted))
      .child(div().flex_none().max_w(200).truncate().text_color(t.foreground).child(up ? ".." : base(path)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(tilde(path)));
  }

  // 输入框下方:文件夹不在 git 中时显示 "Make it a git repo"(复选框),并有一行淡字
  // repo 内的显示对应内容,否则留空;高度始终一致。
  repoLine(t, folder) {
    const line = h_flex().h(20).flex_none().gap(8).items_center().text_size(12.5);
    if (this.offersRepo()) {
      const on = this.makeRepo;
      return line.id("make-repo").cursor_pointer().on_click((_e, cx) => { this.makeRepo = !this.makeRepo; cx.notify(); })
        .child(div().size(14).flex_none().flex().items_center().justify_center().border_1().rounded(3)
          .border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background)
          .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(10).text_color(t.background))))
        .child(div().flex_none().text_color(t.foreground).child(W.makeRepo))
        .child(div().min_w(0).truncate().text_color(t.dim).child(W.makeRepoWhy));
    }
    if (folder && this.repo.get(folder) === true)
      return line.text_color(t.dim).child(svg("mods/workspace-chrome/git-branch.svg").size(13).flex_none())
        .child(div().min_w(0).truncate().child(W.isRepo));
    return line;
  }

  // 整个 render 共用一份 Herdr 实时列表副本(live.js):超过约 50 毫秒 Herdr 会中止它。
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const t = theme();
    const rq = shared(PICK);
    if (rq?.at && rq.for === props()?.overlay && rq.at > this.picked) {
      this.picked = rq.at;
      this.icon = rq.emoji ?? null;
      cx.timer.after(0, () => this.input.focus());
    }
    const rows = this.listOpen ? this.rows() : [];
    // 浏览另一台 machine 时:其文件夹正在列举中,或没有子文件夹。
    const empty = this.listOpen && this.browse && !rows.some((r) => !r.up) ? (this.browse.rows ? W.empty : W.loading) : "";
    const field = pathOf(this.text);
    const folder = this.folder();
    // 输入框下方一行淡字:尚不存在的文件夹会在 Create 时创建。其预留空间
    // 保留,对话框因此高度不变;错误信息红色显示在按钮旁。
    const note = field && this.exists.get(field) === false ? W.missing : "";
    // 可创建 space 的机器;两台及以上时才显示 Machine 选择。
    const keys = reachableMachines();
    const choosing = N.choosesMachine(keys);
    const input = Input.new(this.input).w_full().h(K.field).px(10).items_center().rounded(RADIUS.control).border(1)
      .border_color(this.focused ? t.accent : t.input).bg(t.background).text_color(t.foreground);
    // 建议项挂在输入框下方、窗口顶层,仅在展开时显示。至多 8 行
    // 显示其余滚动:固定高度,因为 overflow_y_scrollbar() 的盒子只接受高度而不接受
 // max_h(有的话就无可滚动并截断第 8 行之后的内容,)。
    const shown = Math.min(8, rows.length + (empty ? 1 : 0));
    const list = Popup.new("folder-list", input).flex_1().min_w(0).anchor("top_left")
      .when(rows.length > 0 || Boolean(empty), (el) => el.content(v_flex().id("folder-rows").w(LIST_W).h(K.row * shown + 8).overflow_y_scrollbar().mt(4).p(4).rounded(8).border(1).border_color(t.border).bg(t.popover).shadow_lg().text_size(13)
        .children(rows.map((r, i) => this.row(t, `folder-${i}`, i === this.hi, r.path, (cx) => this.pick(r.path, cx), r.up)))
        .when(Boolean(empty), (el) => el.child(div().h(K.row).flex_none().px(9).flex().items_center().text_color(t.dim).child(empty)))));
    const panel = v_flex().id("newspace").w_full().flex_none().p(K.pad).rounded(10).border(1).border_color(t.border).bg(t.popover).shadow_lg().text_size(13)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", (_e, cx) => { if (this.listOpen || this.machineOpen) { this.listOpen = false; this.machineOpen = false; this.browse = null; this.hi = -1; cx.notify(); } })
      .child(h_flex().h(K.title).flex_none().gap(6).items_baseline().text_size(TEXT.title).font_semibold().text_color(t.foreground).child(W.title)
        .when(Boolean(this.machine) && !choosing, (el) => el.child(div().min_w(0).truncate().font_normal().text_color(t.dim).child(W.on(lookOf(this.machine).name)))))
      .child(div().h(K.section).flex_none())
      .when(choosing, (el) => el.child(div().h(K.label).flex_none().text_size(TEXT.label).text_color(t.dim).child(W.machine))
        .child(div().h(K.gap).flex_none())
        .child(this.machineChoice(t, keys))
        .child(div().h(K.section).flex_none()))
      .child(div().h(K.label).flex_none().text_size(TEXT.label).text_color(t.dim).child(W.label))
      .child(div().h(K.gap).flex_none())
      // 图标(同 Rename 对话框)、输入框与 Browse…:使用系统自带的文件夹选择器
      // 此处;列表在另一台 machine 上。
      .child(h_flex().h(K.field).flex_none().gap(8).items_center()
        .child(h_flex().id("icon").size(K.field).flex_none().justify_center().items_center().rounded(RADIUS.control).border(1).border_color(t.input).bg(t.background)
          .cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (e) => { this.iconAt = { x: e.position.x - (e.local_position?.x ?? 0), y: e.position.y - (e.local_position?.y ?? 0), width: e.bounds?.width ?? 0, height: e.bounds?.height ?? 0 }; })
          .on_click((_e, cx) => { this.pickIcon(this.iconAt); cx.notify(); })
          .child(this.icon ? div().text_size(16).child(this.icon) : div().text_size(16).text_color(t.muted).child("#")))
        .child(list)
        .child(button("browse", W.browse, { size: "lg", onClick: (_e, cx) => this.choose(cx) })))
      .child(div().h(20).flex_none().pt(4).text_size(TEXT.label).text_color(t.dim).child(note))
      .child(div().h(4).flex_none())
      .child(this.repoLine(t, folder))
      .child(div().h(K.section).flex_none())
      .child(dialogFooter({ onCancel: () => this.close(), note: this.error, error: true,
        primary: { id: "create", label: this.busy ? W.creating : W.create, disabled: !folder || this.busy || this.switching, onClick: (_e, cx) => this.create(cx) } }));
    // overlay 即面板展开到最高时的大小;面板居于其中部。
    return v_flex().size_full().justify_center().child(panel);
  }
}
