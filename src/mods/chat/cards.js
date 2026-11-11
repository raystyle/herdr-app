// 回答 Claude 经 PermissionRequest hook 提问的卡片(asks.js):一
// 权限或计划(Allow / Deny),或提问(AskUserQuestion:步骤、选项、"Other…"、
// "Chat about this",单个 Submit)。chat 把它显示在提出时的会话里,如同
// 时间线的 strips(strips.js)。其余由 host 完成:host.reply(ask, text, cx) 发送
// 向 hook 提供答案,host.toTerminal(ask, cx) 打开 agent 的 terminal,
// host.chatAbout(ask, cx) 打开用户可与其对话之处。
// 聊天显示的每张卡片(此类、secret 的、CLI 的启动屏)都以同一个 header 开头
// strip(headStrip):红色圆点、“Claude asks” 或 “asks”,右侧为浅色链接。
// 每个请求的 header 以 "Dismiss" 结尾(Esc 亦可,卡片被按下后):不输入答案即关闭
// 回答,如同在 Claude 提示行按 Esc;agent 得知被拒后继续工作。

import { div } from "gpui-kit";
import { InputState } from "gpui-base";
import { allow, deny, answer, answers, annotationsOf, chatAbout, dismiss, release } from "./core/asks.js";

// 卡片的第一条 strip。opts:{ who ("Claude"、""), asks (false:`who` 之后的内容
// 改为其他文字,如 “Kept”)、dot(颜色,默认红)、links(右侧的 [ctl]) }。
export const headStrip = (opts) => ({ key: "head", kind: "head", who: opts.asks === false ? opts.who : `${opts.who ?? "Claude"} asks`, dot: opts.dot, links: opts.links ?? [] });

// 卡片 header 的 quiet 链接(strips.js ctl)。
export const linkCtl = (id, label, fn) => ({ id, label, look: "link", fn });

// 请求的详情:每一行都换行放入一个框。长行折叠到 SHORT px,可用 "Show all" 展开
// 在 header 中(open:未折叠 id 集合);展开后整块随聊天一起滚动。
const SHORT = 180;
const longDetail = (detail) => detail.split("\n").length > 9 || detail.length > 900;

export class AskCards {
  // focus:问题卡片按键的接入手柄(sink())。
  constructor(host, focus) {
    this.host = host;
    this.focus = focus;
    this.states = new Map();
    // 哪些请求的长详情被展开("Show all")。
    this.open = new Set();
    // 按键送往的问题卡片(最后按下的一张)。
    this.keyed = null;
  }

 // 单个提问卡片的条带。opts:{ who(谁的提问:"Claude"、""),links(更多
  // 浅色链接置于 header 右侧,如 "Open chat"),terminal(即 "Answer in terminal"
  // link;默认开启)、chatHint(“Chat about this” 的文案) }。
  strips(ask, opts = {}) {
    const w = ask.words;
    if (w.kind === "questions" && w.questions.length) return this.questions(ask, opts);
    const id = ask.id;
    const long = Boolean(w.detail) && longDetail(w.detail);
    const open = this.open.has(id);
    const links = [...(opts.links ?? []),
      ...(long ? [linkCtl(`ask-all-${id}`, open ? "收起" : "显示全部", () => { if (open) this.open.delete(id); else this.open.add(id); })] : []),
      ...(opts.terminal !== false ? [this.terminalLink(ask)] : []), this.dismissLink(ask)];
    const out = [headStrip({ who: opts.who, links }), { key: "title", kind: "title", text: w.title }];
    if (w.detail) out.push({ key: "detail", kind: "detail", lines: w.detail.split("\n"), clip: long && !open ? SHORT : null });
    if (w.cut) out.push({ key: "cut", kind: "text", tone: "dim", text: "内容太长,对话装不下;终端里能看全。" });
    if (w.kind === "question") {
      // 问题的选项,每个占整行宽度(一行按钮可能超出卡片)。
      w.options.forEach((o, i) => out.push({ key: `opt${i}`, kind: "option", gap: i ? 2 : 8, num: i + 1, label: o.label,
        fn: (cx) => this.host.reply(ask, answer(ask.req, o.label), cx) }));
    } else {
      const ctls = [];
      // 这里总是可以应答;只有聊天完全无法读取的请求才转到 terminal。
      if (!w.unread) ctls.push({ id: `ask-allow-${id}`, label: w.kind === "plan" ? "Approve" : "Allow", look: "primary", fn: (cx) => this.host.reply(ask, allow(), cx) });
      ctls.push({ id: `ask-deny-${id}`, label: w.kind === "plan" ? "Keep planning" : "Deny", look: "secondary",
        fn: (cx) => this.host.reply(ask, w.kind === "plan" ? deny("The person didn't approve this plan yet. Ask them what to change.") : deny(), cx) });
      out.push({ key: "actions", kind: "controls", align: "start", ctls });
    }
    return out;
  }

