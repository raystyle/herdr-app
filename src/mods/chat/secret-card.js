// agent 请求密钥时的卡片(herdr-secret ask NAME --why …:请求方显示的标签,
// terminal,secrets.js 的 asksOf()):"Secret: NAME"、原因、遮蔽输入框、保存位置
// (其 space、其 machine、Everywhere;最具体的在前)、Save 与 Decline。Save 写入
// 直接存入本机 vault(secrets.js 的 keep());只把名称告知 agent。值绝不
// 经 hc send、会话、日志或 artifact 发送。其后几秒内,
// 卡片显示 "Kept: NAME"。在其发起提问的 agent 自己的聊天与其 Assistant 的
// 任务 worker 的聊天(main.js workerAsks()),以时间线条带呈现(strips.js)。

import { InputState } from "gpui-base";
import * as secrets from "./secrets.js";
import { terminals } from "./live.js";
import { headStrip } from "./cards.js";
import { green } from "./ui.js";

const KEPT_FOR = 6000;
const key = (address, name) => `${address}|${name}`;

export class SecretCards {
  constructor() {
    // 每个请求:{ box, level (scope key), err, busy };以及刚暂存的请求:{ name, why, where, at }。
    this.states = new Map();
    this.kept = new Map();
    // 此处保留或拒绝提问时得到通知:(ask, how),用于其淡色提示行(main.js)。
    this.onEnd = null;
  }

  // 终端的显示内容:先其提问,再显示刚保留的。
  items(address) {
    const now = Date.now(), out = secrets.asksOf(address, terminals()).map((a) => ({ address, ...a }));
    for (const [k, v] of this.kept) {
      if (now - v.at > KEPT_FOR) { this.kept.delete(k); continue; }
      if (v.address === address && !out.some((a) => a.name === v.name)) out.push({ address, name: v.name, why: v.why, kept: v.where });
    }
    return out;
  }

  // 自 render:为尚无输入框的请求创建(紧随其后创建,绝不在 render 中),以及
  // 已消失的 ask 的引用随之释放。
  prepare(list, cx) {
    const want = new Set(list.filter((a) => !a.kept).map((a) => key(a.address, a.name)));
    for (const [k, st] of this.states) if (!want.has(k) && !st.busy) { st.box?.release(); this.states.delete(k); }
    const missing = [...want].filter((k) => !this.states.has(k));
    for (const k of missing) this.states.set(k, { box: null, level: null, err: "", busy: false });
    if (missing.length) cx.timer.after(0, (cx) => {
      for (const k of missing) {
        const st = this.states.get(k);
        if (!st || st.box) continue;
        st.box = InputState.new({ placeholder: "粘贴值" });
        st.box.set_masked(true);
        st.box.on("change", (_e, cx) => { st.err = ""; cx.notify(); });
        st.box.on("submit", (_e, cx) => { const [address, name] = k.split("|"); this.save({ address, name }, cx); });
      }
      cx.notify();
    });
    if (this.kept.size && !this.keptTimer) {
      this.keptTimer = true;
      cx.timer.after(KEPT_FOR + 50, (cx) => { this.keptTimer = false; cx.notify(); });
    }
  }

  save(ask, cx) {
    const st = this.states.get(key(ask.address, ask.name));
    const value = st?.box?.value() ?? "";
    if (!st || st.busy) return;
    if (!value) { st.err = "请先粘贴值。"; cx.notify(); return; }
    const lv = this.level(ask, st);
    st.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await secrets.keep(ask.name, lv, value);
        st.box?.set_value("");
        this.kept.set(key(ask.address, ask.name), { address: ask.address, name: ask.name, why: ask.why, where: lv.label, at: Date.now() });
        this.onEnd?.(ask, `Kept for ${lv.label}`);
      } catch (e) { st.err = String(e?.message ?? e); }
      st.busy = false;
      cx.notify();
    });
  }

  // 提问的遮罩输入框是否已创建;focus() 会把键盘放进去。
  ready(ask) {
    return Boolean(this.states.get(key(ask.address, ask.name))?.box);
  }

  focus(ask) {
    this.states.get(key(ask.address, ask.name))?.box?.focus();
  }

  decline(ask, cx) {
    const st = this.states.get(key(ask.address, ask.name));
    if (st) st.busy = true;
    cx.spawn(async (cx) => { await secrets.decline(ask.address, ask.name); if (st) st.busy = false; this.onEnd?.(ask, "Declined"); cx.notify(); });
  }

  level(ask, st) {
    const lv = secrets.levels(ask.address);
    return lv.find((l) => secrets.scopeKey(l) === st?.level) ?? lv[0];
  }

 // 卡片的条带。opts:{ who(谁的提问:"Claude"、""),links(末尾的 [ctl]
  // 位于 header 右侧) }。
  strips(ask, opts = {}) {
    const id = `${ask.address}-${ask.name}`.replace(/[^\w-]/g, "_");
    const st = this.states.get(key(ask.address, ask.name));
    if (ask.kept) return [headStrip({ who: "Kept", asks: false, dot: green(), links: opts.links }),
      { key: "title", kind: "title", text: `Secret: ${ask.name}` },
      { key: "kept", kind: "text", tone: "dim", text: `For ${ask.kept}. The agent was told its name, never the value.` }];
    const lv = secrets.levels(ask.address), cur = this.level(ask, st);
    const has = Boolean(st?.box?.value());
    const out = [headStrip({ who: opts.who, links: opts.links }), { key: "title", kind: "title", text: `Secret: ${ask.name}` }];
    if (ask.why) out.push({ key: "why", kind: "text", tone: "muted", text: ask.why });
    out.push({ key: "box", kind: "input", state: st?.box ?? null, placeholder: "粘贴值", focus: () => st?.box?.focus() });
    if (lv.length > 1) out.push({ key: "for", kind: "controls", align: "start", lead: "For", ctls: lv.map((l) => ({ id: `slevel-${id}-${l.scope}`, label: l.label, look: "pill",
      on: secrets.scopeKey(l) === secrets.scopeKey(cur), fn: () => { if (st) st.level = secrets.scopeKey(l); } })) });
    out.push({ key: "note", kind: "text", tone: st?.err ? "red" : "dim", text: st?.err || "agent 按名字使用它,从不看到值。" });
    const live = has && !st?.busy;
    out.push({ key: "actions", kind: "controls", align: "end", ctls: [
      { id: `sdecline-${id}`, label: "Decline", look: "plain", fn: (cx) => this.decline(ask, cx) },
      { id: `ssave-${id}`, label: st?.busy ? "保存中…" : "Save", look: "primary", disabled: !live, fn: live ? (cx) => this.save(ask, cx) : null }] });
    return out;
  }
}
