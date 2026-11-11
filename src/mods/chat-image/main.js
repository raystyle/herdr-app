// 聊天的图片查看器(mods/chat):以主题色铺在聊天 pane 上的背景层,
// 图片居中放大显示,顶部工具栏(名称与大小;缩小、缩放百分比(点击:
// fit / actual size)、放大;复制、打开、在文件夹中显示;关闭),多张时两侧显示上一张 / 下一张
// 以及下方 "2 / 3"。缩放:按钮 + - 0 1、滚轮(以指针为中心;触控板平移
// 缩放时且随 ctrl 缩放),双击在该点在 fit 与 100% 间切换。已放大的图片
// 拖动以平移。Left/Right 逐步缩放,Esc 或点击图片外关闭。
// 以无边框 popup 覆盖在 chat pane 上,尺寸与其一致:props { images: [{ rel, w, h,
// name、path }], index、width、height };`rel` 是应用目录内的路径(attach.js
// viewable()),`path` 为原始文件。
// 或一个 artifact(mods/artifacts),同一外壳覆盖同一 chat pane(…时为整窗)
// 非从聊天打开时):artview.js 打开一个 layout overlay,其顶部 block 即本 mod,props 为 { artifact: { mod, id, title, version, machine } }(其工具栏,
// artifact-bar.js:标题、版本步进器、Mark up、在侧栏打开、关闭)盖在
// artifact 自己的 mod,同一背景层。

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, closeOverlay, readTextFile, settings, exec, appHome, window as win } from "herdr";
import { initArtifactBar, artifactBar, closeArtifactBar } from "./artifact-bar.js";
import { toast, TEXT, RADIUS } from "./ui.js";

const BAR = 48;                      // 工具栏的高度
const MARGIN = 24;                   // 适配后图片四周的留白
const SIDE = 64;                     // 为上一个/下一个按钮留出的空间
const STEP = 1.25;                   // 一个缩放级别(按钮、按键)
const MAX = 8;                       // 800%
// 主题自身配色:背景近乎不透明铺在底下;文字与悬停色画在上面。
const backdrop = (t) => `${t.background}f2`;

export default class ImageViewer extends View {
  init(_props, cx) {
    this.images = props()?.images ?? [];
    this.i = Math.min(Math.max(0, props()?.index ?? 0), Math.max(0, this.images.length - 1));
    this.size = { width: props()?.width ?? 800, height: props()?.height ?? 600 };
    this.reset();
    this.handle = cx.focus_handle();
    cx.timer.after(0, () => this.handle.focus());
    // 或粘贴的文本文件,供阅读:props { textPath, title }。
    if (props()?.textPath) cx.spawn(async (cx) => { this.text = (await readTextFile(props().textPath).catch(() => null)) ?? "(can't read it)"; cx.notify(); });
    // 或 artifact 的工具栏(artifact-bar.js):其版本、Mark up。
    if (props()?.artifact) initArtifactBar(this, cx);
  }

  async close() { if (props()?.artifact) closeArtifactBar(props().artifact); }

  // 回到适合大小并居中。
  reset() { this.fit = true; this.scale = 1; this.ox = 0; this.oy = 0; }