  // "Answer in terminal":quiet 链接,始终位于 header 右侧。
  terminalLink(ask) {
    return linkCtl(`ask-terminal-${ask.id}`, "在终端里回答", (cx) => { this.drop(ask); this.host.reply(ask, release(), cx); this.host.toTerminal(ask, cx); });
  }

  // "Dismiss":quiet 链接,位于 header 最后。
  dismissLink(ask) {
    return linkCtl(`ask-dismiss-${ask.id}`, "Dismiss", (cx) => this.dismiss(ask, cx));
  }

  dismiss(ask, cx) {
    this.drop(ask);
    this.host.reply(ask, dismiss(ask.words.kind), cx);
  }

  // // ---- 问题(AskUserQuestion)----------------------------------------------------------

  // 每个请求:当前步骤、各问题的选项、其 "Other" 文字(及其输入框)。
  state(ask) {
    let q = this.states.get(ask.id);
    if (!q) {
      q = { step: 0, picks: ask.words.questions.map(() => new Set()), other: ask.words.questions.map(() => null), boxes: [] };
      this.states.set(ask.id, q);
    }
    return q;
  }

  answerOf(ask, q, i) {
    const qq = ask.words.questions[i];
    const other = q.boxes[i]?.value().trim() || q.other[i]?.trim();
    if (q.other[i] !== null && other) return other;
    return [...q.picks[i]].sort((a, b) => a - b).map((k) => qq.options[k].name).join(", ");
  }

  done(ask, q) {
    return ask.words.questions.every((_, i) => this.answerOf(ask, q, i));
  }

  // 遗忘某请求的状态(连同其 "Other" 输入框):在它被应答或消失时。
  drop(ask) {
    const q = this.states.get(ask.id);
    for (const b of q?.boxes ?? []) b?.release();
    this.states.delete(ask.id);
    this.open.delete(ask.id);
    if (this.keyed?.id === ask.id) this.keyed = null;
  }

  // 丢弃已不存在的请求的状态。
  keep(ids) {
    for (const id of [...this.states.keys(), ...this.open]) if (!ids.includes(id)) this.drop({ id });
  }

  // 写在聊天输入框而非卡片上的文字。尚余一个问题待回答时占用
  // 作为其 "Other" 答案(其余保留已选项);一项权限、一个计划,或多个
  // 未决问题一并拒绝,agent 由此读到用户的答复。
  replyWith(ask, text, cx) {
    if (ask.words.kind === "questions") {
      const q = this.state(ask);
      const open = ask.words.questions.filter((_, i) => !this.answerOf(ask, q, i));
      if (open.length === 1) {
        const map = Object.fromEntries(ask.words.questions.map((qq, i) => [qq.text, this.answerOf(ask, q, i) || text]));
        this.drop(ask);
        this.host.reply(ask, answers(ask.req, map), cx);
        return;
      }
    }
    this.drop(ask);
    this.host.reply(ask, deny(`The person didn't use the card and wrote in the chat instead: ${text}`), cx);
  }

  submit(ask, cx) {
    const q = this.state(ask);
    if (!this.done(ask, q)) return;
    const map = Object.fromEntries(ask.words.questions.map((qq, i) => [qq.text, this.answerOf(ask, q, i)]));
    this.drop(ask);
    this.host.reply(ask, answers(ask.req, map, annotationsOf(ask.words, map)), cx);
  }

  // 点击该请求的某条 strip:其卡片接管按键(Esc;问题卡片的箭头键,
  // Tab,数字也含在内)。
  pressed(ask) {
    this.keyed = ask;
    this.focus.focus();
  }

  // 按键的接收入口:在列表之外,不可见(行本身不接处理器)。
  sink(name) {
    return div().id(`ask-keys-${name}`).absolute().size(0).track_focus(this.focus)
      .on_key_down((e, cx) => { if (this.keyed) this.key(this.keyed, e, cx); });
  }

  key(ask, e, cx) {
    if (e.key === "escape") { cx.stop_propagation(); this.dismiss(ask, cx); cx.notify(); return; }
    if (ask.words.kind !== "questions" || !ask.words.questions.length) return;
    const w = ask.words, q = this.state(ask), n = w.questions.length;
    const last = n > 1 ? n : n - 1, step = Math.min(q.step, last);
    const k = e.key;
    if (k === "right" || k === "tab") { cx.stop_propagation(); this.go(ask, step + 1); }
    else if (k === "left") { cx.stop_propagation(); this.go(ask, step - 1); }
    else if (/^[1-9]$/.test(k) && step < n && Number(k) <= w.questions[step].options.length) { cx.stop_propagation(); this.pick(ask, step, Number(k) - 1); }
    else return;
    cx.notify();
  }

  go(ask, k) {
    const q = this.state(ask), n = ask.words.questions.length;
    q.step = Math.max(0, Math.min(n > 1 ? n : n - 1, k));
  }

