// coordinator 的设置以紧凑行呈现(agent 与 model、reasoning、fast、permissions),
// 选项与取值与聊天模型菜单(mods/chat-models)一致。供以下使用:
// New space dialog(mods/newspace)与 Settings(mods/herdr-winapp-settings),连同 agent.js。
// Shared:源文件为 lib/settings.js;bin/sync-shared 复制进 lib/COPIES 中的每个 mod。
// 请编辑 lib/settings.js,不要改 mod 里的副本,然后运行 bin/sync-shared。
// const data = await loadChoices(machine);       本机 agent 提供的选项
// coord = { sel: await lastUsed(data), data };    所选项:{ agent, model, effort, fast, perm }
// modelButton(theme(), coord, { disabled }, cx)   一个按钮("Opus 5.5 · high ⌄"),即
// chat 输入框所用的样式,同时打开模型菜单
// settingsRows(theme(), coord, { disabled }, cx)  或以行形式呈现同样的内容(用 render 的 cx 渲染)
// await saveLastUsed(coord.sel)                    Create 时:下次从这里开始
// 惰性 Coordinator 聊天以 props.settings 拿到该选择,并据此启动其 agent。
// 行的下拉菜单以 pick 模式打开 mods/chat-models;其结果经 shared state 返回
// "newspace.pick" = { key, field, value, at },各行在下一次 render 时应用。

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { knownAgents, openOverlay, shared, appHome } from "herdr";
import * as fs from "fs/promises";
import * as agent from "./agent.js";
// 按钮的文案与可选设置项:core/settings.js,与 web 应用的 Settings 共享。
import { modelLabel, choicesFrom } from "./core/settings.js";
import { permAcross } from "./core/agents.js";

const ROW = 31, LABEL = 110;
const LEVEL = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "特高", max: "Max", ultra: "Ultra", none: "None" };
const LAST = () => `${appHome()}/data/coordinator-last.json`;

// 本机(或 `machine`)上 agents 提供的选项:{ menus, icons, installed, permDefault,
// defaults }(defaults:CLI 自带,供首次使用)。
export async function loadChoices(machine = null) {
  const [claude, codex, known] = await Promise.all([agent.defaults("claude", machine), agent.defaults("codex", machine),
    knownAgents({ on: machine }).catch(() => [])]);
  const prog = (k) => known.find((a) => a.key === k || (a.run ?? [])[0] === k);
  const installed = Object.fromEntries(["claude", "codex"].map((k) => [k, prog(k) ? prog(k).installed !== false : k === "claude"]));
  const icons = Object.fromEntries(["claude", "codex"].map((k) => [k, { icon: prog(k)?.icon ?? null, tint: Boolean(prog(k)?.tint) }]));
  const { menus, permDefault, defaults } = choicesFrom({ claude, codex }, installed);
  return { menus, icons, installed, permDefault, defaults };
}

// 上次的选择(data/coordinator-last.json),仍与当前可选项匹配时使用,否则
// 默认值。
export async function lastUsed(data) {
  let s = null;
  try { s = JSON.parse(await fs.readFile(LAST(), "utf8")); } catch {}
  const m = s && data.menus[s.agent]?.models?.find((x) => x.id === s.model);
  return m ? { agent: s.agent, model: s.model, effort: m.efforts.includes(s.effort) ? s.effort : null, fast: Boolean(s.fast && m.fast),
    perm: data.menus[s.agent].perms.some((p) => p.id === s.perm) ? s.perm : data.permDefault[s.agent] } : { ...data.defaults };
}

export async function saveLastUsed(sel) {
  try {
    await fs.mkdir(`${appHome()}/data`, { recursive: true });
    await fs.writeFile(LAST(), JSON.stringify(sel));
  } catch {}
}

const modelOf = (data, sel) => data?.menus?.[sel?.agent]?.models?.find((m) => m.id === sel.model) ?? null;

