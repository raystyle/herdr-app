// 每个 mod 绘制 UI 所用的基础构件:一套尺寸系统,一套红/绿/amber,以及少数
// 应用反复使用的少量控件(button、switch、segmented control、menu row、headings、卡片
// header、dialog footer、hover)。lib/UI.md 列出它们及规则。
// 共享文件:源为 lib/ui.js;bin/sync-shared 会把它复制到 lib/COPIES 里的每个 mod。
// 请编辑 lib/ui.js,不要改 mod 里的副本,然后运行 bin/sync-shared。
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings, theme, openOverlay, notify, layout, shared, setShared, spaces } from "herdr";

// 尺寸 -------------------------------------------------------------------
// 按钮:面板、行和头部用 24;对话框和卡片用 32;20 仅用于行内的
// 第二行高 16(Ready 行的 Accept),行高因此保持不变。
export const H = { xs: 20, sm: 24, lg: 32 };
// 文字:11 用于 ID 和时间,12 用于次行和标签,13 用于正文和标题,15 用于页面标题。
export const TEXT = { id: 11, label: 12, body: 13, title: 15 };
// 圆角:控件 6,卡片(及 hover)8,气泡 12。
export const RADIUS = { control: 6, card: 8, bubble: 12 };

// 状态色 -----------------------------------------------------------
// herdr-winapp 自己的,浅色和深色,与 task 圆点一致(dot.js 使用这些):红为 needs
// you(及 alert),绿为 ready,amber 为 working。
const dark = () => settings()?.dark !== false;
export const red = () => (dark() ? "#ff6369" : "#e5484d");
export const green = () => (dark() ? "#3dd68c" : "#30a46c");
export const amber = () => (dark() ? "#f5b544" : "#e2a336");
// 红、绿、amber 底上的文字:浅色主题的深底用白字,深色主题的亮底用黑字
// (herdr-winapp 的 AttentionBadge)。
export const onStatus = () => (dark() ? "#000000" : "#ffffff");

// Hover 与指针 --------------------------------------------------------
// 只有点击后有效果的元素才有 pointer 和 hover;其余一律
// 都没有。hover 是圆角 8 的背景。`el` 需要有 id。
export function clickable(el, onClick, { radius = RADIUS.card } = {}) {
  const t = theme();
  return el.rounded(radius).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); cx.notify(); });
}

// 按钮 Buttons -------------------------------------------------------------------
// kind:“primary”(实心;每个 panel 或对话框一个)、“secondary”(带边框)、“plain”(纯文字,
// 文字,其下是 hover)。size:“xs” 20(行的第二行内)、“sm” 24 或 “lg” 32。宽度
// 与文字等宽,绝不截断。
// opts:{ kind, size, icon(svg path), disabled, onClick }。
export function button(id, label, { kind = "secondary", size = "sm", icon = null, disabled = false, onClick = null } = {}) {
  const t = theme();
  const lg = size === "lg", xs = size === "xs";
  const h = lg ? H.lg : xs ? H.xs : H.sm;
  const iconSize = lg ? 16 : xs ? 12 : 14;
  const pad = lg ? 12 : xs ? 6 : 8;
  const live = !disabled && Boolean(onClick);
  return h_flex().id(id).h(h).flex_none().gap(6).items_center().rounded(RADIUS.control).whitespace_nowrap()
    .text_size(lg ? TEXT.body : TEXT.label).font_medium()
    // 图标的侧边内边距与顶部相同,使其在角落里摆正。
    .pl(icon ? (h - iconSize) / 2 : pad).pr(pad)
    .when(kind === "primary", (el) => el.bg(t.solid).text_color(t.solid_foreground).when(live, (el) => el.hover((s) => s.opacity(0.88))))
    .when(kind === "secondary", (el) => el.border_1().border_color(t.input).bg(t.background).text_color(t.foreground)
      .when(live, (el) => el.hover((s) => s.bg(t.hover))))
    .when(kind === "plain", (el) => el.text_color(t.muted).when(live, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground))))
    .when(disabled, (el) => el.opacity(0.5))
    .when(live, (el) => el.cursor_pointer().on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); cx.notify(); }))
    .when(Boolean(icon), (el) => el.child(svg(icon).size(iconSize).flex_none()))
    .child(label);
}

