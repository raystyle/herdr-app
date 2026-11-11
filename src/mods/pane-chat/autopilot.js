// Assistant header 中的 Autopilot(DECISIONS.md,"herdr-winapp gaps being closed"):一个简单的 on/off
// 开关在左侧,紧跟 agent 名称与文件夹之后)。herdr-task 会保留它(`herdr-task
// autopilot …,其 scheduler 负责唤醒 Assistant),位于 ~/.local/share/herdr-winapp/tasks/.autopilot.json;此处读取
// 该文件并请 herdr-task 修改。另一台 machine 的 space("vm/sp1")同理,从
// 该 machine 的文件:本机的 herdr-task 把开关交给那边的 herdr-task,由其调度器唤醒
// 它(其 Assistant 在那边运行)。
//
// 开关:"Autopilot",开启时其后以淡色显示下次唤醒。无菜单:heartbeat、
// 计划与事件,Everywhere 的或本 space 自己的,存于 herdr-winapp settings › Autopilot
// (core/autopilot.js pilotFor:本 space 的开关,其余取自身的或 Everywhere 的,来自
// ~/.config/herdr-winapp/settings.json)。点击时必定开启;heartbeat 尚为空期间,一条
// 其后的 "Write a heartbeat" 链接会打开那一页,作用于本 space。开关、其文字与 Run
// 现合并为一组(apGroup),放在与 Chat | Terminal 等高的安静 pill 上,与 web 应用 header 一致。

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { link, TEXT, H, RADIUS, openSettings, toast, plainError } from "./ui.js";
import { theme, home, appHome, exec, readTextFile, notify, shared, setShared } from "herdr";
import { terminals } from "./live.js";
import { pilotFor, headerDetail, flipped } from "./core/autopilot.js";
import { SH } from "./core/paths.js";
import { dirs } from "./dirs.js";

