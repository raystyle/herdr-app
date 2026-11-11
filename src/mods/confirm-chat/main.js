// 在破坏性操作前询问,例如 "Close space?"(Herdr 的 confirm;我们的是应用唯一的
// 对话框底栏)。以对话框打开,props 为 { title, detail, verb(按钮文字,如 "Close
// space”),danger(默认 true),command: { name, args } }。按钮写明其作用,绝不
// "Confirm"。破坏性提问时 Enter 不起作用(只能点击执行);否则 Enter 执行
// 。Esc 取消。openConfirm 决定其尺寸。

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";
import { dialogFooter, TEXT } from "./ui.js";

export default class Confirm extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  yes() {
    const p = props();
    closeOverlay(p.overlay);
    run(p.command.name, p.command.args ?? {});
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const danger = p.danger !== false;
    return v_flex()
      .id("confirm")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter" && !danger) this.yes();
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(8)
      .bg(t.popover)
      .text_size(TEXT.body)
      .child(div().text_size(TEXT.title).font_semibold().text_color(t.foreground).child(p.title ?? "确定?"))
      .child(div().flex_1().min_h(0).text_color(t.muted).child(p.detail ?? ""))
      .child(div().h(8).flex_none())
      .child(dialogFooter({ onCancel: () => closeOverlay(props().overlay),
        primary: { id: "yes", label: p.verb ?? "OK", onClick: () => this.yes() } }));
  }
}
