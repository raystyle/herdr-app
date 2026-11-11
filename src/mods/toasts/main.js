// 我们的 toast(Herdr 自带 toast 的克隆,只有 Herdr 的 notify() 能触发):悬浮于
// 工作区右下角({ "floating": [{ "content": { "mod": "toasts" }, "edge": "bottom",
// "align": "end" }] } 位于 layout 中)。mods 通过 ui.js 的 toast() 发布,由它统一管理
// shared "toasts"(最新在后);此处绘制最后三条。每条:一个 dot(告警或错误为红,
// 红为错误、黄为警告、绿为完成,其余用强调色),标题一行,正文
// 最多折为 3 行,悬停时显示 X。点击执行其操作(跳到该 agent)
// 并关闭它。各自到超时时间即消失;指针悬停其上时不消失。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { placement, run, shared, setShared, theme } from "herdr";
import { note } from "./usage.js";
import { TOASTS, TEXT, RADIUS, red, amber, green } from "./ui.js";
// 数量、宽度、时长与颜色:core/toasts.js,与 web app 的 toast 共用。
import { SHOWN, WIDTH, LINES, BODY_MAX, tone, clip, unexpired } from "./core/toasts.js";

const LINE = 18;    // 正文的行高:至多 LINES(3) 行

const color = (level, t) => ({ red: red(), amber: amber(), green: green() }[tone(level)] ?? t.accent);

export default class Toasts extends View {
  init(_props, cx) {
    this.hovered = null;
    // 用量洞察(lib/usage.js):每条错误 toast 记一次(只记类别,不记具体文字)。
    this.seen = new Set();
    // 过期检查:每秒一次,且有项过期时才写入。
    cx.timer.every(1000, () => {
      const list = shared(TOASTS) ?? [];
      for (const n of list) if (n.level === "error" && !this.seen.has(n.id)) { this.seen.add(n.id); note("error", { type: "toast" }); }
      for (const id of this.seen) if (!list.some((n) => n.id === id)) this.seen.delete(id);
      if (placement()?.hovered) return;
      const left = unexpired(list);
      if (left.length !== list.length) setShared(TOASTS, left);
    });
  }

  dismiss(id) {
    setShared(TOASTS, (shared(TOASTS) ?? []).filter((n) => n.id !== id));
  }

  item(n, first, t) {
    const on = this.hovered === n.id;
    const act = n.action?.name;
    return h_flex().id(`toast-${n.id}`).w_full().pl(12).pr(6).py(10).gap(10).items_start().rounded(RADIUS.card)
      .when(!first, (el) => el.border_t(1).border_color(t.border).rounded(0))
      .on_hover((h, cx) => { this.hovered = h ? n.id : this.hovered === n.id ? null : this.hovered; cx.notify(); })
      .when(Boolean(act), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); run(n.action.name, n.action.args ?? {}); this.dismiss(n.id); }))
      .child(div().size(8).mt(5).flex_none().rounded(4).bg(color(n.level, t)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().min_w(0).truncate().text_size(TEXT.body).font_semibold().text_color(t.foreground).child(String(n.title ?? "")))
        .when(Boolean(n.body), (el) => el.child(div().max_h(LINE * LINES).overflow_hidden().line_height(`${LINE}px`)
          .text_size(TEXT.label).text_color(t.muted).child(clip(String(n.body), BODY_MAX)))))
      // X 的位置始终保留,因此它出现时不会挤动其他内容。
      .child(div().id(`toast-x-${n.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
        .when(on, (el) => el.cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.dismiss(n.id); cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(14))));
  }

  render() {
    const list = (shared(TOASTS) ?? []).slice(-SHOWN);
    if (!list.length) return div();
    const t = theme();
    return v_flex().id("toasts").w(WIDTH).children(list.map((n, i) => this.item(n, i === 0, t)));
  }
}