const FILE = () => `${dirs().tasks}/.autopilot.json`;
const SETTINGS = () => dirs().settings;
const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task.cmd`;
// 窄 header 只显示开关和 Run now 的 ▶。
export const COMPACT_BELOW = 480;

// Assistant 运行在本终端(或停靠在本 lazy slot)的 space,否则 null;其他
// 其他 machine 的显示为 "vm/sp1"。
export function apSpace(address, lazy) {
  if (lazy) return lazy.space ? String(lazy.space) : null;
  if (!address) return null;
  const l = terminals().find((x) => x.address === address)?.labels ?? {};
  if (l["herdr.role"] !== "coordinator") return null;
  // 同 herdr-task 查找 Assistant 自身 space 的方式(my_space):其 label 是它在自己 machine 上的 id。
  const sp = l["herdr.space"] ?? l["herdr.coordinator.space"];
  const m = address.includes("/") ? address.slice(0, address.indexOf("/")) : null;
  return !sp ? null : m ? `${m}/${sp.split("/").pop()}` : sp.includes("/") ? null : sp;
}

// 另一台 machine 的 space:(其 machine,它在当地的 id);本机的则为 null。
const remoteOf = (space) => (space.includes("/") ? { machine: space.slice(0, space.indexOf("/")), id: space.slice(space.indexOf("/") + 1) } : null);
// 其 machine 上的文件,每三次轮询读取一次(约每 12 秒):herdr-core 经连接向它询问。
const READ = SH + 'cat "$SHEP_TASKS/.autopilot.json" 2>/dev/null || true';
async function fileOf(view, space) {
  const r = remoteOf(space);
  if (!r) return JSON.parse((await readTextFile(FILE())) ?? "{}");
  if (view.apFile && view.apFile.space === space && (view.apTick = (view.apTick ?? 0) + 1) % 3) return view.apFile.file;
  const out = (await exec("sh", ["-c", READ], { on: r.machine })).stdout;
  const d = JSON.parse(out || "{}");
  // 按本机的命名方式,因此这里(以 "vm/sp1")适用于该 space 自己的设置。
  const file = { ...d, spaces: { [space]: d?.spaces?.[r.id] ?? {} } };
  view.apFile = { space, file };
  return file;
}

// header 显示的内容,文字也会变:"Next in 7 min" 在两次读取之间倒计时(每次 poll 重新查看)。
const sig = (a) => JSON.stringify([a?.on, a?.next_run, Boolean(a?.pending), Boolean(a?.inflight), a?.every, a?.events, headerDetail(a)]);

// 从文件读取此 header 的 space;仅当开关显示的内容变化时才重绘。
export function apPoll(view, cx) {
  const space = view.apFor;
  if (!space || view.apBusy) return;
  cx.spawn(async (cx) => {
    let a = null;
    // 此处生效的配置:space 自己的,否则用 Everywhere 的(core/autopilot.js,herdr-task 同规则)。
    let cfg = null;
    try { cfg = JSON.parse((await readTextFile(SETTINGS())) ?? "{}"); } catch {}
    try { a = pilotFor(await fileOf(view, space), space, cfg); } catch { a = view.ap ?? { on: false }; }
    if (view.apFor !== space || view.apBusy) return;
    // 开启后 heartbeat 可能还是空的:会不时查看(约每 30 秒)直到写入。
    if (a.on && view.apBlank !== false && (view.apBeat = (view.apBeat ?? 0) + 1) % 8 === 1) checkBlank(view, space, cx);
    if (!a.on) view.apBlank = null;
    if (view.ap && sig(a) === sig(view.ap)) return;
    view.ap = a;
    cx.notify();
  });
}

// 本 space 的 heartbeat 是否仍为空(view.apBlank);变化时重绘。
function checkBlank(view, space, cx) {
  cx.spawn(async (cx) => {
    let blank = null;
    try { blank = Boolean((await ap(["show"], space)).blank); } catch {}
    if (view.apFor !== space || blank === null || blank === view.apBlank) return;
    view.apBlank = blank;
    cx.notify();
  });
}

// 由 render 调用:新 space(或翻转后的刷新)会重新读取该文件。
export function apWatch(view, space, cx) {
  const bump = shared("autopilot.at") ?? 0;
  if (space === view.apFor && bump === view.apBump) return;
  if (space !== view.apFor || bump !== view.apBump) view.apFile = null;
  if (space !== view.apFor) { view.ap = null; view.apBlank = null; view.apBeat = 0; }
  view.apFor = space;
  view.apBump = bump;
  if (space) cx.timer.after(0, (cx) => apPoll(view, cx));
}

// 开启期间 "Autopilot" 之后的字样(core/autopilot.js,web 端标题同)。
const detail = (a) => headerDetail(a);

// 开关按 herdr-winapp settings 的 toggle 画法,与标题同高;滑块平移。
function knob(t, on, pane) {
  return div().relative().w(28).h(16).flex_none().rounded(8).bg(on ? t.accent : t.hover)
    .child(div().id(`ap-knob-${pane}`).absolute().top(2).left(on ? 14 : 2).size(12).rounded(6)
      .bg(on ? t.accent_foreground : t.muted).transition("left", 120));
}

// 分组:放在与 Chat | Terminal 等高的 pill 上(ui.js segmented:H.sm,raised)。开启时显示其等待内容与 Run now
// (apRunNow)排在最前,位于开关左侧,然后是开关和 "Autopilot":pill 随之变宽
// 左移,开关保持不动,无论开或关。紧凑模式:仅 Run now 的 ▶ 和开关。
export function apGroup(view, t, space, pane, compact) {
  const run = apRunNow(view, t, space, pane, compact);
  const a = view.ap;
  const words = !compact && a?.on ? detail(a) : "";
  return h_flex().id(`ap-group-${pane}`).flex_none().h(H.sm).p(2).gap(7).items_center()
    .pr(compact ? 6 : 10).pl(words ? 10 : run ? 2 : 6)
    .rounded(RADIUS.control).bg(t.raised).text_size(TEXT.label)
    .when(Boolean(words), (el) => el.child(div().flex_none().whitespace_nowrap().text_color(t.dim)
      .when(Boolean(a?.inflight), (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 }))
      .child(words)))
    .when(Boolean(run), (el) => el.child(run))
    .child(apChip(view, t, space, pane, compact));
}

function apChip(view, t, space, pane, compact) {
  const on = Boolean(view.ap?.on);
  return h_flex().id(`ap-${pane}`).flex_none().gap(7).items_center().cursor_pointer()
    .on_click((_e, cx) => { cx.stop_propagation(); apToggle(view, space, cx); })
    .child(knob(t, on, pane))
    .when(!compact, (el) => el.child(div().flex_none().font_medium().text_color(on ? t.foreground : t.muted).child("Autopilot")));
}

// herdr-task autopilot <args> --space <space>:返回其 JSON,失败则抛出其错误信息。
async function ap(args, space) {
  const r = await exec(CLI(), ["autopilot", ...args, "--space", space, "--json"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  if (r.code !== 0 || !out || out.error) throw new Error(out?.error ?? (r.stderr || "herdr-task failed").replace(/^herdr-task: /, "").trim());
  return out;
}

// 该 space 的 Settings › Autopilot:其自身设置,以及从 Everywhere 继承的部分。
const openAutopilot = (space) => openSettings({ space, section: "autopilot" });

// Run now(herdr-task autopilot run-now):开启时启动该组;排队至 Assistant 空闲,这一点
// 开关文字随之变化("Queued"、"Waking")。已有排队或运行中的则置灰且不可点。类似
// 分段:悬停时像选中项一样上浮。紧凑模式:仅显示其 ▶。
function apRunNow(view, t, space, pane, compact) {
  const a = view.ap;
  if (!a?.on || view.apBusy) return null;
  const busy = Boolean(view.apRunning || a.pending || a.inflight);
  const words = view.apRunning && !a.pending && !a.inflight ? "排队中…" : "立即运行";
  return h_flex().id(`ap-run-${pane}`).flex_none().h_full().px(compact ? 5 : 7).gap(4).items_center()
    .rounded(RADIUS.control - 2).whitespace_nowrap().text_color(busy ? t.dim : t.muted)
    .when(busy, (el) => el.opacity(0.6))
    .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.background).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); apRun(view, space, cx); }))
    .child(svg("mods/pane-chat/play.svg").size(11).flex_none())
    .when(!compact, (el) => el.child(words));
}

function apRun(view, space, cx) {
  if (view.apRunning) return;
  view.apRunning = true;
  cx.notify();
  cx.spawn(async (cx) => {
    try { view.ap = await ap(["run-now"], space); }
    catch (e) { toast({ title: "Autopilot 没有唤醒", body: plainError(e), level: "error" }); }
    view.apRunning = false;
    setShared("autopilot.at", Date.now());
    cx.notify();
  });
}

// "Write a heartbeat":开关开启且 heartbeat 仍为空时,显示在分组之前。
export function apHeartbeatLink(view, space, pane) {
  return view.ap?.on && view.apBlank === true ? link(`ap-beat-${pane}`, "Write a heartbeat", () => openAutopilot(space)) : null;
}

// 切换开关。heartbeat 为空也能开启;随后 header 提示 "Write a heartbeat"。
function apToggle(view, space, cx) {
  const was = view.ap;
  if (!was || view.apBusy) return;
  const on = !was.on;
  view.apBusy = true;
  // 立即切换(开启即 "Waking":马上唤醒);herdr-task 的回复随后说明其余。
  view.ap = flipped(was, on);
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      view.ap = await ap([on ? "on" : "off"], space);
      if (on) checkBlank(view, space, cx);
    } catch (e) {
      view.ap = was;
      toast({ title: `Autopilot didn't turn ${on ? "on" : "off"}`, body: plainError(e), level: "error" });
    }
    view.apBusy = false;
    setShared("autopilot.at", Date.now());
    cx.notify();
  });
}