  pick(ask, i, k) {
    const w = ask.words, q = this.state(ask), n = w.questions.length, qq = w.questions[i];
    if (qq.multi) { if (q.picks[i].has(k)) q.picks[i].delete(k); else q.picks[i].add(k); }
    else {
      q.picks[i] = new Set([k]); q.other[i] = null;
 // 选中一次即前进,除非带预览:此时停留展示所选项
      if (qq.options.some((o) => o.preview)) return;
      if (n > 1 && i < n - 1) q.step = i + 1; else if (n > 1) q.step = n;
    }
  }

  // "Other…":其输入框,在这里创建(绝不在 render 中),然后把键盘交给它。
  openOther(ask, i, cx) {
    const q = this.state(ask);
    q.other[i] = q.other[i] ?? "";
    if (!ask.words.questions[i].multi) q.picks[i] = new Set();
    if (!q.boxes[i]) { q.boxes[i] = InputState.new({ placeholder: "你的回答" }); q.boxes[i].on("change", (_e, cx) => cx.notify()); }
    const box = q.boxes[i];
    cx.timer.after(0, () => box.focus());
  }

  // 整个请求一张卡片:多问时分步显示(最后一步用于
  // 核对回答),选项成行(单选或多选),"Other…" 可自填,"Chat about
  // 改为对话”;一个 Submit。方向键或 Tab 在步骤间移动,数字键选择。
  questions(ask, opts) {
    const w = ask.words, q = this.state(ask), id = ask.id;
    const n = w.questions.length, many = n > 1;
    const last = many ? n : n - 1;
    const step = Math.min(q.step, last);
    const links = [...(opts.links ?? []), ...(opts.terminal !== false ? [this.terminalLink(ask)] : []), this.dismissLink(ask)];
    const out = [headStrip({ who: opts.who, links })];
    if (many) {
      out.push({ key: "title", kind: "title", text: `${n} questions` });
      out.push({ key: "steps", kind: "controls", align: "start", ctls: [...w.questions.map((qq, i) => ({ label: qq.header || `Question ${i + 1}`, i })), { label: "Submit", i: n }]
        .map(({ label, i }) => ({ id: `q-step-${id}-${i}`, label, look: "pill", on: i === step, done: i < n && Boolean(this.answerOf(ask, q, i)), fn: () => this.go(ask, i) })) });
    }
    if (step === n) {
      // 待核对的回答,每个都会重新打开其对应的问题。
      w.questions.forEach((qq, i) => {
        const a = this.answerOf(ask, q, i);
        out.push({ key: `review${i}`, kind: "review", gap: i ? 4 : 8, label: qq.header || qq.text, answer: a || "未回答", missing: !a, fn: () => this.go(ask, i) });
      });
    } else {
      const qq = w.questions[step];
      out.push({ key: `q${step}`, kind: "title", text: qq.text });
      if (qq.multi) out.push({ key: `multi${step}`, kind: "text", tone: "dim", gap: 2, text: "选择所有适用的。" });
      qq.options.forEach((o, k) => out.push({ key: `q${step}-${k}`, kind: "option", gap: k ? 2 : 6, on: q.picks[step].has(k), multi: qq.multi,
        label: o.name, desc: o.description, tag: o.recommended ? "Recommended" : null, fn: () => this.pick(ask, step, k) }));
 // 所选选项的预览(否则取第一个),与 Claude 提示行聚焦项的显示方式一致。
      const shown = !qq.multi && q.picks[step].size === 1 && qq.options[[...q.picks[step]][0]]?.preview ? [...q.picks[step]][0] : qq.options.findIndex((o) => o.preview);
      if (!qq.multi && shown >= 0) {
        out.push({ key: `q${step}-preview-label`, kind: "text", tone: "dim", gap: 6, text: `Preview · ${qq.options[shown].name}` });
        out.push({ key: `q${step}-preview`, kind: "detail", gap: 2, lines: qq.options[shown].preview.split("\n"), clip: null });
      }
      out.push({ key: `q${step}-other`, kind: "option", gap: 2, on: q.other[step] !== null, multi: qq.multi, label: "Other…", fn: (cx) => this.openOther(ask, step, cx) });
      if (q.other[step] !== null) out.push({ key: `q${step}-box`, kind: "input", gap: 2, indent: 32, state: q.boxes[step] ?? null, placeholder: "Your answer" });
      out.push({ key: `q${step}-chat`, kind: "option", gap: 2, label: "就此对话", desc: opts.chatHint ?? "或在下方输入你的回答。",
        fn: (cx) => { this.drop(ask); this.host.reply(ask, chatAbout(), cx); this.host.chatAbout(ask, cx); } });
      if (many && (step < n - 1 || shown >= 0)) out.push({ key: `next${step}`, kind: "controls", align: "end", gap: 4, ctls: [{ id: `q-next-${id}-${step}`, label: "Next", look: "plain", fn: () => this.go(ask, step + 1) }] });
    }
    if (!many || step === n) {
      const ready = this.done(ask, q);
      out.push({ key: "submit", kind: "controls", align: "end", ctls: [{ id: `q-submit-${id}`, label: "Submit", look: "primary", disabled: !ready, fn: ready ? (cx) => this.submit(ask, cx) : null }] });
    }
    return out;
  }
}