// 安静的文本链接(卡片头、“Show all”):muted 色,悬停变 foreground,宽度随文字。
export function link(id, label, onClick) {
  const t = theme();
  return div().id(id).flex_none().whitespace_nowrap().text_size(TEXT.label).text_color(t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground))
    .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); cx.notify(); })
    .child(label);
}

// 开关 Switch ---------------------------------------------------------------------
// 开:accent 色轨道,旋钮在右侧。36 × 20。
export function toggleSwitch(id, on, onToggle, { disabled = false } = {}) {
  const t = theme();
  return div().id(id).w(36).h(20).flex_none().rounded(10).p(2).flex().bg(on ? t.accent : t.hover)
    .when(on, (el) => el.justify_end())
    .when(disabled, (el) => el.opacity(0.5))
    .when(!disabled, (el) => el.cursor_pointer().on_click((e, cx) => { cx.stop_propagation(); onToggle(!on, e, cx); cx.notify(); }))
    .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground : t.muted));
}

// 分段控件 Segmented control ----------------------------------------------------------
// options:[[value, label, { disabled }?], ...]。每个 segment 与其文字等宽,且
// 绝不截断;`fill` 让 segment 撑满整行(但仍不会比文字更窄)。
// 禁用的 segment 呈暗色且不响应点击。
// opts:{ size: "sm" 24 | "lg" 32, disabled, fill }。
export function segmented(id, options, value, onPick, { size = "sm", disabled = false, fill = false } = {}) {
  const t = theme();
  return h_flex().h(size === "lg" ? H.lg : H.sm).flex_none().p(2).gap(2).rounded(RADIUS.control).bg(t.raised)
    .when(fill, (el) => el.w_full())
    .when(disabled, (el) => el.opacity(0.5))
    .children(options.map(([v, label, o]) => {
      const on = v === value, off = disabled || Boolean(o?.disabled);
      return h_flex().id(`${id}-${v}`).h_full().px(8).justify_center().items_center().rounded(RADIUS.control - 2)
        .whitespace_nowrap().text_size(TEXT.label)
        .when(fill, (el) => el.flex_1())
        .when(!fill, (el) => el.flex_none())
        .when(on, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
        .when(!on && Boolean(o?.disabled), (el) => el.text_color(t.dim).opacity(0.6))
        .when(!on && !o?.disabled, (el) => el.text_color(t.muted))
        .when(!on && !off, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((e, cx) => { cx.stop_propagation(); onPick(v, e, cx); cx.notify(); }))
        .child(label);
    }));
}

// 菜单行 Menu row -------------------------------------------------------------------
// 弹出菜单的行,高 32(herdr-winapp 的 MenuItem):一个 16 图标(或其空位,使标签
// 基线对齐),标签,一个暗色提示,`check` 为 true 时右侧有个勾(选择
// 列表;false 则保留勾的空位)。opts:{ icon, hint, check, danger, disabled, onClick }。
export function menuRow(id, label, { icon = null, hint = null, check = null, danger = false, disabled = false, onClick = null } = {}) {
  const t = theme();
  const live = !disabled && Boolean(onClick);
  return h_flex().id(id).h(32).w_full().flex_none().px(8).gap(8).items_center().rounded(RADIUS.control)
    .text_size(TEXT.body).text_color(disabled ? t.dim : danger ? red() : t.foreground)
    .when(live, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); cx.notify(); }))
    .child(div().size(16).flex_none().flex().items_center().justify_center()
      .when(Boolean(icon), (el) => el.child(svg(icon).size(16).text_color(danger ? red() : t.muted))))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(hint), (el) => el.child(div().flex_none().pl(8).text_size(TEXT.label).text_color(t.dim).child(hint)))
    .when(check !== null, (el) => el.child(div().size(16).flex_none()
      .when(check, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(16).text_color(t.foreground)))));
}

