// 会话中的卡片(DECISIONS、Chat:question/permission/plan/secret 卡片位于
// 时间线原位并随其滚动)。时间线是 virtual list,其
// 行不接受 handler,因此卡片绘制为若干 strip(每条占一个列表行),看起来
// 看起来像一张卡片(第一块有上边缘,最后一块有下边缘)。一个 strip 是一行
// 最多两层可按:列表指明按下的是哪个 strip(on_item_click),该按下
// 说明位于其何处(hit()),各控件的绘制宽度在列表之外测量
// (measure())。一个 strip:{ key, kind, gap (上方间距 px), ... }:
// head: { who, dot, tone (who 的颜色), links: [ctl] }   谁在提问,右侧是 quiet 链接
// title / text: { text, tone ("dim" | "muted" | "red" | "fg") }
// detail: { lines, clip (折叠到多少 px,或 null) }      请求的内容,放在盒子里
// controls: { align ("start" | "end"), lead (前面的文字), ctls: [ctl] }
// option: { on, multi, num, label, tag, desc, fn }       整行宽度的选项
// review: { label, answer, missing, fn }                 待校验的应答,会展开其问题
// input: { state, indent, placeholder }                  输入框(native:无 handler)
// 一个 ctl:{ id, label, look ("primary" | "secondary" | "plain" | "pill" | "link"), on, done,
// disabled、fn }。fn(cx) 在点击时执行。

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { button, red, RADIUS, TEXT } from "./ui.js";

const PAD = 12, LINK_GAP = 12;
const GAPS = { controls: 6, pill: 4 };

// 控件的实际绘制形态,strip 和 measure() 通用:即带参数的共享按钮(ui.js)
// 指针与 hover 本应赋予它的样式:pill 或浅色链接。
export function ctlEl(t, c, pre = "") {
  const live = !c.disabled && Boolean(c.fn);
  if (c.look === "link") return div().id(`${pre}${c.id}`).flex_none().whitespace_nowrap().text_size(TEXT.label).text_color(t.muted)
    .when(live, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))).child(c.label);
  if (c.look === "pill") return h_flex().id(`${pre}${c.id}`).h(24).px(9).gap(5).flex_none().items_center().rounded(12).whitespace_nowrap().text_size(TEXT.label)
    .when(Boolean(c.on), (el) => el.bg(t.selected).text_color(t.foreground).font_medium())
    .when(!c.on, (el) => el.text_color(t.muted).when(live, (el) => el.hover((s) => s.bg(t.hover))))
    .when(live, (el) => el.cursor_pointer())
    .when(Boolean(c.done), (el) => el.child(svg("mods/chat/check.svg").size(11).flex_none().text_color(t.dim)))
    .child(c.label);
  return button(`${pre}${c.id}`, c.label, { kind: c.look ?? "secondary", disabled: Boolean(c.disabled) })
    .when(live, (el) => el.cursor_pointer().hover((s) => (c.look === "primary" ? s.opacity(0.88)
      : c.look === "plain" ? s.bg(t.hover).text_color(t.foreground) : s.bg(t.hover))));
}

const tone = (t, k) => ({ dim: t.dim, muted: t.muted, red: red(), fg: t.foreground })[k] ?? t.muted;

// 条带高度的决定因素(main.js key())。
export function sig(s) {
  const n = (v) => String(v ?? "").length;
  return `${s.kind}.${s.gap ?? ""}.${n(s.text)}.${n(s.who)}.${(s.links ?? []).length}.${s.lines?.length ?? ""}.${s.clip ?? ""}.${n(s.label)}.${n(s.desc)}.${n(s.answer)}.${s.tag ? 1 : 0}.${(s.ctls ?? []).length}`;
}

// 一条 strip,在卡片边框内。first / last:是否绘制卡片的上/下边缘。
export function strip(t, s, first, last, pre = "") {
  const frame = v_flex().w_full().bg(t.surface).border_1().border_color(t.border).px(PAD)
    .pt(first ? 10 : s.gap ?? 8).pb(last ? 10 : 0)
    .when(!first, (el) => el.border_t(0)).when(!last, (el) => el.border_b(0))
    .when(first, (el) => el.rounded_t(RADIUS.card)).when(last, (el) => el.rounded_b(RADIUS.card));
  return frame.child(body(t, s, pre));
}