// 选定模型:effort 和速度保持该模型现有的;换 agent 则带来其自身的
// 权限模式中取最接近所选的一个(core/agents.js 的 permAcross)。
function choose(coord, agentKey, id) {
  const { sel, data } = coord;
  const m = data.menus[agentKey]?.models?.find((x) => x.id === id);
  if (!m) return;
  const next = { ...sel, agent: agentKey, model: id };
  if (next.effort && !m.efforts.includes(next.effort)) next.effort = null;
  if (!m.fast) next.fast = false;
  if (agentKey !== sel.agent) next.perm = permAcross(sel.perm, agentKey, data.permDefault);
  coord.sel = next;
}

// 各行。`coord` = { sel, data };disabled:置灰且不可操作(无 coordinator)。
export function settingsRows(t, coord, opts = {}, cx = null) {
  const { sel, data } = coord;
  if (!sel || !data) return v_flex().h(ROW).justify_center().px(9).text_size(12.8).text_color(t.dim).child("加载 agent…");
  coord.key ??= `ns-${Math.random().toString(36).slice(2, 8)}`;
  const off = Boolean(opts.disabled);
  // 下拉框的应答(shared "newspace.pick"):本次 render 之后应用一次。
  applyReply(coord, cx);
  const menu = data.menus[sel.agent];
  const m = modelOf(data, sel);
  const icon = (a) => {
    const ic = data.icons?.[a];
    if (!ic?.icon) return div().size(14).flex_none();
    return ic.tint ? svg(ic.icon).size(14).flex_none().text_color(t.foreground) : image(ic.icon).size(14).flex_none();
  };
  const row = (label, control) => h_flex().h(ROW).flex_none().px(9).gap(10).items_center()
    .child(div().w(LABEL).flex_none().text_color(t.muted).child(label))
    .child(h_flex().flex_1().min_w(0).justify_end().child(control));
  const pickAt = (field, options, current) => openOverlay({ mod: "chat-models", kind: "popup", width: 260, height: 10 + ROW * options.length,
    props: { pick: field, key: coord.key, options, current, width: 260, height: 10 + ROW * options.length } });
  const select = (id, content, fn) => h_flex().id(id).h(26).max_w(260).pl(8).pr(6).gap(6).items_center().rounded(7).border_1().border_color(t.input)
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); fn(); cx.notify(); }))
    .children(content)
    .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none().text_color(t.dim));
  const models = Object.entries(data.menus).flatMap(([a, mm]) => mm.models.map((x) => ({ id: `${a}:${x.id}`, label: x.name, icon: data.icons?.[a]?.icon, tint: data.icons?.[a]?.tint })));
  const levels = m?.efforts ?? [];
  const level = sel.effort ?? m?.defaultEffort ?? null;
  const fastOk = Boolean(m?.fast);
  const perm = menu?.perms?.find((p) => p.id === sel.perm);
  return v_flex().w_full().text_size(12.8).text_color(t.foreground).when(off, (el) => el.opacity(0.45))
    .child(row("Agent", select("ns-model", [icon(sel.agent), div().min_w(0).truncate().child(m?.name ?? sel.model ?? "Choose")],
      () => pickAt("model", models, `${sel.agent}:${sel.model}`))))
    .child(row("Reasoning", h_flex().h(26).p(2).gap(2).rounded(7).bg(t.raised).children(levels.map((e) =>
      h_flex().id(`ns-level-${e}`).h_full().px(7).justify_center().items_center().rounded(5).text_size(11.5)
        .when(level === e, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
        .when(level !== e, (el) => el.text_color(t.muted).when(!off, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); coord.sel = { ...coord.sel, effort: e }; cx.notify(); })))
        .child(LEVEL[e] ?? e)))))
    .when(fastOk, (el) => el.child(row("Fast", div().id("ns-fast").relative().w(28).h(16).flex_none().rounded(8).bg(sel.fast ? t.accent : t.input)
      .when(!off, (el) => el.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); coord.sel = { ...coord.sel, fast: !coord.sel.fast }; cx.notify(); }))
      .child(div().id("ns-fast-knob").absolute().top(2).left(sel.fast ? 14 : 2).size(12).rounded(6).bg(t.background).transition("left", 120)))))
    .when(Boolean(menu?.perms?.length), (el) => el.child(row("Permissions", select("ns-perm",
      [svg("mods/chat-models/shield.svg").size(14).flex_none().text_color(t.dim), div().min_w(0).truncate().child(perm?.label ?? "Default")],
      () => pickAt("perm", menu.perms.map((p) => ({ id: p.id, label: p.label })), sel.perm)))));
}

