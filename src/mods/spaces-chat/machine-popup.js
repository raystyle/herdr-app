// 机器详情,形如 herdr-winapp 的 health 和 plan-limits 气泡:从
// 侧边栏其 header 上的仪表,以 props { view: "machine", machine } 将本 mod 作为 popup 打开。
// 其 CPU、内存与磁盘,然后是那边各 agent CLI 的 plan 余额(machines.js),读取
// 打开时若数据已超过一分钟则再取。其 header 标明数据新旧("Updated 2 min
// ago");其末行 Machine settings 打开 Settings > Machines。

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, theme } from "herdr";
import { openSettings, TEXT, RADIUS } from "./ui.js";
import { machineDetails, pollNow, statsOf } from "./machines.js";
// 其 header 的文字来自 shared core(web 的 machine popup 表述相同)。
import { freshWords } from "./core/machines.js";
import { machineLook } from "./sections.js";

export const MACHINE_POPUP = { width: 320, height: 480 };
const HEAD = 46, FOOT = 40;

// 位于计量条下方(其矩形取自 rectOf),右缘与计量条对齐。
export function openMachine(machine, r) {
  const at = r ? { x: Math.max(8, r.x + r.width - MACHINE_POPUP.width), y: r.y + r.height + 4 } : "pointer";
  openOverlay({ mod: "spaces-chat", kind: "popup", ...MACHINE_POPUP, at, props: { view: "machine", machine: machine ?? null } });
}

export function openMachineSettings() {
  openSettings({ section: "machines" });
}

export class MachinePopup {
  init(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    const m = props().machine ?? null;
    const s = statsOf(m);
    this.reading = !s?.limitsAt || Date.now() - s.limitsAt > 60000;
    if (this.reading) cx.spawn(async (cx) => { await pollNow({ limitsOlder: 60000, only: m }); this.reading = false; cx.notify(); });
  }

  render() {
    const t = theme();
    const p = props();
    const m = p.machine ?? null;
    const look = machineLook(m);
    const at = statsOf(m)?.at;
    const fresh = freshWords(at, this.reading);
    return v_flex().id("machine-popup").track_focus(this.handle).size_full().min_h(0).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(h_flex().flex_none().h(HEAD).px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(16).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).font_semibold().text_color(t.foreground).child(look.name))
        .child(div().flex_none().text_size(TEXT.label).text_color(t.dim).child(fresh)))
      // popup 高度与其内容一致:body 占剩余高度,可滚动。
      .child(div().id("machine-popup-body").w_full().h(MACHINE_POPUP.height - HEAD - FOOT).flex_none().overflow_y_scrollbar().mode("always")
        .child(div().px(14).py(12).child(machineDetails(t, m))))
      .child(h_flex().id("machine-popup-settings").flex_none().h(FOOT - 8).mx(6).mb(6).px(8).gap(8).rounded(RADIUS.control).items_center().cursor_pointer()
        .text_size(TEXT.body).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => { closeOverlay(p.overlay); openMachineSettings(); })
        .child(svg("mods/workspace-chrome/settings.svg").size(16).flex_none())
        .child(div().flex_1().child("机器设置"))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(12)));
  }
}