function body(t, s, pre) {
  switch (s.kind) {
    case "head":
      return h_flex().w_full().min_h(18).gap(LINK_GAP).items_center()
        .child(h_flex().flex_1().min_w(0).gap(8).items_center()
          .child(div().size(8).flex_none().rounded(4).bg(s.dot ?? red()))
          .child(div().min_w(0).truncate().text_size(TEXT.label).font_medium().text_color(s.dot ? t.muted : red()).child(s.who)))
        .when((s.links ?? []).length > 0, (el) => el.child(h_flex().flex_none().gap(LINK_GAP).items_center().children(s.links.map((c) => ctlEl(t, c, pre)))));
    case "title":
      return div().min_w(0).text_size(TEXT.body).font_medium().text_color(t.foreground).child(s.text);
    case "text":
      return div().min_w(0).text_size(TEXT.label).line_height("18px").text_color(tone(t, s.tone)).child(s.text);
    case "detail":
      return div().w_full().px(8).py(6).rounded(RADIUS.control).bg(t.background).overflow_hidden()
        .when(s.clip != null, (el) => el.max_h(s.clip))
        .text_size(TEXT.label).text_color(t.muted).children(s.lines.map((l) => div().min_w(0).child(l || " ")));
    case "controls":
      return h_flex().w_full().gap(s.ctls.every((c) => c.look === "pill") ? GAPS.pill : GAPS.controls).items_center()
        .when(s.align === "end", (el) => el.justify_end())
        .when(Boolean(s.lead), (el) => el.child(div().flex_none().pr(2).text_size(TEXT.label).text_color(t.dim).child(s.lead)))
        .children(s.ctls.map((c) => ctlEl(t, c, pre)));
    case "option": {
      const mark = s.num != null
        ? h_flex().w(18).h(19).flex_none().items_center().justify_center().rounded(5).bg(t.raised).text_size(TEXT.id).font_medium().text_color(t.muted).child(String(s.num))
        : div().size(14).flex_none().flex().items_center().justify_center().border_1().rounded(s.multi ? 3 : 7)
          .border_color(s.on ? t.accent : t.input).when(Boolean(s.on), (el) => el.bg(t.accent))
          .when(Boolean(s.on) && Boolean(s.multi), (el) => el.child(svg("mods/chat/check.svg").size(10).text_color(t.background)))
          .when(Boolean(s.on) && !s.multi, (el) => el.child(div().size(6).rounded(3).bg(t.background)));
      return h_flex().w_full().px(8).py(6).gap(10).items_start().rounded(RADIUS.card)
        .when(Boolean(s.disabled), (el) => el.opacity(0.6))
        .when(!s.disabled, (el) => el.cursor_pointer().hover((st) => st.bg(s.on ? t.selected : t.hover)))
        .when(Boolean(s.on), (el) => el.bg(t.selected))
        .child(div().pt(s.num != null ? 0 : 2).child(mark))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(6).items_center().child(div().min_w(0).text_color(t.foreground).child(s.label))
            .when(Boolean(s.tag), (el) => el.child(div().px(6).h(16).flex_none().flex().items_center().rounded(4).bg(t.raised).text_size(TEXT.id).text_color(t.muted).child(s.tag))))
          .when(Boolean(s.desc), (el) => el.child(div().text_size(TEXT.label).text_color(t.dim).child(s.desc))));
    }
    case "review":
      return h_flex().w_full().px(8).py(6).gap(10).rounded(RADIUS.card).cursor_pointer().hover((st) => st.bg(t.hover))
        .child(div().w(150).flex_none().truncate().text_size(TEXT.label).text_color(t.dim).child(s.label))
        .child(div().flex_1().min_w(0).text_color(s.missing ? red() : t.foreground).child(s.answer));
    case "input":
      return div().w_full().pl(s.indent ?? 0).child(div().h(32).px(8).flex().items_center().rounded(RADIUS.control)
        .border_1().border_color(t.input).bg(t.background)
        .child(s.state ? Input.new(s.state).w_full().text_size(TEXT.body).text_color(t.foreground)
          : div().text_size(TEXT.body).text_color(t.dim).child(s.placeholder ?? "")));
    default:
      return div();
  }
}

// 在 pane 内 x 处按下所命中的控件,无则 null。inner:卡片的内边距,
// 该 pane({ left, right });宽度:按 id 记录的控件实测宽度。
export function hit(s, x, inner, widths) {
  if (x == null) return null;
  if (s.kind === "option" || s.kind === "review") return s.disabled || !s.fn ? null : s;
  if (s.kind === "input") return s;
  const w = (c) => widths.get(c.id) ?? String(c.label).length * 7 + 18;
  const run = (ctls, gap, end, from) => {
    if (end) {
      let r = from;
      for (const c of [...ctls].reverse()) { const l = r - w(c); if (x >= l - 2 && x <= r + 2) return c; r = l - gap; }
    } else {
      let l = from;
      for (const c of ctls) { const r = l + w(c); if (x >= l - 2 && x <= r + 2) return c; l = r + gap; }
    }
    return null;
  };
  let c = null;
  if (s.kind === "head") c = run(s.links ?? [], LINK_GAP, true, inner.right);
  if (s.kind === "controls") {
    const gap = s.ctls.every((k) => k.look === "pill") ? GAPS.pill : GAPS.controls;
    if (s.align === "end") c = run(s.ctls, gap, true, inner.right);
    else c = run(s.ctls, gap, false, inner.left + (s.lead ? (widths.get(`lead:${s.lead}`) ?? s.lead.length * 7 + 2) + gap : 0));
  }
  return c && !c.disabled && c.fn ? c : null;
}

// 卡片的内边距取自列的设置(main.js edges()):即其 border 与 padding。
export const innerOf = ({ left, right }) => ({ left: left + 1 + PAD, right: right - 1 - PAD });

// 这些 strip 的所有控件在屏幕外各绘制一次,各自上报宽度(供 hit() 使用)。
// 在 render 中构建,位于列表之外——那里允许挂 handler。
export function measure(t, strips, widths, onChange, unzoom = (px) => px) {
  const ctls = [];
  for (const s of strips) {
    if (s.kind === "head") ctls.push(...(s.links ?? []));
    if (s.kind === "controls") {
      ctls.push(...s.ctls);
      if (s.lead) ctls.push({ id: `lead:${s.lead}`, lead: s.lead });
    }
  }
  return div().absolute().top(0).left(0).h(0).overflow_hidden().opacity(0)
    .child(h_flex().items_start().children(ctls.map((c) => div().id(`mwb-${c.id}`).flex_none()
      .on_size_change((size, cx) => { const w = unzoom(size.width); if (widths.get(c.id) !== w) { widths.set(c.id, w); onChange?.(cx); } })
      .child(c.lead ? div().flex_none().pr(2).text_size(TEXT.label).child(c.lead) : ctlEl(t, c, "mw-")))));
}