// 来自 model 菜单(settings 模式)与选择列表的回答,写入 coord.sel。
function applyReply(coord, cx) {
  const reply = shared("newspace.pick");
  if (!reply || reply.key !== coord.key || reply.at === coord.pickAt || !cx) return;
  coord.pickAt = reply.at;
  cx.timer.after(0, (cx) => {
    if (reply.field === "settings" && reply.value?.agent) coord.sel = { ...reply.value };
    if (reply.field === "model") { const [a, ...id] = String(reply.value).split(":"); choose(coord, a, id.join(":")); }
    if (reply.field === "perm") coord.sel = { ...coord.sel, perm: reply.value };
    cx.notify();
  });
}

// 选择项的显示文字,与 composer 按钮一致:"Opus 5.5 · 1M · High · Fast"。
export function settingsLabel(coord) {
  return modelLabel(coord.data?.menus, coord.sel);
}

// 一个低调按钮,28 px,如同聊天 composer 的 model 按钮:打开 model 菜单
// (mods/chat-models,settings 模式)锚定于它,空间足够时在上方,否则在下方;
// 彼处的每次变更都会写回 coord.sel。disabled:置灰且不可操作。label:显示的
// 而非该选项(设置中未设 Reviewer 时:“Other CLI (Codex)”)。
export function modelButton(t, coord, opts = {}, cx = null) {
  const { sel, data } = coord;
  const off = Boolean(opts.disabled) || !sel || !data;
  coord.key ??= `ns-${Math.random().toString(36).slice(2, 8)}`;
  if (sel && data) applyReply(coord, cx);
  return h_flex().id(`ns-model-${coord.key}`).h(28).pl(8).pr(5).gap(4).flex_none().min_w(0).items_center().rounded(7)
    .text_size(12).font_medium().text_color(off ? t.dim : t.muted).when(off, (el) => el.opacity(0.6))
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (e) => { coord.at = e.bounds ?? (e.position ? { x: e.position.x - 40, y: e.position.y - 14, width: 80, height: 28 } : null); })
      .on_click((_e, cx) => { cx.stop_propagation(); openMenu(coord); cx.notify(); }))
    .child(div().min_w(0).truncate().child(sel && data ? opts.label ?? settingsLabel(coord) : "加载 agent…"))
    .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none());
}

// 按钮上方的 model 菜单。overlay 高度取菜单展开到最高时的高度(按聊天的算法)。
// select:{ agent, model } 已选好(如输入 /model sonnet),立即回告。
export function openMenu(coord, select = null) {
  const { sel, data } = coord;
  // 边框与内边距、agent tab、搜索、列表(超过 8 行可滚动)、分隔线,
  // Reasoning 标题与各档、Fast、Permissions(chat-models 的尺寸)
  const W = 340, H = 2 + 10 + 34 + 36 + 8 * 31 + 9 + 26 + 34 + 31 + 31;
  const b = coord.at;
  const at = b ? { x: Math.max(8, b.x + b.width - W), y: b.y - H - 6 >= 8 ? b.y - H - 6 : b.y + b.height + 6 } : "pointer";
  openOverlay({ mod: "chat-models", kind: "popup", frame: "none", width: W, height: H, at,
    props: { mode: "settings", key: coord.key, width: W, height: H, remote: null, select,
      current: { agent: sel.agent, model: sel.model, effort: sel.effort ?? null, fast: Boolean(sel.fast), perm: sel.perm ?? null },
      menus: data.menus, icons: data.icons, permDefault: data.permDefault } });
}

// 也叫 settingsButton(New space dialog 商定的名称)。
export const settingsButton = modelButton;