  // 可读面板中的文本文件,标题在顶部。
  textView(t) {
    const w = Math.min(860, (props()?.width ?? 800) - 48), h = (props()?.height ?? 600) - 48;
    return v_flex().id("viewer").w(props()?.width ?? 800).h(props()?.height ?? 600).items_center().justify_center().bg(t.background + "e6")
      .track_focus(this.handle)
      .on_click(() => closeOverlay(props()?.overlay))
      .child(v_flex().id("text-panel").w(w).h(h).rounded(10).bg(t.popover).border_1().border_color(t.border).shadow_md().overflow_hidden()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => cx.stop_propagation())
        .child(h_flex().h(36).flex_none().px(14).items_center().border_b(1).border_color(t.border)
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().text_color(t.foreground).child(props()?.title ?? "粘贴的文本")))
        .child(div().id("text-body").flex_1().min_h(0).p(14).overflow_y_scrollbar()
          .font_family(settings().font_family ?? "JetBrains Mono").text_size(12.5).text_color(t.foreground)
          .children(String(this.text ?? "").split("\n").slice(0, 5000).map((l) => div().min_h(18).child(l || " ")))));
  }

  // // ---- 几何 ----------------------------------------------------------------------------

  img() { return this.images[this.i]; }
  many() { return this.images.length > 1; }

  // stage:工具栏以下的全部区域。
  stage() { return { w: Math.max(100, this.size.width), h: Math.max(100, this.size.height - BAR) }; }

  // 使图片适配 stage 的缩放比例(箭头旁的),永不超过 100%。
  fitScale() {
    const img = this.img(), s = this.stage();
    if (!img) return 1;
    const roomW = s.w - 2 * (this.many() ? SIDE : MARGIN), roomH = s.h - 2 * MARGIN - (this.many() ? 28 : 0);
    return Math.min(1, Math.max(40, roomW) / img.w, Math.max(40, roomH) / img.h);
  }

  shownScale() { return this.fit ? this.fitScale() : this.scale; }
  minScale() { return Math.min(this.fitScale(), 1) / 4; }

  // 图片在 stage 中的绘制矩形。
  rect() {
    const img = this.img(), s = this.stage(), k = this.shownScale();
    const w = img.w * k, h = img.h * k;
    return { w, h, left: s.w / 2 + this.ox - w / 2, top: s.h / 2 + this.oy - h / 2 };
  }

  // 放大图像在溢出的轴上保持覆盖 stage;其余轴居中。
  clamp() {
    const img = this.img(), s = this.stage(), k = this.shownScale();
    if (!img) return;
    const lim = (size, room) => Math.max(0, (size - room) / 2);
    const lx = lim(img.w * k, s.w), ly = lim(img.h * k, s.h);
    this.ox = Math.max(-lx, Math.min(lx, this.ox));
    this.oy = Math.max(-ly, Math.min(ly, this.oy));
  }

  canPan() {
    const img = this.img(), s = this.stage(), k = this.shownScale();
    return Boolean(img) && (img.w * k > s.w + 0.5 || img.h * k > s.h + 0.5);
  }

  // 缩放到 `to`,并保持 stage 上的 `at` 点(默认:中点)仍在指针之下。
  zoomTo(to, at) {
    if (!this.img()) return;
    const s = this.stage(), from = this.shownScale();
    const next = Math.max(this.minScale(), Math.min(MAX, to));
    const px = (at?.x ?? s.w / 2) - s.w / 2, py = (at?.y ?? s.h / 2) - s.h / 2;
    this.ox = px - (px - this.ox) * (next / from);
    this.oy = py - (py - this.oy) * (next / from);
    this.fit = false;
    this.scale = next;
    this.clamp();
  }

  zoomBy(f, at) { this.zoomTo(this.shownScale() * f, at); }

  // 适应 <-> 100%(工具栏按钮,"1" / "0",在 `at` 处双击)。
  toggleActual(at) {
    if (this.fit && Math.abs(this.fitScale() - 1) > 0.001) this.zoomTo(1, at);
    else this.reset();
  }

  step(d) {
    if (!this.many()) return;
    this.i = (this.i + d + this.images.length) % this.images.length;
    this.reset();
  }

  // // ---- 对文件的操作 ---------------------------------------------------------------

  file() {
    const img = this.img();
    return img?.path ?? (img ? `${appHome()}/${img.rel}` : null);
  }

  copy(cx) {
    const p = this.file();
    if (!p) return;
    const os = win()?.platform;
    const run = os === "macos"
      ? exec("osascript", ["-e", `set the clipboard to (read (POSIX file "${p.replace(/"/g, '\\"')}") as «class PNGf»)`])
      : os === "windows"
        ? exec("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::SetImage([Drawing.Image]::FromFile($args[0]))`, p])
        // wl-copy 留在后台服务剪贴板:其输出不得占住 exec 句柄。
        : exec("sh", ["-c", 'if [ -n "$WAYLAND_DISPLAY" ] && command -v wl-copy >/dev/null; then wl-copy < "$1" >/dev/null 2>&1; else xclip -selection clipboard -t "$(file -b --mime-type "$1")" -i "$1" >/dev/null 2>&1; fi', "copy", p]);
    run.then((r) => {
      if (r?.code && r.code !== 0) throw new Error(r.stderr || "copy failed");
      this.copied = true;
      cx.notify();
      cx.timer.after(1400, (cx) => { this.copied = false; cx.notify(); });
    }).catch(() => toast({ title: "无法复制图片", level: "error" }));
  }

  openFile() {
    const p = this.file();
    if (!p) return;
    const os = win()?.platform;
    (os === "macos" ? exec("open", [p]) : os === "windows" ? exec("cmd", ["/c", "start", "", p]) : exec("xdg-open", [p])).catch(() => {});
  }

  // 在文件管理器中打开文件所在文件夹,系统支持时选中该文件。
  reveal() {
    const p = this.file();
    if (!p) return;
    const os = win()?.platform;
    if (os === "macos") return exec("open", ["-R", p]).catch(() => {});
    if (os === "windows") return exec("explorer", [`/select,${p}`]).catch(() => {});
    exec("sh", ["-c", 'dbus-send --session --print-reply --dest=org.freedesktop.FileManager1 /org/freedesktop/FileManager1 org.freedesktop.FileManager1.ShowItems array:string:"file://$1" string:"" >/dev/null 2>&1 || xdg-open "$(dirname "$1")"', "reveal", p]).catch(() => {});
  }

  // // ---- 输入 -----------------------------------------------------------------------------

  key(e, cx) {
    const k = e.key, mod = e.modifiers?.control || e.modifiers?.platform;
    if (k === "left") this.step(-1);
    else if (k === "right") this.step(1);
    else if (k === "=" || k === "+") this.zoomBy(STEP);
    else if (k === "-") this.zoomBy(1 / STEP);
    else if (k === "0") this.reset();
    else if (k === "1") this.zoomTo(1);
    else if (k === "c" && mod) return this.copy(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  down(e, cx) {
    const at = e.local_position;
    const img = this.img();
    if (!img || !at) return;
    const r = this.rect();
    const on = at.x >= r.left && at.x <= r.left + r.w && at.y >= r.top && at.y <= r.top + r.h;
    if (on && e.click_count === 2) { this.press = null; this.toggleActual(at); cx.notify(); return; }
    this.press = { x: e.position.x, y: e.position.y, ox: this.ox, oy: this.oy, on, moved: false };
    if (on && this.canPan()) { this.dragging = true; cx.notify(); }
  }

  move(e, cx) {
    const p = this.press;
    if (!p) return;
    const dx = e.position.x - p.x, dy = e.position.y - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
    if (!this.dragging) return;
    this.ox = p.ox + dx;
    this.oy = p.oy + dy;
    this.clamp();
    cx.notify();
  }

  up(cx) {
    const p = this.press;
    this.press = null;
    if (this.dragging) { this.dragging = false; cx.notify(); }
    // 点击背景(非拖动、非点击图片)即关闭。
    if (p && !p.on && !p.moved) closeOverlay(props()?.overlay);
  }

  wheel(e, cx) {
    if (!this.img()) return;
    const at = e.local_position;
    const lines = e.delta_lines && (e.delta_lines.x || e.delta_lines.y);
    const zoomKey = e.modifiers?.control || e.modifiers?.platform;
    if (zoomKey || lines) {
      // 滚轮一格(lines)或捏合 / ctrl 滚动(pixels):以指针位置为中心缩放。
      const dy = lines ? e.delta_lines.y * 40 : e.delta.y;
      if (!dy) return;
      this.zoomBy(Math.exp(Math.max(-1, Math.min(1, dy * 0.004))), at);
    } else if (this.canPan()) {
      // 触控板双指滚动可平移放大后的图像。
      this.ox += e.delta.x;
      this.oy += e.delta.y;
      this.clamp();
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  // // ---- 绘制 ---------------------------------------------------------------------------

  // 工具栏按钮:一个图标,自带点击处理(backdrop 永远不会捕获它)。
  btn(id, icon, act, t) {
    return div().id(id).size(32).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); act(cx); cx.notify(); })
      .child(svg(`mods/chat-image/${icon}.svg`).size(16));
  }

  rule(t) { return div().w(1).h(18).mx(4).flex_none().bg(t.border); }

  toolbar(img, t) {
    const pct = `${Math.round(this.shownScale() * 100)}%`;
    return h_flex().id("bar").w_full().h(BAR).flex_none().pl(16).pr(8).gap(2).items_center()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().flex_1().min_w(0).gap(8).items_baseline().text_size(TEXT.body)
        .child(div().min_w(0).truncate().font_medium().text_color(t.foreground).child(img?.name ?? "Image"))
        .when(Boolean(img), (el) => el.child(div().flex_none().text_size(TEXT.label).text_color(t.muted).child(`${img.w} × ${img.h}`))))
      .when(Boolean(img), (el) => el
        .child(this.btn("zoom-out", "zoom-out", () => this.zoomBy(1 / STEP), t))
        // 缩放,以及唯一的 fit / actual size 切换。
        .child(div().id("pct").w(52).h(32).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer()
          .text_size(TEXT.label).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.toggleActual(); cx.notify(); })
          .child(pct))
        .child(this.btn("zoom-in", "zoom-in", () => this.zoomBy(STEP), t))
        .child(this.rule(t))
        .child(this.btn("copy", this.copied ? "check" : "copy", (cx) => this.copy(cx), t))
        .child(this.btn("open", "external-link", () => this.openFile(), t))
        .child(this.btn("reveal", "folder-open", () => this.reveal(), t))
        .child(this.rule(t)))
      .child(this.btn("close", "x", () => closeOverlay(props()?.overlay), t));
  }

  arrow(id, icon, d, side, t) {
    const s = this.stage();
    return div().id(id).absolute().top(s.h / 2 - 20).when(side === "left", (el) => el.left(14)).when(side === "right", (el) => el.right(14))
      .size(40).flex().items_center().justify_center().rounded(20).cursor_pointer()
      .bg(t.raised).border_1().border_color(t.border).text_color(t.foreground).hover((st) => st.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.step(d); cx.notify(); })
      .child(svg(`mods/chat-image/${icon}.svg`).size(18));
  }

  render() {
    const t = theme();
    if (props()?.artifact) return artifactBar(this, props().artifact, this.handle);
    if (props()?.textPath) return this.textView(t);
    const img = this.img();
    const s = this.stage();
    if (img && !this.fit) this.clamp();
    const r = img ? this.rect() : null;
    const grab = img && this.canPan();
    return v_flex().id("viewer").w(props()?.width ?? this.size.width).h(props()?.height ?? this.size.height)
      .bg(backdrop(t))
      .track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_move((e, cx) => this.move(e, cx))
      .on_mouse_up("left", (_e, cx) => this.up(cx))
      .child(this.toolbar(img, t))
      .child(div().id("stage").relative().w_full().flex_1().min_h(0).overflow_hidden()
        .when(Boolean(grab), (el) => (this.dragging ? el.cursor_grabbing() : el.cursor_grab()))
        .on_mouse_down("left", (e, cx) => this.down(e, cx))
        .on_scroll_wheel((e, cx) => this.wheel(e, cx))
        .when(Boolean(img), (el) => el.child(div().absolute().left(Math.round(r.left)).top(Math.round(r.top))
          .w(Math.round(r.w)).h(Math.round(r.h)).rounded(this.fit ? 4 : 0).overflow_hidden().shadow_lg()
          .child(image(img.rel).size_full())))
        .when(!img, (el) => el.child(div().size_full().flex().items_center().justify_center().text_size(TEXT.body).text_color(t.muted).child("无法显示此图片。")))
        .when(this.many(), (el) => el
          .child(this.arrow("prev", "chevron-left", -1, "left", t))
          .child(this.arrow("next", "chevron-right", 1, "right", t))
          .child(div().absolute().bottom(14).left(s.w / 2 - 32).w(64).h(24).flex().items_center().justify_center().rounded(12)
            .bg(t.raised).text_size(TEXT.label).text_color(t.foreground).child(`${this.i + 1} / ${this.images.length}`))));
  }
}