// 标题 Headings -----------------------------------------------------------------------
// 组上方的小号暗色标题(herdr-winapp 的 Section):12,medium,句首大写,绝不
// 大写。`right`(一个元素,如计数)位于最右。
export function heading(text, right = null) {
  const t = theme();
  return h_flex().h(28).flex_none().gap(8).items_center().justify_between().text_size(TEXT.label).font_medium().text_color(t.dim)
    .child(div().min_w(0).truncate().child(text))
    .when(Boolean(right), (el) => el.child(div().flex_none().child(right)));
}

// 卡片头:左侧标题(13,medium),右侧是它的链接或小按钮。
// `title` 可以是文本或元素;`actions` 是元素列表(link()、button())。
export function cardHeader(title, actions = []) {
  const t = theme();
  return h_flex().w_full().flex_none().gap(12).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).font_medium().text_color(t.foreground).child(title))
    .when(actions.length > 0, (el) => el.child(h_flex().flex_none().gap(12).items_center().children(actions)));
}

// 对话框 footer,高 32:左侧可选的暗色提示(`error` 使其变红),然后是
// 纯文字 Cancel 和唯一的实心 primary。不做 “Esc” 提示:Esc 可关闭对话框这一点不必言明。
// opts:{ onCancel, primary: { id, label, onClick, disabled }, cancelLabel, note, error }。
export function dialogFooter({ onCancel, primary, cancelLabel = "Cancel", note = "", error = false }) {
  const t = theme();
  return h_flex().h(H.lg).w_full().flex_none().gap(8).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(TEXT.label).text_color(error ? red() : t.dim).child(note || ""))
    .child(button("dialog-cancel", cancelLabel, { kind: "plain", size: "lg", onClick: onCancel }))
    .when(Boolean(primary), (el) => el.child(button(primary.id ?? "dialog-primary", primary.label,
      { kind: "primary", size: "lg", disabled: primary.disabled, onClick: primary.onClick })));
}

// 计数角标 Count badge ------------------------------------------------------------------------------
// Tasks、tab 和 space 上的计数角标,同 herdr-winapp 的 AttentionBadge:只有 Needs you 是红点,
// 只有 Ready 是绿点,两者并存则是一个从中分开的椭圆(左红 Needs you,右绿
// Ready 在右,中间以 `line` 色画 1px 分隔线,即角标的底色)。固定高 16,因此
// 行不会因角标 kind 变化而跳动;每个计数到 9+ 为止。11px 数字是偶数
// 像素高度,因此居中;单独的 “1” 较窄且旗帜在左,所以
// 右移 1 像素以显居中。
export function countBadge(need, ready, line) {
  const num = (n) => div().line_height("16px").when(n === 1, (el) => el.ml(1)).child(n > 9 ? "9+" : String(n));
  const part = (n, bg) => div().h(16).flex().items_center().justify_center().bg(bg).child(num(n));
  const badge = h_flex().h(16).flex_none().text_color(onStatus()).text_size(TEXT.id).font_semibold();
  if (need > 0 && ready > 0)
    return badge.child(part(need, red()).w(need > 9 ? 19 : 15).rounded_l(8)).child(div().w(1).h(16).bg(line))
      .child(part(ready, green()).w(ready > 9 ? 19 : 15).rounded_r(8));
  const n = need || ready;
  return badge.child(part(n, need ? red() : green()).min_w(16).px(n > 9 ? 4 : 0).rounded(8));
}

// 设置 Settings ---------------------------------------------------------------------------------
// 唯一的 Settings 窗口(mods/herdr-winapp-settings):占窗口高度的大部分,最多 900
// (它自己在内部居中绘制边框)。p:{ space?: 该 space 自己的设置, section? }。
export function openSettings(p = {}) {
  return openOverlay({ mod: "herdr-winapp-settings", kind: "dialog", frame: "none", width: 860, height: 0.92, props: p });
}

