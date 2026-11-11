// 任务的状态标记:herdr-winapp 的任务圆点(src/ui.tsx Dot,src/styles.css .dot.*),每一个
// 放在 14px 的盒子里,状态变化时布局不动。
// 共享文件:源文件是 lib/dot.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的每个 mod 里。
// 编辑 lib/dot.js(不要编辑 mod 里的副本),然后运行 bin/sync-shared。
// working  amber 色的环,内部饼图按完成百分比填充(5% 一档,
// 最少 5%;报告无进度时显示半满)
// needs    10px 红点(带晕:其周围一圈淡环,同 herdr-winapp 的 chat 头部)
// ready    绿色,白色对勾        done     同样式灰色
// merging  带四分之一缺口的绿环,旋转
// queued   带时钟两针的灰环      todo  灰环      off  虚线
// scheduled 小灰日历
import { div, svg } from "gpui-kit";
import { theme } from "herdr";
import { terminals } from "./live.js";
import { red, green, amber } from "./ui.js";

// herdr-winapp 自己的红、绿、琥珀色,浅色与深色两套:应用内唯一来源,在 ui.js。
// 灰色取自主题。
const needColor = red;
const readyColor = green;

// 饼图:圆环内含实心扇形,自十二点方向顺时针,半径为 14 中的 3.5
// (herdr-winapp 的 inset 3.5px),每 5% 一张图,位于 mods/tasks/pie/。用图片,不用 paint_path:其
// 这个尺寸下 arc 只画出扇形轮廓,看起来像时钟指针。
const pie = (pct) => `mods/tasks/pie/${Math.min(100, Math.max(5, Math.round(pct / 5) * 5))}.svg`;

const box = () => div().relative().size(14).flex_none();
const ring = (color, file = "circle") => svg(`mods/tasks/${file}.svg`).size(14).flex_none().text_color(color);

// 状态:needs、working、merging、ready、queued、scheduled、todo、done、off。pct:完成百分比(working 时)。
export function taskDot(s, { pct = null, halo = false } = {}) {
  const t = theme();
  switch (s) {
    case "working": return svg(pie(Number.isFinite(pct) ? pct : 50)).size(14).flex_none().text_color(amber());
    case "needs": return box().items_center().justify_center().flex()
      .child(div().size(10).flex_none().rounded(5).bg(needColor()))
      .when(halo, (el) => el.child(div().absolute().top(-1).left(-1).size(16).rounded(8).border(1.5).border_color(needColor() + "4d")));
    case "ready":
    case "done": return box().rounded(7).bg(s === "ready" ? readyColor() : t.dim)
      .child(svg("mods/tasks/tick.svg").size(14).flex_none().text_color("#ffffff"));
    case "merging": return ring(readyColor(), "merging").spin(1400);
    case "queued": return ring(t.dim, "queued");
    case "scheduled": return ring(t.dim, "scheduled");
    case "off": return ring(t.dim, "off");
  }
  return ring(t.dim);
}

// agent 自报的完成百分比(OSC 7501 progress:其终端的 `report`),取第一个
// 执行此操作的终端,否则为 null;附其消息。
export function ownProgress(addresses) {
  for (const a of addresses) {
    const r = terminals().find((k) => k.address === a)?.report;
    if (typeof r?.progress === "number" && r.progress >= 0) return { pct: r.progress, msg: r.msg || null };
  }
  return null;
}

// agent 给出后即显示剩余分钟数(core/tasks.js,与 web app 共享)。
export { estimated } from "./core/tasks.js";