// // 通知 -------------------------------------------------------------------------------------
// 所有以 toast 形式呈现给用户的内容都经过 toast():由我们自己的 float 绘制,
// (mods/toasts:正文最多折 3 行,悬停显示 X,alert 为红色),标题只有一种格式,表示
// agent 所说(“· what”、“~ Assistant · what”)。当当前 layout 没有 toast
// float(另一个 layout),则改用 Herdr 的 notify() 显示。存于共享 “toasts”,新的排在最后。
// n:{ title, body, level: "info" | "success" | "warning" | "error" | "alert", action: { name,
// args }, timeout(毫秒)}。“alert” 表示 agent 等不下去或需要用户:红色。
export const TOASTS = "toasts";
const hasToasts = (n) => Boolean(n && typeof n === "object")
  && (n.content?.mod === TOASTS || [...(n.children ?? []), ...(n.floating ?? [])].some(hasToasts));
export function toast(n) {
  if (!hasToasts(layout())) return notify({ ...n, level: n.level === "alert" ? "error" : n.level ?? "info" });
  const at = Date.now();
  const id = `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const kept = (shared(TOASTS) ?? []).filter((x) => at - x.at < 120000).slice(-4);
  setShared(TOASTS, [...kept, { ...n, level: n.level ?? "info", id, at }]);
  return id;
}

// toast 来自谁,即标题的前半部分(“· what”、“~ Assistant · what”):task 的
// agent 以其 task 命名(herdr-task 命名为“herd-4-fix-login”;在别的机器上是“on vm”,如
// core/toasts.js 的 taskWho),Assistant 以其 space 命名,其余按其程序命名。k:一个 terminal
// (terminals());task:已知时为 task 引用。
export function toastWho(k, task = null) {
  const l = k?.labels ?? {};
  const m = String(k?.address ?? "").includes("/") ? k.address.split("/")[0] : null;
  const ref = task ?? (l["herdr.task"] ? (/^([a-z][a-z0-9]*-\d+)/.exec(k?.name ?? "")?.[1] ?? "").toUpperCase() : "");
  if (ref) return m ? `${ref} on ${m}` : ref;
  if (l["herdr.role"] === "coordinator") {
    const id = l["herdr.coordinator.space"] ?? l["herdr.space"];
    const name = id && spaces().find((s) => s.id === (m ? `${m}/${id}` : id))?.name;
    return name ? `${name} Assistant` : "Assistant";
  }
  return k?.program?.name ?? "Agent";
}

// 用平实语言描述的错误,作为 toast 正文(标题说明什么失败了):取最后一行,
// 不带程序名或 “Error:”,作为一个句子。单纯的 “<tool> failed” 或退出码
// 什么也不说,于是返回 “”(此时 toast 没有正文)。
export function plainError(e) {
  let s = String(e?.message ?? e ?? "").trim().split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  s = s.replace(/^(uncaught\s+)?(\w*error|herdr-[\w-]+|hc|fatal)\s*:\s*/i, "").trim();
  // 给 agent 的提示(“`herdr-artifact list` 可列出它们”)不是给用户的。
  s = s.split(/(?<=[.!?])\s+/).filter((x) => !x.includes("`")).join(" ").trim();
  if (!s || /^[\w. -]+ failed\.?$/i.test(s) || /^(exit(ed)?( with)?( code| status)?|status|code)\s*:?\s*\d+\.?$/i.test(s)) return "";
  if (/timed? ?out|no answer within/i.test(s)) return "It didn't answer in time. Try again.";
  if (/connection refused|unreachable|cannot reach|could not resolve|no route to host/i.test(s)) return "Couldn't reach that machine. Check that it's on, then try again.";
  if (/permission denied|EACCES/i.test(s)) return "Herdr isn't allowed to do that there.";
  s = s[0].toUpperCase() + s.slice(1);
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}
