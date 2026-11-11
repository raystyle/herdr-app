// Chat:把 agent 的对话作为聊天呈现,读自其自身 session log,附带
// 输入框来输入。agent 仍在终端里运行;这里只是以另一种方式显示它。
// 由 `pane-chat` header 的 Chat / Terminal 开关在 agent pane 的位置打开:
// 显示期间 agent 的终端处于停靠状态(运行中,无 pane)。
// Props:{ terminal }:agent 的地址("t7",另一台 machine 上为 "vps/t7")。在…之后
// 由此重启时聊天跟随新 agent:它携带 herdr.chat.origin=<props terminal>。
// 或者,尚无 agent 的聊天(space 的 Coordinator tab,由 mods/coordinator 创建):
// { role: "coordinator", template, space, folder, slot }。首条消息启动该 agent
// (模板)驻留在此 chat 之后,并以该消息为任务;shared
// "coordinator.slots"[slot] = { space, tab, pane, folder } 记录其 pane 和 tab。当
// 该 agent 结束后,聊天区恢复为空。
//
// 输入框接受粘贴或拖入的文件(attach.js),提示 slash 命令(slash.js),
// 听写(dictate.js),并在 data/chat-drafts 为每个 agent 保存未发送草稿。其下方,
// 模型按钮注明 agent 的运行模型,并打开选择器(mods/chat-models)以其他模型重启它
// 选项(agent.js)。语音通话(voice.ts,随应用运行)围绕本聊天进行。
// 悬停消息时,在其上角的小栏中显示操作:react、reply(引用)、
// 副本,以及 rewind(CLI 自带)或 fork。
// 如同 herdr-winapp 的聊天(docs/chat.md):CLI 停在自己的首屏(trust、theme、sign in
// 在内)会以卡片形式显示在此处回答(screens.js;task worker 的还会出现在其 Assistant 的
// 聊天);resume 的会话已丢失时 agent 自行开新会话(lostSession());
// /model 打开 model picker 而不传给 CLI;长回复用 Show more 折叠;
// 日期行(Today、Yesterday、……)插在新的一天开始处。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Scrollbar, VirtualListScrollHandle, TextView, v_virtual_list, InputState, Input } from "gpui-base";
import { focused, props, run, theme, home, hc, exec, shared, setShared, watchFolder, window, settings, playSound, notify, appHome, readTextFile, writeTextFile, nextCommand, openOverlay, knownAgents, machines, layout } from "herdr";
import { agents, panes, terminals, spaces, inRender } from "./live.js";
import { chatPane, chatLabel } from "./core/spaces.js";
import * as fs from "fs/promises";
import { FIND, LOG, Conversation, records, resultText, summary, excerpt, names, pilotLine } from "./core/chat-log.js";
import { BgJobs } from "./core/bg-jobs.js";
import { ChatReader } from "./core/chat-reader.js";
import { preview } from "./core/recipe.js";
import { words, howAnswered, codexOnScreen, codexSteps } from "./core/asks.js";
// 各行的文案与规则,web 端聊天同样依此绘制(core/chat-view.js)。
import { WORDS, clock, bgGroups, subagentsOf, subagentWord, senderName, briefLabel, firstUser, firstKeys, literal, fromName, sentTo, selfName, initialOf, newsWords, resolveArtifacts, unsigned, ownWords, fitThumbs, bandActs, bandOrder, imagesLine, questionsBelow, notSent, published, artifactLine, videoLine, mediaIn, elapsed, reportMsg, doingWords, LOST, lostMessage, shellWord, sessionStarted, sessionFailed } from "./core/chat-view.js";
// 发送用户的话,与 web app 相同(core/send.js)。
import { refusal, taskTag, messageBody, replyInstead, steerNow, reactionLine, mentionedIn, sendTyped, SETTLE } from "./core/send.js";
// hc,其 send 以本人身份发出、无调用方:在其他 machine 上绝不显示 “Another agent”。
import { asPerson } from "./core/person.js";
import { AskCards, linkCtl } from "./cards.js";
import * as strips from "./strips.js";
import { button, red, green, amber, H, RADIUS, TEXT, toast, toastWho, plainError } from "./ui.js";
import { openViewer, noteChatArea } from "./artview.js";
import { KEY_HOLDER, holdKeys, keysElsewhere, dialogHolds, liveHolder } from "./keyholder.js";
import { taskDot, ownProgress } from "./dot.js";
import * as attach from "./attach.js";
import * as slash from "./slash.js";
import * as mentions from "./core/mentions.js";
import { SH } from "./core/paths.js";
import { dirsReady } from "./dirs.js";
import * as agent from "./agent.js";
import { cleanCommand } from "./core/clean-env.js";
import * as choices from "./settings.js";

// Done 之后超过这么久仍未记录,说明耗时超出常态。
import { PanelHost, inner, openTaskThread, backToTasks, requestWorkerTerminal, THREAD, STACK as TASKS_STACK, BODY as THREAD_BODY, CHAT as THREAD_CHAT, TERM as THREAD_TERM, PR as THREAD_PR, BROWSER as THREAD_BROWSER } from "./panel.js";
import { markRead, onScreen, unread } from "./unread.js";
import { notifies } from "./notify.js";
import { ScreenWatch, screenStrips, openCard, cardsOf, starting, cliOf } from "./screens.js";
import { dayLabel, dayOf } from "./days.js";
import { on as addonOn } from "./addons.js";
import { note } from "./usage.js";

// 一页历史包含的消息数:先取最新一页,更早的随用户上滚加载。
const PAGE = 200;
// 每个聊天在内存中至多保留这么多条 log record(以及已展开的 tool 输出):超过后,
// 最旧的先丢弃(滚回顶部会重新读取)。
const KEEP = 2000;
// 会话内容的最大宽度(px):宽 pane 下行长文本仍保持可读。
const COLUMN = 760;
const KINDS = { "claude-code": "claude", claude: "claude", codex: "codex" };
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// 命令执行机器上 role 模板所在文件夹(sh -c 前缀:$dir)。
const TEMPLATE = 'dir="$HOME/.config/herdr-core/templates"; ';
// 某机器的 layout 当前是否在本机(即已连接);本机始终算作是。
const online = (machine) => !machine || machines().find((m) => m.name === machine)?.layout === "ready";
const same = (a, b) => norm(a) === norm(b);
// 用户输入 agent 终端的内容:来自用户的纯输入,本机与远端机器皆然(core/person.js)。
const personHc = asPerson({ hc, exec });
// 本机在 herdr-core 中的名称,一旦得知:另一台机器的 agent 会把我们的终端写作 "<it>/t75"。
let ownName = null, askedName = false;
const coreName = () => {
  if (!askedName) { askedName = true; hc(["server", "status"]).then((r) => { ownName = JSON.parse(r.stdout || "{}")?.core?.name || null; }).catch(() => { askedName = false; }); }
  return ownName;
};
// 提问发起的时刻:其 id 为 <terminal>.<seconds>.<pid>(ask-hook.sh),取自
// 该秒,使其排在其中内容之后。
const askAt = (id) => { const p = String(id).split("."); const sec = Number(p[p.length - 2]); return Number.isFinite(sec) && sec > 1e9 ? sec * 1000 + 999 : Date.now(); };
// space 的 Assistant(即其 coordinator),其提醒跟随该 space 的 Notify 设置。
const assistant = (k) => k?.labels?.["herdr.role"] === "coordinator";
// hc 未执行的原因:取其 JSON 错误的 { kind, message }("blocked":有对话框打开),否则取其文字。
// composer 的圆形按钮(Send、Call、End call、mic、Mute),以及其文本行的高度
// (输入框的一行),由通话行保留该高度,通话开始时布局不动。
const ROUND = 28, TEXT_ROW = 34;
// 图片缩略图:输入框中的文件为此尺寸的正方形、此间距;位于已发送
// 消息中每张图片保持比例,按 THUMB_ONE(单图)或 THUMB_MANY(w, h) 适配。
const THUMB = 56, THUMB_GAP = 6;
// 聊天中的 artifact 卡片:宽度至多如此(其图片可收入其中:peekOf())。
const PEEK_W = 420;
// 实时行的电平波形:每根条的宽度与条间距,单位 px。
const WAVE_BAR = 3, WAVE_GAP = 2;
// 每条消息下方仅一行,即其 band(独立的列表行),靠消息一侧(左
// 对 agent 靠左、对人靠右),表情回应 pills 紧贴气泡外缘
// 以及添加 reaction 的笑脸,两侧互为镜像:用户侧显示时间
// (dim)、reply、copy、rewind、笑脸,然后是 pill(最右);agent 侧消息的
// pills(最左)、表情、fork、复制、回复,最后是时间。pills 始终显示;其余仅在指针悬于消息上时出现,留出空间
// 该间距始终保留,因此布局不动。barLayout() 摆放各部分;hitBar() 读取
// 相同位置。
// 以 4 px 为刻度的统一节奏(spaced()):每条消息下方都有其 band,始终保留:BAND_IN
// 气泡下方的留白,然后是操作行(ACT 高,无论有无 pill)。之后每个块(
// 消息(含其条带)、一段安静行、一张卡片)与下一块之间相隔 GAP,因此该行绝不
// 不会影响后文,气泡上方的间距等于行后的间距。
const ACT = 22, ACT_GAP = 2, BAND_IN = 4, ACT_ROW = BAND_IN + ACT, GAP = 16;
// Quiet line(tools、"Message from …"、artifact 行)保持固定:每条都是独立一行,带 QUIET_PY
// 上下各留(工具行的悬停框)这么多,不再多。QUIET_IN:其文字墨迹距
// 在行上下边缘之内(QUIET_PY,加上小字号文本自身的行距;
// 基线偏上量略大于大写字母的下沉量),从窗口实测。
const QUIET_PY = 1, QUIET_IN = { top: 5, bottom: 6 };
// 长回复在超过 FOLD_TALL 行时折叠(Show more)(行高按其
// 文字),截到前 FOLD 行;LINE_H 是回复一行的像素高度。
const FOLD = 20, FOLD_TALL = 28, LINE_H = 21;
// 已消失的 session(LOST)、新 agent 收到的提示(lostMessage)与聊天备注:core/chat-view.js,如同
// 由 service 为 web 应用重启一个。
// 输入的名称在 picker 中对应的行(/model sonnet、/model claude-opus-5-5、/model gpt-5):
// { agent, model },或 null。`menus`:每个 agent 的 agent.js menuFor()。
function findModel(menus, name) {
  const n = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9.]+/g, "");
  const qs = [n(name), n(agent.modelName(name))];
  const rows = Object.entries(menus ?? {}).flatMap(([a, m]) => (m?.models ?? []).map((r) => ({ agent: a, model: r.id, keys: [n(r.id), n(r.name)] })));
  const hit = rows.find((r) => r.keys.some((k) => qs.includes(k))) ?? rows.find((r) => r.keys.some((k) => qs.some((q) => q && k.startsWith(q))));
  return hit ? { agent: hit.agent, model: hit.model } : null;
}
// 估算文字在某宽度(px)下占多少行,用于测量前的行高。
const wrapLines = (text, width) => String(text ?? "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 7) / Math.max(120, width))), 0);
// 折叠回复可见的文字:在 `width` 下按 wrapLines 计数、恰好填满 `h` 的行数
// px,淡出层下再多留几行(估算可能偏少);长段落在
// 到最后一条结束。只对这些做布局:折叠回复在裁剪区外整幅绘制曾
// 超出其行高,向上滚入会清空整个列表(#590)。
const shownLines = (text, h, width) => {
  const per = Math.floor(Math.max(120, width) / 7);
  const out = [];
  let room = Math.ceil(h / LINE_H) + 3;
  for (const l of String(text ?? "").split("\n")) {
    if (room <= 0) break;
    const n = wrapLines(l, width);
    out.push(n > room ? l.slice(0, room * per) : l);
    room -= n;
  }
  return out.join("\n");
};
const ICONS = { copy: "copy", reply: "reply", rewind: "rewind", fork: "git-fork", react: "smile-plus" };
// Reaction pill:此宽此高(位于 ACT 行内,使其对齐图标的中心线
// 又不至于压迫它们),间距如此;以及它们与表情按钮的间距。
const PILL = 46, PILL_H = 20, PILL_GAP = 4, PILL_EDGE = 6;
// task 的 id,按显示与输入的形式:herdr-task 的 PREFIX-n(`ref`,如 HAT-1),否则为 #n。
const taskRef = (x) => (x?.ref ? String(x.ref) : `#${x?.id}`);
// herdr-task 的状态,按 core/mentions.js 的 TASK_RANK 排序任务
const SECTION_DOT = { needs: "need", need: "need", working: "work", work: "work", merging: "merging", ready: "ready", queued: "queued", scheduled: "scheduled", todo: "todo", done: "done" };
// 消息下方的 task chip:此宽度、此间距。
const TASK = 170, TASK_GAP = 6;
// Ready 任务的消息行:其 Review(打开 Accept 卡片),宽度如此,位于行右端。
const ACCEPT = 64;
// 尚无使用记录时 picker 的 Frequently used 内容。
const FREQUENT = ["👍", "👎", "❓", "✅", "👀", "🎉", "❤️", "🔥", "🙏"];
const safe = (s) => String(s).replace(/[^\w.-]/g, "_");
// 线程(openThread()):shared "chat.threads" = { [pane]: { terminal, task, title } },仅
// pane 仍在;以及显示 worker 的那个。
const threads = () => Object.fromEntries(Object.entries(shared("chat.threads") ?? {}).filter(([p]) => panes().some((x) => x.pane === p && x.mod === "chat")));
const threadOf = (terminal) => Object.entries(threads()).find(([, v]) => v?.terminal === terminal)?.[0] ?? null;
// 卡片应答的处理结果,用于其 quiet line("Allowed in the chat");未做决定时为 null
// (改为由终端询问)。

// 给等待中的 hook 的答复(ask-hook.sh 将其作为 Claude 的决定打印),这是所有…的唯一途径
// 卡片副本送达。先给结果(hook 的 end/<id>),供该提问的其他副本:
// 请求消失后它们才读取。
async function answerAsk(dir, id, text, how) {
  if (how) await writeTextFile(`${dir}/end/${id}`, `${how}\n`, null).catch(() => {});
  await writeTextFile(`${dir}/ans/${id}.json`, text, null).catch(() => {});
}
// 另一台 machine 的请求,由 service 读取并应答(service/asks.ts):
// 该处每个仍在等待本终端($1)且 hook 存活的请求,各占一行("req",
// 其 id 与 JSON),随后是其后每个 id 的结束方式(“end”、其 id、hook 文案)。
const ASKS_THERE = 'd="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/chat-asks"';
const REMOTE_LIST = `${ASKS_THERE}; t=$1; shift
for f in "$d/req/$t".*.json; do [ -f "$f" ] || continue; n=\${f##*/}; n=\${n%.json}; [ -f "$d/ans/$n.json" ] && continue
  kill -0 "\${n##*.}" 2>/dev/null || continue; printf 'req\\t%s\\t' "$n"; tr '\\n\\t' '  ' < "$f"; echo; done
for n in "$@"; do [ -f "$d/end/$n" ] && printf 'end\\t%s\\t%s\\n' "$n" "$(head -n 1 "$d/end/$n")"; done; exit 0`;
// 在那里应答:先给出处理结果,然后答案($3)立即原位插入。
const REMOTE_ANSWER = `${ASKS_THERE}; mkdir -p "$d/ans" "$d/end"; [ -f "$d/req/$1.json" ] || exit 3
[ -z "$2" ] || printf '%s\\n' "$2" > "$d/end/$1"
printf '%s' "$3" > "$d/ans/$1.json.tmp" && mv "$d/ans/$1.json.tmp" "$d/ans/$1.json"`;
async function answerRemote(machine, id, text, how) {
  await exec("hc", ["exec", "--on", machine, "sh", "-c", REMOTE_ANSWER, "x", id, how ?? "", text]).catch(() => {});
}
// 用户输入保留其换行:markdown 会合并单行换行,因此每处
// 会成为硬换行(代码围栏内除外,保持原样)。用户输入的 "<word>" 显示为
// 按输入原样,不作为 HTML 解析而丢失(core/chat-view.js 的 literal(),#591)。
const typed = (text) => literal(String(text).split(/(```[\s\S]*?(?:```|$))/).map((part, i) => (i % 2 ? part : part.replace(/([^\n])\n(?!\n)/g, "$1  \n"))).join(""));

// 分段渲染的 agent 消息:markdown 正文,以及 fenced code block(带 Copy 栏)。
function parts(text) {
  const out = [];
  const re = /^```([^\n`]*)\n([\s\S]*?)\n```[ \t]*$/gm;
  let at = 0, m;
  while ((m = re.exec(text))) {
    const before = text.slice(at, m.index).trim();
    if (before) out.push({ type: "md", text: before });
    out.push({ type: "code", lang: m[1].trim(), code: m[2] });
    at = m.index + m[0].length;
  }
  const rest = text.slice(at).trim();
  if (rest) out.push({ type: "md", text: rest });
  return out;
}

let bound = false;

// What the voice opened, in a few words for its "Opened by voice" toast.
function voiceOpened(nav) {
  if (nav.kind === "task") return `${nav.ref ?? String(nav.task ?? "").split(":").pop()}${nav.title ? ` \u00b7 ${nav.title}` : ""}`;
  if (nav.kind === "artifact") return nav.title ?? "An artifact";
  if (nav.kind === "tasks" || nav.kind === "needs") return nav.kind === "needs" ? "What needs you" : "The Tasks list";
  if (nav.kind === "settings") return `Settings${nav.section ? ` \u203a ${nav.section}` : ""}`;
  if (nav.kind === "panel") return `${nav.panel[0].toUpperCase()}${nav.panel.slice(1)}`;
  return nav.kind === "space" || nav.kind === "chat" ? "A space" : "";
}

// Herdr's zoom (View › Zoom): what the window reports (a size, a press's place) is in pixels at the zoom, while
// what the chat lays out (.w(), .h(), the list's row sizes) is at zoom 1. Every reported number comes back to zoom 1
// here, so the rows' heights and the presses' places match what's drawn at any zoom (#759).
export function zoomOf() { return Number(settings()?.zoom) || 1; }
export function unzoom(px) { return px === undefined || px === null ? px : px / zoomOf(); }

export default class Chat extends View {
  init(_props, cx) {
    // The Tasks panel's drill-in view (props { panel: true }): its header (props { head: true })
    // and its body, a nested Chat for the task's worker, made with its own props ({ inner: true,
    // thread: true, terminal, ... }).
    if (props()?.panel === true && !_props?.inner) {
      this.host = new PanelHost(Chat, props()?.head === true);
      // pane.go (mod.json "focusable") can land on the header too: it hands the keyboard on to the chat below it (the
      // body's nested Chat takes "focus" in its own loop). At most 5 s per wait, as the loop below.
      if (this.host.head) cx.spawn(async (cx) => {
        let cmd = null;
        for (;;) {
          cmd ??= nextCommand();
          const c = await Promise.race([cmd, cx.sleep(5000)]);
          if (c === undefined) continue;
          cmd = null;
          if (c === "focus") run("pane.go", { direction: "down" });
        }
      });
      return;
    }
    this.inner = _props?.inner === true;
    if (this.inner) inner.chat = this;
    const P = this.inner ? _props : props();
    this.origin = P?.terminal ?? null;
    this.addr = this.origin;
    // No agent yet (a Coordinator tab): it may have started one already (this slot's label).
    this.role = P?.role ?? null;
    this.slot = P?.slot ?? null;
    // A thread: a task worker's chat, in the Tasks panel ({ terminal, thread: true, task,
    // title }). The same conversation, box and cards, but only a view: it never claims the
    // worker's herdr.chat, never gives it a pane, and leaving it leaves the worker running.
    this.thread = P?.thread === true;
    // A task whose agent ended (the Tasks list's click): its conversation from that agent's own
    // log, kept by herdr-task ({ path, kind }), and the task ({ machine, folder, slug, id }) for
    // its Resume.
    this.endedLog = this.thread ? P?.log ?? null : null;
    this.taskKey = this.thread ? P?.key ?? null : null;
 // Its task's id, for the box's "Message ".
    this.taskRef = P?.task ?? null;
    // Tells the Tasks panel threads can be asked for (shared "chat.threadreq").
    if (shared("chat.threads.v") !== 1) setShared("chat.threads.v", 1);
    if (!this.addr && this.role && this.slot) this.addr = this.slotAgent();
    this.machine = this.addr?.includes("/") ? this.addr.split("/")[0] : null;
    this.phase = "finding";
    this.conv = null;
    this.path = null;
    this.reset();
    this.pending = [];
    this.opened = new Set();
    this.results = new Map();
    this.pinned = true;
    this.width = 600;
    this.heights = new Map();
    // When each row's height was first measured: kept measuring a few seconds after (measurer).
    this.measuredAt = new Map();
    this.heightsFor = 0;
    // Bumped whenever the heights are forgotten: the measuring boxes get new ids with it, so
    // each reports its size again. A box that kept its id reports only a change, and a row
    // whose height came out the same at the new width then stayed on its guess (squeezed).
    this.measureGen = 0;
    this.range = null;
    this.scroll = VirtualListScrollHandle.new();
    // Its placeholder is drawn by composer(): it changes while a card asks ("Reply instead…").
    this.box = TextareaState.new({ placeholder: "" });
    this.box.set_rows(1);
    // Ctrl+Enter (the textarea's secondary submit): held until the agent is free.
    this.box.on("submit", (e, cx) => { if (!e?.shift) this.enter(cx, Boolean(e?.secondary)); });
    this.box.on("focus", (_e, cx) => { this.focused = true; noteChatArea(this.areaKey(), { focus: true, at: Date.now() }); holdKeys(this.areaKey()); cx.notify(); });
    this.box.on("blur", (_e, cx) => { this.focused = false; noteChatArea(this.areaKey(), { focus: false, at: Date.now() }); cx.notify(); });
    this.box.on("change", (_e, cx) => {
      // A big paste (over 8 KB or 200 lines) becomes a text file to send, not text in the box.
      const was = this.lastValue ?? "", now = this.box.value();
      this.lastValue = now;
      if (now.length - was.length > 8192 || now.split("\n").length - was.split("\n").length > 200) {
        let a = 0;
        while (a < was.length && was[a] === now[a]) a++;
        let b = 0;
        while (b < was.length - a && was[was.length - 1 - b] === now[now.length - 1 - b]) b++;
        const pasted = now.slice(a, now.length - b);
        const rest = was.slice(0, a) + was.slice(was.length - b);
        this.box.set_value(rest);
        this.lastValue = rest;
        cx.spawn(async (cx) => { const f = await attach.textFile(pasted); if (f) { this.addFiles([f]); this.saveSoon(cx); cx.notify(); } });
        return;
      }
      // Copied files pasted as text (file:// lines) become attachments.
      const v = this.box.value();
      if (/^file:\/\/\S/m.test(v)) {
        const found = v.split("\n").filter((l) => /^file:\/\/\S+$/.test(l.trim())).map((l) => decodeURIComponent(l.trim().slice(7)));
        this.addFiles(attach.paths(found));
        this.box.set_value(v.split("\n").filter((l) => !/^file:\/\/\S+$/.test(l.trim())).join("\n"));
      }
      this.slashSel = 0;
      // Editing a recalled message makes it a new one: arrows move in it again.
      if (this.recall >= 0 && this.box.value() !== this.recalled) this.recall = -1;
      this.sizeBox();
      this.saveSoon(cx);
      cx.notify();
    });
    // A paste with no text: the clipboard's image or copied files become attachments.
    this.box.on("paste_other", (_e, cx) => cx.spawn(async (cx) => {
      const got = await attach.fromClipboard().catch((e) => { this.error = String(e?.message ?? e); cx.notify(); return []; });
      if (got.length) { this.error = null; this.addFiles(got); this.saveSoon(cx); cx.notify(); }
    }));
    this.wasFocused = false;
    // Up/Down/Tab/Escape reach the textarea first, which keeps them. While the "/" list shows
    // (chat_slash) or the box is empty or showing a recalled message (chat_recall), these
    // bindings turn them into this chat's own actions instead (on_action in composer()).
    if (!bound) {
      bound = true;
      const keys = [];
      for (const ctx of ["Input", "TextArea", "Textarea"]) {
        keys.push({ keystroke: "up", action: "chat_slash_up", context: `chat_slash > ${ctx}` },
          { keystroke: "down", action: "chat_slash_down", context: `chat_slash > ${ctx}` },
          { keystroke: "tab", action: "chat_slash_take", context: `chat_slash > ${ctx}` },
          { keystroke: "escape", action: "chat_slash_close", context: `chat_slash > ${ctx}` },
          { keystroke: "escape", action: "chat_stop", context: `chat_stop > ${ctx}` },
          { keystroke: "escape", action: "chat_find_close", context: `chat_find > ${ctx}` },
          { keystroke: "enter", action: "chat_find_next", context: `chat_find > ${ctx}` },
          { keystroke: "shift-enter", action: "chat_find_prev", context: `chat_find > ${ctx}` },
          { keystroke: "up", action: "chat_recall_up", context: `chat_recall > ${ctx}` },
          { keystroke: "down", action: "chat_recall_down", context: `chat_recall > ${ctx}` });
      }
      try { cx.bind_keys(keys); } catch {}
    }
    // Asks from Claude's PermissionRequest hook (ask-hook.sh), oldest first: { id, req, words }.
    this.asks = [];
    this.askDir = `${appHome()}/data/chat-asks`;
    // Asks that closed, each a quiet line in the conversation saying how ("Answered in the
    // terminal"): { id, title, how, at }. Kept per agent across reloads.
    this.askEnds = [];
    // The box's extras: files to send, a quoted message, messages held until the agent is free.
    this.files = [];
    this.quote = null;
    this.queue = [];
    this.recall = -1;
    this.slashSel = 0;
    this.slashOff = null;
    this.cmds = [];
    // "#": the spaces this agent's machine reaches (core/mentions.js) and the ones picked into the box
    this.reach = null;
    this.picked = [];
    // "@": the tasks picked into the box (core/mentions.js taskToken at send)
    this.pickedTasks = [];
    this.copied = null;
    this.note = null;
    this.dflt = null;
    this.argv = null;
    this.press = null;
    this.views = {};
    this.myReacts = new Map();
    // Words written in the box while a card asked, which answered it: shown as the person's,
    // after the conversation item that was last when they went ({ id, text, after }).
    this.replied = [];
    // Question cards: their state per ask, and the keyboard for their arrows and digits.
    this.cards = new AskCards({
      reply: (ask, text, cx) => this.reply(ask, text, cx),
      toTerminal: () => this.toTerminal(),
      chatAbout: () => this.box.focus(),
    }, cx.focus_handle());
    // An Assistant's chat: its tasks' workers' asks on the same cards (workerAsks()). Shown ones
    // by id, the requests being read, those answered here (until the hook lets them go).
    this.workerCards = new AskCards({
      reply: (ask, text, cx) => this.replyWorker(ask, text, cx),
      toTerminal: (ask) => { openTaskThread(ask.terminal, ask.ref, ask.title); requestWorkerTerminal(ask.terminal); },
      chatAbout: (ask) => openTaskThread(ask.terminal, ask.ref, ask.title),
    }, cx.focus_handle());
    // Codex's own questions (request_user_input, no hook): the same question card, its answer
    // pressed on Codex's screen (codexCard(), answerCodex()).
    this.codexCards = new AskCards({
      reply: (ask, text, cx) => this.answerCodex(ask, text, cx),
      toTerminal: () => this.toTerminal(),
      chatAbout: () => this.box.focus(),
    }, cx.focus_handle());
    this.codexAsk = null;
    this.shownAsks = new Map();
    // Kept or declined here: its quiet line, where its card was.
    // Cards' controls by id: their drawn widths, for which one a press was on (strips.js hit()).
    this.cardW = new Map();
    this.readingAsks = new Set();
    this.answeredAsks = new Set();
    // Ready tasks being accepted from their live rows (by ref).
    this.accepting = new Set();
    // CLI start screens (screens.js): this agent's, and in an Assistant's chat its workers'.
    // A press on its way, and why one didn't go, by card.
    this.screens = new ScreenWatch((card) => this.screenAlert(card));
    this.screenBusy = new Set();
    this.screenErr = new Map();
    // Agents whose lost session this chat already started again (lostSession()).
    this.lostTried = new Set();
    // Long replies opened with Show more (by message id).
    this.unfolded = new Set();
    // Find in the chat (Ctrl+F): open, the current match.
    this.finding = false;
    this.findIdx = 0;
    this.findBox = InputState.new({ placeholder: WORDS.find });
    this.findBox.on("change", (_e, cx) => { this.findIdx = 0; this.findJump = true; cx.notify(); });
    // "Show thinking" is gone: so is its stored setting.
    if (shared("chat.showThinking") != null) cx.timer.after(0, () => setShared("chat.showThinking", null));
    this.uses = {};
    cx.spawn(async (cx) => {
      try { this.uses = JSON.parse(await fs.readFile(`${appHome()}/data/chat-emoji-uses.json`, "utf8")) ?? {}; } catch {}
      cx.notify();
    });
    this.viewAsked = new Set();
    this.restartReqAt = shared("chat.restartreq")?.at ?? null;
    this.reactReqAt = shared("chat.reactreq")?.at ?? null;
    this.sendReqAt = shared("chat.sendreq")?.at ?? null;
    this.startReqAt = shared("chat.startreq")?.at ?? null;
    // The working line's clock, once a second while the agent works; the rows over the box (its
    // subagents, its background shells) count seconds for their first minute, then minutes.
    let ticks = 0;
    cx.timer.every(1000, (cx) => {
      ticks++;
      const rows = [...this.helpers(), ...this.jobs()];
      if (this.status() === "working" || rows.some((r) => Date.now() - (r.at ?? 0) < 61000) || (rows.length && ticks % 30 === 0)) cx.notify();
    });
    // An Assistant's chat keeps its tasks current for their news lines (newsLines()): herdr-task's own
    // statuses, the same as the Tasks panel's and the news it sends.
    cx.timer.every(8000, (cx) => {
      if (!this.assistant() || this.tasksLoading) return;
      this.tasksLoading = true;
      cx.spawn(async (cx) => {
        const was = this.taskSig();
        try { await this.loadSpaceTasks(); } finally { this.tasksLoading = false; }
        if (this.taskSig() !== was) cx.notify();
      });
    });
    // ... and its workers' start screens and lost sessions, as their own chats would (those are
    // seldom open): only workers that look starting, or that ended at a shell after a resume.
    cx.timer.every(2500, (cx) => {
      if (!this.assistant() || this.workersLooking) return;
      const by = this.workerTasks();
      const look = terminals().filter((k) => by.has(k.address) && (starting(k) || openCard(k.address) || this.lostCandidate(k)));
      if (!look.length) return;
      this.workersLooking = true;
      cx.spawn(async (cx) => {
        try {
          for (const k of look) {
            if (this.lostCandidate(k)) await this.checkLost(k.address, cx);
            else await this.screens.tick(k.address, k);
          }
        } finally { this.workersLooking = false; }
        cx.notify();
      });
    });
    // In a call the box is the call: this handle takes its keys (M mutes).
    // Drafts and dictation belong to the agent's first address (its origin), so they survive
    // Chat ⇄ Terminal, restarts from here, and app restarts.
    const labels = terminals().find((x) => x.address === this.addr)?.labels ?? {};
    this.originKey = labels["herdr.chat.origin"] || (this.slot ? `slot:${this.slot}` : null) || this.addr || "none";
    this.typing = labels["herdr.typing"] ? { addr: this.addr, at: Number(labels["herdr.typing"]) || 0 } : null;
    // 语音功能不提供
    this.draftFile = `${appHome()}/data/chat-drafts/${safe(this.originKey)}.json`;
    if (!this.addr && this.role) this.phase = "fresh";
    if (this.phase === "fresh") this.loadChoice(cx);
    this.loadFirst(cx, labels);
    if (this.addr || this.role) cx.spawn(async (cx) => { await this.loadDraft(cx); attach.prune(); });
    if (this.addr) cx.spawn(async (cx) => this.follow(cx));
    // A Coordinator tab's chat that missed its agent (started, or Herdr restarted, before this
    // copy saw it) takes the slot's live agent as soon as one shows, instead of staying empty.
    if (this.slot && !this.thread) cx.timer.every(2000, (cx) => this.adoptSlot(cx));
    // The list drew nothing while it has rows (scrolled past its end, a height gone wrong):
    // forget the heights and go to the newest again. Checked rarely; redraws only then.
    cx.timer.every(1500, (cx) => {
      if (!this.blank) return;
      this.blank = false;
      this.heights.clear(); this.measuredAt.clear(); this.measureGen++;
      this.anchor = null; this.pinned = true; this.stick = true;
      cx.notify();
    });
    if (this.addr) cx.spawn(async (cx) => this.watchAsks(cx));
    // Keys (keys.json "mod:chat") and the header's buttons (pane-chat) for this chat.
    // At most 5 s per wait (one pending nextCommand), so a reload's old build ends at its next
    // cx use instead of staying in memory.
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        // From the shell: data/chat-sendreq.json = { pane, text, files? }, then `herdr-app do
        // chat.send`(fill: true 时文字改为进入输入框;thread 时
        // { terminal, task, title },该 worker 的 thread 会在本聊天旁打开)。
        if (c === "send") {
          const f = `${appHome()}/data/chat-sendreq.json`;
          let req = null;
          try { req = JSON.parse(await fs.readFile(f, "utf8")); } catch {}
          // Tasks 面板的聊天没有 pane:它以其 layout 块的 id 应答,并且
          // { peek: true } 打开其 worker 的 terminal。
          const me = this.inner ? THREAD : this.myPane();
          if (req?.pane && req.pane === me && req.peek) {
            await fs.unlink(f).catch(() => {});
            this.toTerminal();
          } else if (req?.pane && req.pane === me && req.secret) {
            await fs.unlink(f).catch(() => {});
          } else if (req?.pane && req.pane === me && req.thread?.terminal) {
            await fs.unlink(f).catch(() => {});
            this.openThread(req.thread);
          } else if (req?.pane && req.pane === me && req.fill) {
            await fs.unlink(f).catch(() => {});
            const v = String(req.text ?? "");
            this.box.set_value(v);
            this.box.set_selected_range({ start: v.length, end: v.length });
            this.box.focus();
            cx.notify();
          } else if (req?.pane && req.pane === me && String(req.text ?? "").trim()) {
            await fs.unlink(f).catch(() => {});
            // files:随附的路径,形式同拖放。
            const files = attach.paths(Array.isArray(req.files) ? req.files.map(String) : []);
            this.deliver({ id: `m${Date.now()}`, text: String(req.text).trim(), files, quote: null }, cx);
            this.pinned = true;
            this.stick = true;
            cx.notify();
          }
          continue;
        }
        // pane.go 落到这份副本上(mod.json 的 "focusable"):任务面板聊天将键盘收进其输入框;
        // pane 副本在获得焦点时已做过(draw()),再做一次也无害。
        if (c === "focus") { this.box.focus(); cx.notify(); continue; }
        if (focused()?.pane !== this.myPane()) continue;
        // Voice 已关闭(herdr-winapp settings > Window > Add-ons):其按键一律无效。
        // 精简:已移除听写/通话
        if (c === "find") this.openFind(cx);
        cx.notify();
      }
    });
  }

  // 忘掉已读内容:换了日志文件,或此文件被替换。
  reset() {
    this.records = [];
    this.start = null;
    this.end = 0;
    this.conv = null;
    // agent 留在后台运行的内容(core/bg-jobs.js),所打开的行,以及
    // 各自最后几行输出(job id -> 文本,打开期间),以及正在停止的任务。
    this.bgJobs = new BgJobs();
    this.jobOpen = null;
    this.jobOut = new Map();
    this.jobStopping = new Set();
    this.anchor = null;
    this.loadingEarlier = false;
  }

  // 关闭时(切回 terminal,或 pane 移除):其标记随之消失,Codex agent 等待中的
  // 提问被释放(Codex 在等 hook),改为在其终端里提问。Claude 的保留
  // 同 web 的卡片:期间其 terminal 显示自己的提示符。通话或录音随之结束。
  async close(cx) {
    if (this.host) return this.host.close(cx);
    this.box.release();
    this.findBox.release();
    this.scroll.release();
    if (!this.addr || this.machine) return;
    await exec("sh", ["-c", 'rm -f "$1/open/$2"; for f in "$1/req/$2".*.json; do [ -f "$f" ] && grep -q \'"turn_id"\' "$f" && : > "$1/ans/${f##*/}"; done; true', "x", this.askDir, this.addr]);
  }

  // // ---- 草稿 -----------------------------------------------------------------------------

  async loadDraft(cx) {
    const text = await fs.readFile(this.draftFile, "utf8").catch(() => null);
    let d = null;
    try { d = JSON.parse(text ?? "null"); } catch {}
    if (!d) return;
    if (d.text && !this.box.value()) this.box.set_value(d.text);
    this.files = Array.isArray(d.files) ? d.files : [];
    this.quote = d.quote ?? null;
    this.queue = Array.isArray(d.queue) ? d.queue : [];
    cx.notify();
  }

  saveSoon(cx) {
    this.saveAt = Date.now();
    cx.timer.after(400, (cx) => { if (Date.now() - this.saveAt >= 380) cx.spawn(async () => this.saveDraft()); });
  }

  async saveDraft() {
    const d = { text: this.box.value(), files: this.files, quote: this.quote, queue: this.queue };
    this.markTyping(!!(d.text.trim() || d.files.length || d.quote));
    const empty = !d.text.trim() && !d.files.length && !d.quote && !d.queue.length;
    try {
      if (empty) { if (await fs.exists(this.draftFile)) await fs.unlink(this.draftFile); return; }
      await fs.mkdir(`${appHome()}/data/chat-drafts`, { recursive: true });
      await fs.writeFile(this.draftFile, JSON.stringify(d));
    } catch {}
  }

  // 输入框留有未发送文字时,其 agent 终端会标注(herdr.typing=<ms>,每次
  // 分钟保留,发送或清除后移除):Herdr 新闻及其他
 // 自动消息会等它们(herdr-task 的 news.py,)。
  markTyping(on) {
    const addr = this.phase === "ended" ? null : this.addr, at = Date.now(), was = this.typing;
    if (on && addr && was?.addr === addr && at - was.at < 60000) return;
    if (!on && !was) return;
    this.typing = on && addr ? { addr, at } : null;
    if (was && was.addr && was.addr !== this.typing?.addr) hc(["label", was.addr, "herdr.typing="]).catch(() => {});
    if (this.typing) hc(["label", addr, `herdr.typing=${at}`]).catch(() => {});
  }

  addFiles(list) {
    for (const f of list) if (!this.files.some((x) => x.path === f.path)) this.files.push(f);
    this.files = this.files.slice(0, 20);
  }

  // // ---- Claude 的权限询问 -------------------------------------------------------------

  // hook 的标志:本聊天正在显示。每隔几秒更新一次,15 秒后视为失效。来自
  // 聊天得知其 agent 的那一刻(而非等到会话显示):由此启动的 agent
  // 从这里启动的在最初几秒可能提问;无该 flag 时 hook 交给 CLI 处理。
  async flag() {
    if (this.machine || !this.addr || this.phase === "ended") return;
    await exec("sh", ["-c", 'mkdir -p "$1/open" "$1/req" "$1/ans" && touch "$1/open/$2"', "x", this.askDir, this.addr]);
  }

  // 每个聊天一个循环,无论它当前显示哪个 agent:本机的请求由其
 // 文件夹,另一台机器的经 herdr-core 链接读取。
  async watchAsks(cx) {
    if (this.askLoop) return;
    this.askLoop = true;
    await exec("sh", ["-c", 'mkdir -p "$1/open" "$1/req" "$1/ans"', "x", this.askDir]).catch(() => {});
    for (;;) {
      if (!this.addr) { await cx.sleep(3000); continue; }
      if (this.machine) {
        await this.readRemoteAsks(cx).catch(() => {});
        await cx.sleep(3000);
        continue;
      }
      await this.readAsks(cx);
      // 同时只保留一个 watch,与日志的做法相同。
      this.askWatch ??= watchFolder(`${this.askDir}/req`).finally(() => { this.askWatch = null; });
      await Promise.race([this.askWatch, cx.sleep(5000)]);
    }
  }

 // 另一台 machine 上的 agent:它在那边仍在等待的请求(hook 仍在),
  // 以及此处各卡片的结束方式,一次调用完成(同服务端的 poll,service/asks.ts)。
  // id 保持那台 machine 本地的(<terminal>.<time>.<pid>);其回复也按原路返回。
  async readRemoteAsks(cx) {
    const machine = this.machine, local = this.addr.slice(machine.length + 1);
    const r = await exec("hc", ["exec", "--on", machine, "sh", "-c", REMOTE_LIST, "x", local, ...this.asks.map((a) => a.id)]);
    if (r.code !== 0 || this.machine !== machine) return;
    const reqs = new Map(), ends = new Map();
    for (const line of String(r.stdout ?? "").split("\n")) {
      const [kind, id, ...rest] = line.split("\t");
      if (!id || !/^[\w.-]+$/.test(id)) continue;
      if (kind === "req") reqs.set(id, rest.join("\t"));
      else if (kind === "end" && rest.join("\t").trim()) ends.set(id, rest.join("\t").trim());
    }
    const kept = this.asks.filter((a) => reqs.has(a.id));
    for (const a of this.asks.filter((a) => !reqs.has(a.id))) this.askEnded(a, ends.get(a.id) || "不再等待");
    let added = false;
    for (const [id, text] of reqs) {
      if (kept.some((a) => a.id === id)) continue;
      let req = null;
      try { req = JSON.parse(text); } catch {}
      const w = req ? words(req) : { kind: "permission", title: "Claude 问了对话读不到的内容", detail: "", unread: true };
      kept.push({ id, req, words: w, machine });
      added = true;
    }
    if (added || kept.length !== this.asks.length) {
      this.asks = kept;
      this.cards.keep(kept.map((a) => a.id));
      if (added) this.askAlert();
      cx.notify();
    }
  }

  async readAsks(cx) {
    // 每个请求命名为 <terminal>.<time>.<hook pid>:hook 被杀掉的(无论 Claude 还是
    // 由 Codex 停止)已不复存在,因此删除其文件。
    const r = await exec("sh", ["-c", 'cd "$1/req" 2>/dev/null || exit 0; for f in "$2".*.json; do [ -f "$f" ] || continue; p=${f%.json}; p=${p##*.}; if kill -0 "$p" 2>/dev/null; then echo "$f"; else rm -f "$f"; fi; done; true', "x", this.askDir, this.addr]);
    const ids = r.stdout.split("\n").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    const kept = this.asks.filter((a) => ids.includes(a.id));
    // 未经这里应答即消失:hook 会说明缘由(data/chat-asks/end/<id>:answered
    // 或在 terminal 中被拒绝,agent 已停止),否则是 Claude 停止等待。
    for (const a of this.asks.filter((a) => !ids.includes(a.id))) {
      const how = (await readTextFile(`${this.askDir}/end/${a.id}`).catch(() => null))?.trim();
      this.askEnded(a, how || "不再等待");
    }
    let added = false;
    for (const id of ids) {
      if (kept.some((a) => a.id === id)) continue;
      const text = await readTextFile(`${this.askDir}/req/${id}.json`).catch(() => null);
      let req = null;
      try { req = JSON.parse(text ?? ""); } catch {}
      // 此处无法读取:只能在终端里允许。
      const w = req ? words(req) : { kind: "permission", title: "Claude 问了对话读不到的内容", detail: "", unread: true };
      kept.push({ id, req, words: w });
      added = true;
    }
    if (added || kept.length !== this.asks.length) {
      this.asks = kept;
      this.cards.keep(kept.map((a) => a.id));
      if (added) this.askAlert();
      cx.notify();
    }
  }

  // 新的请求:agent 在等用户,同其被阻塞时一样。
  askAlert() {
    // thread 的 worker 只从其自身 tab 的聊天或 Inbox 提醒一次,不会重复。
    if (this.thread) return;
    const mine = this.myPane();
    const looking = Boolean(mine) && focused()?.pane === mine && window()?.active;
    const k = terminals().find((x) => x.address === this.addr);
    if (assistant(k) && !notifies(k, "need")) return;
    if (settings()?.sounds?.enabled !== false) playSound("blocked");
    if (looking) return;
    const tab = mine && panes().find((p) => p.pane === mine)?.tab;
    toast({ title: `${toastWho(k)} · Needs you`, body: this.asks[0]?.words.title ?? "", level: "alert",
      action: tab ? { name: "tab.select", args: { id: tab } } : undefined });
  }

  // 已关闭的请求:生成其 quiet line。问题类请求已有来自日志的对应行(log.js 的 "ask")。
  askEnded(ask, how) {
    this.loadAskEnds();
    if (ask.words.kind === "questions" || this.askEnds.some((e) => e.id === ask.id)) return;
    this.askEnds = [...this.askEnds, { id: ask.id, title: ask.words.title, how, at: askAt(ask.id) }].slice(-20);
    try { localStorage.setItem(`askends:${this.addr}`, JSON.stringify(this.askEnds)); } catch {}
  }

  // 本 agent 已关闭的提问,来自重新加载之前。
  loadAskEnds() {
    if (this.askEndsOf === this.addr) return;
    this.askEndsOf = this.addr;
    try { this.askEnds = JSON.parse(localStorage.getItem(`askends:${this.addr}`) ?? "[]") ?? []; } catch { this.askEnds = []; }
  }

  // 卡片的回答交给等待中的 hook;它把回答打印为 Claude 的决定。
  reply(ask, text, cx) {
    this.asks = this.asks.filter((a) => a !== ask);
    const how = howAnswered(ask, text, "在对话中");
    if (how) this.askEnded(ask, how);
    cx.notify();
    // task worker 的请求也可能显示在其 Assistant 的聊天中:那份副本记录了处理结果。
    const where = howAnswered(ask, text, this.thread || this.t?.labels?.["herdr.task"] ? "在任务的对话中" : "在它的对话中");
    cx.spawn(async () => ask.machine ? answerRemote(ask.machine, ask.id, text, where) : answerAsk(this.askDir, ask.id, text, where));
  }

  // // ---- 任务 worker 的询问(Assistant 的对话)---------------------------------------------
  // 用户的决定(DECISIONS,Tasks:"Answer from the Assistant's chat"):在任务的
  // worker 的请求(权限、提问、计划),其卡片显示在 Assistant 的聊天中
  // 同样,也可在那里回答。卡片位于时间线上任务 needs-you 行正下方
  // (timelineCards()),以其任务为标题。每个任务一张卡片(其最早的请求)。
  // Tasks 面板的引擎(inbox.js,由 tab 栏运行)让 hook 对每一条不断询问
  // 屏幕上没有 worker 时列出等待中的请求:shared "inbox.asks" = [{ id, terminal }]。
  // 回答按 worker 自己聊天发送的方式发出(answerAsk());随后每个副本都关闭
  // 并用一行安静提示说明方式。输入框中的输入仍只发给 Assistant。

  // 本 space 的任务,按其 agent 的地址。
  workerTasks() {
    const space = this.assistant(), out = new Map();
    if (!space || this.machine) return out;
    for (const x of this.spaceTasks ?? []) {
      if ((x.space ?? x.queue?.space) !== space || !x.ref) continue;
      for (const a of x.live ?? []) if (a.address && !out.has(a.address)) out.set(a.address, x);
    }
    return out;
  }

  // worker 请求立即显示,每个任务一条,按其行的顺序。来自 render:尚未
  // 未读的随后立即读取;由此发出而无应答的会得到一条安静提示。
  workerAsks(cx) {
    const by = this.workerTasks();
    const listed = (shared("inbox.asks") ?? []).filter((a) => by.has(a.terminal));
    const ids = new Set(listed.map((a) => a.id));
    for (const id of [...this.answeredAsks]) if (!ids.has(id)) this.answeredAsks.delete(id);
    const gone = [...this.shownAsks.values()].filter((a) => !ids.has(a.id));
    const unread = listed.filter((a) => !this.shownAsks.has(a.id) && !this.readingAsks.has(a.id));
    if (gone.length || unread.length) {
      for (const a of gone) this.shownAsks.delete(a.id);
      for (const a of unread) this.readingAsks.add(a.id);
      this.workerCards.keep([...this.shownAsks.keys(), ...unread.map((a) => a.id)]);
      cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
        for (const a of gone) {
          if (a.answered) continue;
          const how = (await readTextFile(`${this.askDir}/end/${a.id}`).catch(() => null))?.trim();
          this.workerAskEnded(a, how || "不再等待");
        }
        for (const a of unread) {
          const x = by.get(a.terminal);
          let req = null;
          try { req = JSON.parse((await readTextFile(`${this.askDir}/req/${a.id}.json`).catch(() => null)) ?? ""); } catch {}
          const w = req ? words(req) : { kind: "permission", title: "Claude 问了对话读不到的内容", detail: "", unread: true };
          this.readingAsks.delete(a.id);
          if ((shared("inbox.asks") ?? []).some((b) => b.id === a.id)) this.shownAsks.set(a.id, { id: a.id, terminal: a.terminal, req, words: w, ref: x.ref, title: x.title, at: Date.now() });
        }
        cx.notify();
      }));
    }
    const order = this.taskOrder ?? [];
    const rank = (a) => { const i = order.indexOf(a.ref); return i < 0 ? order.length : i; };
    const out = [];
    for (const a of [...this.shownAsks.values()].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1))) {
      if (!this.answeredAsks.has(a.id) && !out.some((b) => b.ref === a.ref)) out.push(a);
    }
    return out;
  }

  // 在其卡片上就地应答:与 worker 自身聊天的投递方式相同(answerAsk())。
  replyWorker(ask, text, cx) {
    this.answeredAsks.add(ask.id);
    ask.answered = true;
    const how = howAnswered(ask, text, "here");
    if (how) {
      // 问题会注明已应答的内容(worker 的日志不在此聊天中)。
      let picked = "";
      try { picked = Object.values(JSON.parse(text).hookSpecificOutput?.decision?.updatedInput?.answers ?? {}).join("; "); } catch {}
      this.workerAskEnded(ask, picked ? `${how}: ${picked}` : how);
    }
    cx.notify();
    cx.spawn(async () => answerAsk(this.askDir, ask.id, text, howAnswered(ask, text, "在 Assistant 的对话中")));
  }

  // worker 的请求已关闭:在这里生成其 quiet line,连同其 task。
  workerAskEnded(ask, how) {
    this.loadAskEnds();
    if (this.askEnds.some((e) => e.id === ask.id)) return;
    this.askEnds = [...this.askEnds, { id: ask.id, title: `${ask.ref} · ${ask.words.title}`, how, at: this.afterNews(ask.ref, askAt(ask.id)) }].slice(-20);
    try { localStorage.setItem(`askends:${this.addr}`, JSON.stringify(this.askEnds)); } catch {}
  }


  // 聊天首次见到无自带时间的内容(密钥请求)时的时刻:每个
  // 聊天(shared "chat.cardseen"),因此后打开的任务聊天会把卡片放回它
  // 也已出现。新的在本轮 render 之后发出(render())。
  seenAt(key) {
    const known = shared("chat.cardseen")?.[key] ?? this.seenNew?.[key];
    if (known) return known;
    this.seenNew = { ...(this.seenNew ?? {}), [key]: Date.now() };
    return this.seenNew[key];
  }

  // Assistant 聊天中的 worker 卡片紧跟其 task 的 needs-you line 之下(news
  // 可能比提问晚一点才出现):该行的时刻,取 `at` 附近的那条。
  afterNews(ref, at) {
    const near = (this.needsAt?.get(ref) ?? []).filter((n) => n >= at - 300000 && n <= at + 1800000);
    return near.length ? Math.max(at, Math.max(...near) + 1) : at;
  }

  // 本聊天中等待的卡片,各带其时刻:本 agent 自己的(提问、密钥请求、
  // 其启动界面)以及 Assistant 聊天中其任务的 worker。每条:
  // { id, at, strips, owner(其 AskCards,供按键用)、ask、question(提问卡片) }。
  timelineCards() {
    const out = [];
    for (const a of this.asks) out.push({ id: `card:${a.id}`, at: askAt(a.id), strips: this.cards.strips(a, { who: this.cli() }), owner: this.cards, ask: a, question: a.words.kind === "questions" });
    const cq = this.codexCard();
    if (cq) out.push({ id: `card:${cq.id}`, at: cq.at, strips: this.codexCards.strips(cq, { who: "Codex" }), owner: this.codexCards, ask: cq, question: true });
    for (const a of this.sasks ?? []) {
      // 密钥卡片已移除
    }
    const own = this.addr && openCard(this.addr);
    if (own) out.push({ id: `card:${own.id}`, at: own.opened, strips: screenStrips(own, { who: this.cli(),
      busy: this.screenBusy.has(own.id), error: this.screenErr.get(own.id),
      press: (i, cx) => this.pressScreen(own, i, cx), toTerminal: () => this.toTerminal() }) });
    // worker 的:以其 task 为标题,其聊天是右侧的一个低调链接。
    const open = (id, ref, title, terminal) => [linkCtl(`wask-open-${id}`, "打开对话", () => openTaskThread(terminal, ref, title))];
    for (const a of this.wasks ?? []) {
      if (!a.secret) out.push({ id: `card:${a.id}`, at: this.afterNews(a.ref, askAt(a.id)), owner: this.workerCards, ask: a,
        strips: this.workerCards.strips(a, { who: a.ref, links: open(a.id, a.ref, a.title, a.terminal), terminal: false, chatHint: "或在它自己的对话里写给它。" }) });
    }
    for (const [addr, x] of this.workerTasks()) {
      // 其 secret 请求的时刻,即便被它自己的问题遮住也会记录(seenAt())。
      // 密钥卡片已移除
      const card = openCard(addr);
      if (card) out.push({ id: `card:${card.id}`, at: this.afterNews(x.ref, card.opened), strips: screenStrips(card, { who: x.ref, links: open(card.id, x.ref, x.title, addr),
        busy: this.screenBusy.has(card.id), error: this.screenErr.get(card.id), press: (i, cx) => this.pressScreen(card, i, cx) }) });
    }
    return out;
  }

  // 在 Ready task 的 news line 上 Accept:执行 Tasks panel 的命令(herdr-task accept:先合并
  // 有待合并时先显示 merging,否则 done)。
  acceptTask(x, _cx) {
    // Accept 先展示你要批准的内容:Accept 卡片(mods/accept-card)会运行 herdr-task
    // 由其自身的 Accept 接受;本行在定时器上读取该变化。
    openOverlay({ mod: "accept-card", kind: "dialog", modal: true, width: 640, height: 640,
      props: { ref: x.ref, folder: x.folder, machine: this.machine ?? null, title: x.title } });
  }


  // agent 的状态。它停靠在本聊天之后时不在 agents() 里,此时以 core 的说法为准。
  status() {
    const a = agents().find((x) => x.address === this.addr);
    if (a) return a.status;
    const k = terminals().find((x) => x.address === this.addr);
    return ["working", "blocked", "done", "idle"].includes(k?.status) ? k.status : null;
  }

  // 本聊天的 agent:hc get 的记录(locate()),附实时状态与轮次。
  ownTerminal() {
    const live = terminals().find((x) => x.address === this.addr);
    if (!this.t || this.t.address !== this.addr) return live ?? null;
    return live ? { ...this.t, status: live.status, turn: live.turn, state: live.state } : this.t;
  }

  log(args) {
    return exec("sh", ["-c", LOG, "log", ...args], { on: this.machine });
  }

  // // ---- 启动画面与丢失的会话 ------------------------------------------------------

  // 新的启动屏卡片:agent 在等用户,同其提问时一样。任务的 worker
  // 来自其 Assistant 聊天的提醒(卡片由该处弹出),按任务命名。
  screenAlert(card) {
    const k = terminals().find((x) => x.address === card.addr);
    const task = this.workerTasks().get(card.addr);
    if (card.addr === this.addr && assistant(k) && !notifies(k, "need")) return;
    if (settings()?.sounds?.enabled !== false) playSound("blocked");
    const mine = this.myPane();
    if (Boolean(mine) && focused()?.pane === mine && window()?.active) return;
    const tab = mine && panes().find((p) => p.pane === mine)?.tab;
    toast({ title: `${task?.ref ?? toastWho(k)} · Needs you`, body: `${card.cli} is waiting on its start screen.`, level: "alert",
      action: tab ? { name: "tab.select", args: { id: tab } } : undefined });
  }

  // 点击启动屏的选项(其卡片在这里或 Assistant 的 chat 中)。
  // Codex 的未决问题(其日志里带问题的 ask),当它停在屏幕上等待时,如同
  // 问题卡片对应一个 AskUserQuestion 请求;打开期间是同一对象,因此
  // 卡片保留其已选项。
  codexCard() {
    if (this.kind !== "codex" || this.status() !== "blocked") return null;
    const x = [...(this.conv?.items ?? [])].reverse().find((i) => i.kind === "ask");
    if (!x || x.closed || !x.questions?.length) return null;
    if (this.codexAsk?.item === x) return this.codexAsk;
    const req = { tool_name: "AskUserQuestion", tool_input: { questions: x.questions.map((q) => ({ question: q.text, header: q.header, multiSelect: false, options: q.choices })) } };
    this.codexAsk = { id: `cq-${x.id}`, at: x.at ?? Date.now(), item: x, req, words: words(req) };
    return this.codexAsk;
  }

  // 卡片的回答(形式与 hook 相同:core/asks.js answers() 或拒绝),按下时
  // Codex 的屏幕,仅当其显示这些问题时:选项与 Other 文字(codexSteps),
  // Dismiss 和 "Chat about this" 对应 Esc,"Answer in terminal" 不按任何键。
  answerCodex(ask, text, cx) {
    let d = null;
    try { d = JSON.parse(text).hookSpecificOutput?.decision; } catch {}
    if (!d) return;
    const qs = ask.item.questions, map = d.updatedInput?.answers;
    cx.spawn(async (cx) => {
      const screen = (await hc(["read", this.addr]).catch(() => null))?.stdout ?? "";
      if (!codexOnScreen(screen, qs)) { toast({ title: "Codex", body: "它的屏幕现在显示别的内容:请在终端里回答。", level: "alert" }); return; }
      const steps = map ? codexSteps(qs, qs.map((q) => map[q.text] ?? "")) : [{ keys: ["esc"] }];
      for (const st of steps ?? []) {
        if (st.paste !== undefined) await hc(["send", "--force", this.addr, st.paste]).catch(() => null);
        else await hc(["keys", this.addr, ...st.keys]).catch(() => null);
        await cx.sleep(150);
      }
      cx.notify();
    });
  }

  pressScreen(card, i, cx) {
    if (this.screenBusy.has(card.id)) return;
    this.screenBusy.add(card.id);
    this.screenErr.delete(card.id);
    cx.notify();
    cx.spawn(async (cx) => {
      const err = await this.screens.press(card, i).catch((e) => String(e?.message ?? e));
      this.screenBusy.delete(card.id);
      if (err) this.screenErr.set(card.id, err);
      cx.notify();
    });
  }

  // 可能在 resume 后已在 shell 处结束的 worker(其 CLI 已不在那里运行):
  // 只查看一次。
  lostCandidate(k) {
    return Boolean(k) && k.state === "live" && !cliOf(k) && !k.status && !this.lostTried.has(k.address);
  }

  // `addr` 处的 agent 是否因所续接的 session 已消失而停止("No conversation
  // …已找到”)?那么自动启动新的。每个 agent 只查看一次。
  async checkLost(addr, cx, t = null) {
    if (this.lostTried.has(addr)) return false;
    this.lostTried.add(addr);
    if (!t) { try { t = JSON.parse((await hc(["get", addr, "--json"])).stdout || "null"); } catch {} }
    const kind = cliOf({ agent: (t?.argv ?? []).map((a) => String(a).split("/").pop()).find((a) => /^(claude|codex)$/.test(a)) });
    const fresh = kind ? agent.freshArgv(kind, t?.argv) : null;
    if (!fresh) return false;
    if (t.state !== "live" && (t.exit_code ?? 1) === 0) return false;
    const screen = (await hc(["read", addr, "--lines", "40"]).catch(() => null))?.stdout ?? "";
    if (!LOST.test(screen.split("\n").slice(-30).join("\n"))) return false;
    // 只启动一次,无论哪个聊天先发现(它自己的或其 Assistant 的):shared 的 "chat.lost"
    // = { [address]: when }。
    const lost = shared("chat.lost") ?? {};
    if (Date.now() - (lost[addr] ?? 0) < 120000) return true;
    setShared("chat.lost", { ...Object.fromEntries(Object.entries(lost).filter(([, at]) => Date.now() - at < 120000)), [addr]: Date.now() });
    await this.lostSession(t, kind, fresh, cx);
    return true;
  }

  // 与 herdr-winapp 相同:session 已消失,于是在同一聊天中开启新 session,并附一条简短
  // 交接,聊天区用一行安静提示说明(brief())。agent 仍在它的 shell
  // (任务的 worker)会在那个 shell 里获得新输入的 agent:同一终端、同一 label,以及
  // 任务。terminal 已结束的会以模型选择器重启同样的方式重新启动(agent.js)。
  async lostSession(t, kind, fresh, cx) {
    // task 的 worker:以其 task 的 id 命名(herdr-task 给 agent 取名如 hat-4-fix-login)。
    const named = /^([a-z][a-z0-9]*)-(\d+)(?:-|$)/.exec(t.name ?? "");
    const ref = this.workerTasks().get(t.address)?.ref ?? (t.labels?.["herdr.task"] && named ? `${named[1].toUpperCase()}-${named[2]}` : null);
    // Assistant 的角色写在其第一条消息(即模板)里:它会再次收到这条消息。
    const template = assistant(t) && !t.address.includes("/") ? await readTextFile(`${home()}/.config/herdr-core/templates/assistant.md`).catch(() => null) : null;
    const msg = lostMessage({ ref, template });
    const mine = t.address === this.addr;
    if (mine) { this.note = { id: `note-${Date.now()}`, text: WORDS.sessionGone }; cx.notify(); }
    try {
      if (t.state === "live") {
        // hc send 把该行粘贴进 shell 并按回车。
        const r = await hc(["send", t.address, [...fresh, msg].map(shellWord).join(" ")]);
        if (r.code !== 0) throw new Error(refusal(r).message);
      } else {
        const pane = this.myPane();
        if (!mine || !pane) return;
        // herdr-task 会再次恢复已消失的 session:其任务改为重新启动。
        if (t.labels?.["herdr.task"]) throw new Error("让 Assistant 恢复它的任务。");
        this.swapping = true;
        const next = await agent.restart(t, { argv: [...fresh, msg], resume: true, base: fresh }, pane);
        this.follow_to(next);
      }
      if (mine) this.note = { id: `note-${Date.now()}`, text: sessionStarted };
    } catch (e) {
      if (mine) this.note = { id: `note-${Date.now()}`, text: sessionFailed(String(e?.message ?? e)) };
    } finally {
      this.swapping = false;
    }
    if (mine) cx.timer.after(8000, (cx) => { this.note = null; cx.notify(); });
    cx.notify();
  }

  // // ---- 跟随日志 --------------------------------------------------------------------

  // agent 的进程及其日志,每隔几秒复查一次:/clear、resume 或新会话
  // 同一终端启动的 agent 会另写一个文件。
  async locate(cx) {
    if (this.swapping) return;
    const r = await hc(["get", this.addr, "--json"]);
    let t = null;
    try { t = JSON.parse(r.stdout || "null"); } catch {}
    // 永久消失(重启后从这里移除),或暂时不可达(另一个
    // machine 离线:稍后重试,不要判定为已结束)。
    const gone = /not_found|no terminal/.test(`${r.stdout}\n${r.stderr}`);
    if (!gone && (!t || t.error)) return;
    if (gone || t?.state !== "live") {
      // 从这里重启(可能在 Herdr 重启之前):新 agent 携带来源标记。
      const next = terminals().find((x) => x.state === "live" && x.address !== this.addr && x.labels?.["herdr.chat.origin"] === this.originKey);
      if (next) { this.follow_to(next.address); return; }
      // 它因所续接的 session 已消失而结束:会自动启动一个新的。
      if (!gone && t && !this.thread && await this.checkLost(this.addr, cx, t)) return;
      // thread 的 worker 已结束:对话保留可读,输入框移除(composer())。
      if (this.thread) {
        // 仅从其自身日志读一次,以列表给出的那份为准(只读,带 Resume)。
        const log = this.endedLog;
        this.endedLog = null;
        if (!this.path && log?.path && KINDS[log.kind]) { this.path = log.path; this.kind = KINDS[log.kind]; this.reset(); this.pinned = true; }
        else if (!this.conv && !this.path) this.set("ended", cx);
        if (!this.ended) { this.ended = true; cx.notify(); }
        return;
      }
      this.set("ended", cx);
      return;
    }
    // 停驻在此聊天后,terminal 失去 core keep(terminal.park 会将其关闭):需将其
    // 再恢复,这样即使 core 丢失,agent 也能像其他 pane 的终端一样存活。
    // thread 只显示 task worker,而 worker 按设计没有 pane:其 keep 归 Herdr 所有。
    if (!this.thread && t.keep === false && !t.labels?.["herdr.tab"] && !panes().some((p) => p.terminal === this.addr)) await hc(["keep", this.addr]);
    // agent 在没有自己 pane 的期间丢失了与本聊天的关联(herdr.chat):重新建立关联
    // 否则 header、agents 列表与清扫会把它当作没有聊天的 agent。
    // 只指向此聊天最后认领的 pane,且前提是它仍是 chat pane。
    const pane = this.lastPane ?? (this.slot && this.slotRec()?.pane) ?? null;
    if (!this.thread && !this.inner && !this.swapping && !t.labels?.["herdr.chat"] && pane && !panes().some((p) => p.terminal === this.addr)
      && panes().some((p) => p.pane === pane && p.mod === "chat")) await hc(["label", this.addr, `herdr.chat=${chatLabel(pane)}`]);
    const kind = KINDS[t.status?.app] ?? KINDS[t.foreground?.name];
    // 因所续接的 session 已消失而回到 shell:在那里启动一个新 agent。
    if (!kind) { if (!(await this.checkLost(this.addr, cx, t))) this.set("unsupported", cx); return; }
    this.t = t;
    this.loadFirst(cx, t.labels);
    this.argv = t.foreground?.argv ?? t.argv ?? null;
    const pid = t.foreground?.pid;
    if (!pid) { if (this.phase !== "ready") this.set("none", cx); return; }
    // agent 自身设置的内容(model、effort、speed),每个进程读一次。
    if (this.dfltFor !== `${kind}|${pid}`) {
      this.dfltFor = `${kind}|${pid}`;
      cx.spawn(async (cx) => { this.dflt = await agent.defaults(kind, this.machine); cx.notify(); });
      cx.spawn(async (cx) => { this.cmds = await slash.commands(kind, this.machine, t.foreground?.cwd ?? t.cwd); cx.notify(); });
      cx.spawn(async (cx) => { await this.loadTasks(); cx.notify(); });
      cx.spawn(async (cx) => { await this.loadReach(); cx.notify(); });
      if (this.assistant()) cx.spawn(async (cx) => { await this.loadSpaceTasks(); cx.notify(); });
    }
    const f = await exec("sh", ["-c", FIND, "chat", kind, String(pid)], { on: this.machine });
    let path = f.stdout.trim().split("\n").pop() ?? "";
    // 尚未进入 session(无报告、无轮次):可能停在自己的启动屏上,该屏
    // 在空聊天下方显示为一张卡片。
    if (!path && starting(t)) path = "pending";
    if (path === "pending") {
      // 尚未写出第一行的 Claude Code 还没有文件:显示空 chat。
      if (this.phase === "finding") { this.kind = kind; this.conv = new Conversation(kind); this.start = 0; this.set("ready", cx); }
      return;
    }
    if (!path) { if (this.phase !== "ready") this.set("none", cx); return; }
    if (path !== this.path || kind !== this.kind) {
      this.path = path;
      this.kind = kind;
      this.reset();
      this.pinned = true;
    }
  }

  // 从此改显示另一个 terminal(agent 已重启)。
  follow_to(addr) {
    this.addr = addr;
    this.flag();
    // 新 agent 的会话显示后输入框随之恢复:把键盘重新交给它。
    this.wasFocused = false;
    this.machine = addr.includes("/") ? addr.split("/")[0] : null;
    this.path = null;
    this.dfltFor = null;
    this.reset();
    this.phase = "finding";
  }

  set(phase, cx) {
    if (this.phase === phase) return;
    this.phase = phase;
    cx.notify();
  }

  rebuild() {
    this.conv = new Conversation(this.kind);
    this.conv.feed(this.records);
    // 从头读取的日志(新 agent 的首条消息触发)可能已经包含
    // 此处发出的消息。
    this.settlePending();
  }

  // 从这里发出的消息,只要日志里有了就算送达(至少是其输入的文字:图片
  // 路径转为图片,引用保持在前)。
  settlePending() {
    if (!this.conv) return;
    const users = this.conv.items.filter((x) => x.kind === "user");
    // 输入框里写好的答复,一旦日志把它记为 answer 即算送达。
    if (this.replied?.length) this.replied = this.replied.filter((r) => !users.some((u) => u.answer && (u.at ?? 0) >= r.at - 5000 && norm(u.text).includes(norm(r.text))));
    // 以另一机器进程消息形式送达的用户输入(一条注明调用方的 send):
    // 归属本端,即由此发出的(core/chat-view.js 的 ownWords)。
    for (const u of users) if (this.own?.has(u.id)) delete u.from;
    if (!this.pending?.length) return;
    const matches = (u, p) => (u.at ?? 0) >= p.at - 5000 &&
      (same(u.text, p.sent) || (p.match && norm(u.text).includes(p.match)) || (!p.match && u.images));
    for (const id of ownWords(users, this.pending, matches)) {
      (this.own ??= new Set()).add(id);
      delete users.find((u) => u.id === id).from;
    }
    this.pending = this.pending.filter((p) => !users.some((u) => matches(u, p)));
  }

  // 先给最新一页;之后只补日志新增的部分。
  async pull(cx) {
    if (!this.path) return;
    const path = this.path;
    if (this.start === null) {
      const r = await this.log(["page", path, "999999999999999", String(PAGE)]);
      if (path !== this.path) return;
      if (r.stdout.startsWith("missing")) { this.path = null; return; }
      const { head, records: recs } = records(r.stdout);
      if (head[0] !== "P") return;
      this.start = Number(head[1]);
      this.end = Number(head[2]);
      this.records = recs;
      this.rebuild();
      this.stick = true;
      this.phase = "ready";
      cx.notify();
      return;
    }
    const r = await this.log(["tail", path, String(this.end)]);
    if (path !== this.path) return;
    if (r.stdout.startsWith("missing")) { this.path = null; return; }
    const { head, records: recs } = records(r.stdout);
    if (head[0] !== "T") return;
    // 读到的比之前短:文件被替换了。从末尾重新开始。
    if (Number(head[2]) < this.end) { this.reset(); return; }
    this.end = Number(head[3]);
    if (!recs.length) return;
    this.records.push(...recs);
    if (this.records.length > KEEP && !this.loadingEarlier) {
      // 降到四分之三,这样只在偶尔时重建,而不是每条消息都重建。
      this.records = this.records.slice(-Math.floor(KEEP * 0.75));
      this.start = this.records[0].off;
      this.rebuild();
    } else this.conv.feed(recs);
    // 刚发出的 reaction 保持已发送的显示,直到日志确认一致。
    for (const [id, mine] of this.myReacts) {
      const logged = this.conv.reactions.get(id) ?? [];
      for (const [emoji, on] of mine) if (logged.some((r) => r.by === "you" && r.emoji === emoji) === on) mine.delete(emoji);
      if (!mine.size) this.myReacts.delete(id);
    }
    this.settlePending();
    this.stick = true;
    cx.notify();
  }

  // 用户滚到顶部时,显示内容之前的上一页。原先的第一行
  // 位置不变:新行插入后列表滚回原处。
  loadEarlier(cx) {
    if (this.loadingEarlier || !this.start || !this.path) return;
    this.loadingEarlier = true;
    const path = this.path, before = this.start;
    const rows = this.rows();
    const first = rows[Math.min(rows.length - 1, Math.max(1, this.range?.start ?? 1))]?.id;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await this.log(["page", path, String(before), String(PAGE)]);
        const { head, records: recs } = records(r.stdout);
        if (path !== this.path || this.start !== before || head[0] !== "P") return;
        this.start = Number(head[1]);
        this.records = [...recs, ...this.records];
        this.rebuild();
        this.anchor = first ? { id: first, until: Date.now() + 3000 } : null;
        this.reanchor = true;
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.loadingEarlier = false;
        cx.notify();
      }
    });
  }

  // 展开的 tools 行显示每次调用的输出,此刻才从日志读取。
  loadResults(row, cx) {
    const want = row.steps.filter((s) => s.out !== undefined && !this.results.has(s.id));
    if (!want.length || !this.path) return;
    for (const s of want) this.results.set(s.id, null);
    for (const k of this.results.keys()) { if (this.results.size <= KEEP) break; this.results.delete(k); }
    const offs = [...new Set(want.map((s) => s.out))].slice(0, 40);
    const path = this.path;
    cx.spawn(async (cx) => {
      try {
        const r = await this.log(["results", path, ...offs.map(String)]);
        for (const part of r.stdout.split("\x1e").slice(1)) {
          const nl = part.indexOf("\n");
          const off = Number(part.slice(0, nl));
          const line = part.slice(nl + 1).replace(/\n$/, "");
          for (const s of want) if (s.out === off) this.results.set(s.id, resultText(line, s.id) ?? "");
        }
      } catch {}
      cx.notify();
    });
  }

  async follow(cx) {
    let last = 0;
    for (;;) {
      try {
        if (!this.path || Date.now() - last > 4000) { last = Date.now(); await this.locate(cx); }
        if (this.phase === "ended" && !this.swapping) {
          // 收到提醒时 thread 保持打开;✕ 关闭它。
          if (this.thread) return;
          // Coordinator tab 的 chat 保留:重新清空,准备开始下一条。在收到任何内容之前就结束的
 // 运行失败(另一台 machine 上找不到其 CLI,)会说明原因,消息放回输入框。
          if (this.role) {
            const lost = !this.path ? this.pending.filter((p) => p.msg || p.text) : [];
            const why = lost.length ? await this.endedWhy(this.addr) : "";
            this.addr = null; this.path = null; this.reset(); this.phase = "fresh";
            if (lost.length) {
              this.pending = this.pending.filter((p) => !lost.includes(p));
              if (!this.box.value().trim()) this.box.set_value(lost.map((p) => p.msg?.text ?? p.text).filter(Boolean).join("\n\n"));
              toast({ title: `The ${this.role === "coordinator" ? "Assistant" : this.role} ended before it started`, body: `${why || "It exited before it was ready."} Your message is back in the box.`, level: "error" });
            }
            cx.notify();
            return;
          }
          this.closeSelf();
          return;
        }
        await this.pull(cx);
        await this.lookJobs(cx);
        await this.flag();
        // 它自己的启动屏,只要它还没有 session(或有卡片仍打开)。
        const k = this.ownTerminal();
        if (k && (starting(k) || openCard(this.addr))) { await this.screens.tick(this.addr, k); cx.notify(); }
        // hc 未能交付的第一条消息(startAgent):在 agent 空闲且无屏幕待应答时补交。
        if (this.firstSend && k?.turn > 0) this.firstSend = null;
        if (this.firstSend && k?.status?.state === "idle" && !openCard(this.addr)) {
          const text = this.firstSend;
          this.firstSend = null;
          const sent = await personHc(["send", this.addr, text]).catch(() => null);
          if (sent?.code !== 0) this.firstSend = text;
        }
        this.alerts(cx);
        this.drainQueue(cx);
        // 是随滚动条拖到顶部的:并非滚轮所致。
        if (this.start && (this.range?.start ?? 9) <= 1) this.loadEarlier(cx);
        if (this.error) { this.error = null; cx.notify(); }
      } catch (e) {
        this.error = String(e?.message ?? e);
        cx.notify();
      }
      const working = this.status() === "working" || this.pending.length > 0 || starting(this.ownTerminal());
      if (!this.machine && this.path) {
        // 这里:日志文件夹变化时唤醒,另外也会隔段时间主动查看。
        const dir = this.path.slice(0, this.path.lastIndexOf("/"));
        // 同时只保留一个 watch:文件夹可能连续数小时无变化。
        if (this.watching?.dir !== dir) this.watching = { dir, next: watchFolder(dir).finally(() => { this.watching = null; }) };
        await Promise.race([this.watching.next, cx.sleep(4000)]);
      } else {
        await cx.sleep(working ? 1500 : 4000);
      }
    }
  }

  // // ---- 发送 ------------------------------------------------------------------------------

  // Enter:立即(agent 工作时,它会在 turn 中途接收)。Ctrl+Enter 则当它
  // 有效:先扣住,空闲时自动发出。
  send(cx, hold = false) {
    // 选中的 "#space" 以其 mention 发出,其中指明目标(core/mentions.js)。
    const text = mentions.expandTasks(mentions.expand(this.box.value().trim(), this.picked), this.pickedTasks);
    this.picked = [];
    this.pickedTasks = [];
    // agent 在其 terminal 里提问时也一样:文字在那里作答(deliver())。
    if (!text && !this.files.length) return;
    const msg = { id: `m${Date.now()}`, text, files: this.files, quote: this.quote };
    this.box.set_value("");
    // 若此后 textarea 仍插入了 Enter 的换行,则再次移除。
    cx.timer.after(30, () => { if (!this.box.value().trim()) this.box.set_value(""); });
    this.files = [];
    this.quote = null;
    this.recall = -1;
    // /model(无论带不带名称)绝不会传到 CLI,否则会被它记住为默认值
    // 对之后每个 agent:改为打开模型选择器,并选定该模型。
    const mm = !msg.files.length && /^\/model(?:\s+(\S+))?\s*$/i.exec(text);
    if (mm) { this.quote = msg.quote; this.modelCommand(mm[1] ?? null, cx); this.saveSoon(cx); cx.notify(); return; }
    note("send", { n: msg.files.length });
    if (hold && this.status() === "working") this.queue.push(msg);
    else this.deliver(msg, cx);
    this.saveSoon(cx);
    this.pinned = true;
    this.stick = true;
    cx.notify();
  }

  // Enter(textarea 的 submit 与该键都如此标注;一次就够):接受所选
  // 列表显示时为 "/" 命令,否则发送(按住 Ctrl 可暂存)。
  enter(cx, hold) {
    if (Date.now() - (this.enterAt ?? 0) < 120) return;
    this.enterAt = Date.now();
    const list = this.suggestions();
    if (list.length) {
      const c = list[Math.min(this.slashSel, list.length - 1)];
      if (c.task || c.space) { this.pick(c, cx); const v = this.box.value(); cx.timer.after(30, () => this.box.set_value(v)); return; }
      if (this.box.value().trim() !== `/${c.name}`) { this.pick(c, cx); cx.timer.after(30, () => this.box.set_value(`/${c.name} `)); return; }
    }
    this.send(cx, hold);
  }

  // agent 停止工作后(且没有在提问),暂存的消息随之发出。
  drainQueue(cx) {
    if (!this.queue.length || this.phase !== "ready") return;
    const st = this.status();
    if (st === "working" || st === "blocked" || this.asks.length || openCard(this.addr) || this.pending.some((p) => !p.failed && !p.late)) return;
    const msg = this.queue.shift();
    if (msg.raw) personHc(["send", this.addr, msg.text]);
    else this.deliver(msg, cx);
    this.saveSoon(cx);
    cx.notify();
  }

  deliver(msg, cx) {
    // /model 无论通过何种途径都不会到达 CLI(暂存或由其他 mod 发送):send() 会说明原因。
    const mm = !msg.files?.length && /^\/model(?:\s+(\S+))?\s*$/i.exec(msg.text ?? "");
    if (mm) { this.modelCommand(mm[1] ?? null, cx); return; }
    if (this.phase === "fresh") { this.startAgent(msg, cx); return; }
    // CLI 显示自己的启动屏(此处是一张卡片):输入的字词可以选中它的某一项
    // 选项,因此它们等待其被回答后才继续(drainQueue())。
    if (openCard(this.addr)) { this.queue.push(msg); return; }
    // 卡片提问(问题、权限、plan):输入文字即可作答,如同在
    // CLI 的方式(cards.js 的 replyWith);卡片按钮也依然可用。
    if (this.asks.length && msg.text && !msg.files?.length) {
      this.replied = [...this.replied.slice(-20), { id: msg.id, text: msg.text, at: Date.now() }];
      this.cards.replyWith(this.asks[0], msg.text, cx);
      return;
    }
    // 正文之前的 Herdr tag line:它回复的消息、它提及的任务。
    const body = messageBody({ text: msg.text, quote: msg.quote?.text ?? null, tags: this.taskTags(msg.text) });
    const p = { id: `pending-${msg.id}`, text: msg.text, replyTo: msg.quote ? excerpt(msg.quote.text, 80) : null, files: msg.files.filter((f) => !f.image).map((f) => f.name),
      paths: msg.files.filter((f) => f.image).map((f) => f.path), at: Date.now(), sent: body,
      match: norm(msg.text).slice(0, 60) || null, msg };
    this.pending.push(p);
    const menu = msg.files.length ? null : slash.opensMenu(this.kind, msg.text);
    if (menu) this.note = { id: `note-${msg.id}`, text: `/${menu} opens a menu in the terminal. Switching to it.` };
    cx.spawn(async (cx) => {
      let r;
      try {
        const paths = await attach.deliver(msg.files, this.addr, this.machine);
        p.sent = [body, ...paths].filter(Boolean).join("\n\n");
        // (带图消息:若 Claude Code 丢失则再次按其 Enter,用 sendTyped();留在输入框里的消息
        // 上次那条现在只补回车,绝不重复输入)
        r = await sendTyped(this.sendIo(cx), this.addr, this.kind, p.sent, SETTLE, !!msg.stuck);
        msg.stuck = !!r.stuck;
        // 它自己的 dialog 在 terminal 中打开(一个问题或权限,没有卡片
        // 此处):文案按 “Reply instead…” 的方式回答。
        if (r.code !== 0 && refusal(r).kind === "blocked" && (this.kind === "claude" || this.kind === "codex")) r = await this.replyInstead(p.sent, cx);
      } catch (e) {
        r = { code: 1, stderr: String(e?.message ?? e) };
      }
      // 保留为气泡,点击即重发(clickRow),不丢内容。
      if (r.code !== 0) { p.failed = refusal(r).message; cx.notify(); return; }
      // 现在已在 agent 的 terminal 里:已发送。日志要等它被读取后才收录,因此显示为
      // 由此发出。
      p.delivered = true;
      cx.notify();
      // turn 进行中,Claude Code 会扣住已输入的消息直到该轮结束("ctrl+enter to send
      // 现在发送”):立即发送,让 agent 马上收到(具有引导作用)。
      if (this.kind === "claude") await this.steerNow(cx);
      if (menu) {
        // 自带菜单的命令:在其生效处显示,即终端。
        await cx.sleep(900);
        this.pending = this.pending.filter((x) => x !== p);
        this.note = null;
        this.toTerminal();
        return;
      }
      // 过了一会儿日志里仍没有,agent 也不再忙碌:如实说明,并保留到它出现为止。
      for (let i = 0; i < 60 && this.pending.includes(p) && !p.failed; i++) {
        await cx.sleep(i ? 5000 : 20000);
        if (this.status() !== "working") { p.late = true; cx.notify(); break; }
      }
    });
  }

  // agent 在终端里等待自己的对话框(提问、权限请求):Esc 关闭它
  // (Claude Code 会得知用户拒绝了;Codex 停止),之后这些文字作为消息发出,
  // 等它再次接受输入时。
  replyInstead(text, cx) {
    return replyInstead(this.sendIo(cx), this.addr, text);
  }

  // core/send.js 从此处需要的:hc、一个 sleep、agent 当前状态。
  sendIo(cx) {
    return { hc: personHc, sleep: (ms) => cx.sleep(ms), status: () => this.status() };
  }

  // 未发出的消息,按一下:重新发送。
  // 未就绪就结束的 agent:其 terminal 的最后一句话("sh: exec: claude: not found"),或 ""。
  async endedWhy(addr) {
    if (!addr) return "";
    const r = await hc(["read", addr, "--lines", "8"]).catch(() => null);
    const last = String(r?.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
    return last ? `It said: ${last.slice(0, 200)}` : "";
  }

  retry(p, cx) {
    this.pending = this.pending.filter((x) => x !== p);
    this.deliver(p.msg, cx);
  }

  // Claude Code 对工作期间排队消息的 "立即发送":Ctrl+Enter,仅当其
  // 屏幕提供该功能时(在空提示符上按下会是别的行为)。
  steerNow(cx) {
    return steerNow(this.sendIo(cx), this.addr);
  }

  // 排队行的行(pendingRows()):有其独立的 key,因此点击即 Send now。
  queuedLine(of) {
    return { kind: "queued", id: `qn:${of}` };
  }

  // 对 Claude Code 自身队列中的消息 Send now(#662):其屏幕未及时提供 Ctrl+Enter 的那条
  // (发送后 steerNow() 约一秒后放弃)会在原地等到其 turn 结束。此处再次按下即触发。
  sendQueuedNow(cx) {
    this.steering = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const ok = await this.steerNow(cx).catch(() => false);
      this.steering = ok ? null : WORDS.notNow;
      cx.notify();
      if (!ok) { await cx.sleep(4000); this.steering = null; cx.notify(); }
    });
  }

  // 暂存的消息立即发出(agent 在 turn 中途接收)。
  sendQueued(msg, cx) {
    this.queue = this.queue.filter((m) => m !== msg);
    if (msg.raw) personHc(["send", this.addr, msg.text]);
    else this.deliver(msg, cx);
    this.saveSoon(cx);
  }

  // 停止:用 CLI 自身的中断。工作行显示 "Stopping…" 直至其空闲。
  stop(cx) {
    if (this.status() !== "working") return;
    this.stopping = true;
    hc(["interrupt", this.addr]);
    cx.notify();
  }

  // 被暂存的消息放回输入框,可在发出前修改。
  editQueued(msg, cx) {
    this.queue = this.queue.filter((m) => m !== msg);
    const now = this.box.value().trim();
    this.box.set_value(now ? `${msg.text}\n\n${now}` : msg.text);
    this.addFiles(msg.files);
    if (msg.quote && !this.quote) this.quote = msg.quote;
    this.box.focus();
    this.saveSoon(cx);
  }

  // 在空输入框(或显示已撤回消息的框)里按上:重新调出上一条消息。
  recallStep(dir) {
    const mine = [...(this.conv?.items ?? []).filter((x) => x.kind === "user" && x.text && !x.from).map((x) => x.text), ...this.pending.map((p) => p.text)];
    const list = [...new Set(mine.reverse())];
    if (!list.length) return false;
    const next = this.recall + dir;
    if (next < -1 || next >= list.length) return true;
    this.recall = next;
    this.recalled = next < 0 ? "" : list[next];
    this.box.set_value(this.recalled);
    return true;
  }

  // // ---- 斜杠命令 -----------------------------------------------------------------------

  suggestions() {
    // submit 到达时,Enter 换出的新行可能已在输入框里。
    const v = this.box.value().replace(/\n+$/, "");
    if (this.slashOff === v) return [];
    // 结尾的 "#":该 agent 可触达的 space(选择后为其指定其中一个)。
    const h = mentions.typing(v);
    if (h !== null) {
      const sp = mentions.match(this.reach?.spaces ?? [], h.toLowerCase()).map((x) => ({ space: x, name: `#${x.name}`, about: x.route ? x.machine : "This machine", key: `space-${x.id}` }));
      if (sp.length) return sp;
    }
    // 结尾的 "@":该 agent 所在机器上的任务(herdr-task),按 ID 或标题;选择后为
    // 确切的那个(非本机的显示其文件夹)。
    const at = mentions.typingTask(v);
    if (at !== null) {
      const tk = mentions.matchTasks(this.mentionableTasks().map((x) => ({ ref: taskRef(x), title: x.title, status: SECTION_DOT[x.status ?? x.state] ?? x.state, at: x.ready_at ?? x.started ?? 0, x })), at, 8)
        .map(({ x }) => ({ task: x, name: `@${taskRef(x)}`, about: x.title, state: x.status_text ?? x.state, key: `task-${x.folder}-${taskRef(x)}` }));
      if (tk.length) return tk;
    }
    const w = slash.typing(v);
    if (w === null || !this.cmds.length) return [];
    return slash.match(this.cmds, w);
  }

  pick(c, cx) {
    if (c.space) {
      const next = mentions.pickInto(this.box.value(), c.space);
      this.picked = [...this.picked.filter((x) => x.name !== c.space.name), c.space];
      this.box.set_value(next);
      this.slashOff = next.replace(/\n+$/, "");
    } else if (c.task) {
      const own = (this.t?.foreground?.cwd ?? this.t?.cwd) === c.task.folder;
      const t = { ref: taskRef(c.task), route: "", folder: own ? "" : c.task.folder ?? "" };
      const next = mentions.pickTaskInto(this.box.value(), t);
      this.pickedTasks = [...this.pickedTasks.filter((x) => x.ref !== t.ref), t];
      this.box.set_value(next);
      this.slashOff = next.replace(/\n+$/, "");
    } else {
      this.box.set_value(`/${c.name} `);
      this.slashOff = `/${c.name} `;
    }
    this.box.focus();
    cx.notify();
  }

  // // ---- 还没有 agent 的对话(Coordinator 标签页)--------------------------------------------

  // 本 slot 已启动的实时 agent(如有)。
  slotAgent() {
    return terminals().find((x) => x.state === "live" && x.labels?.["herdr.chat.slot"] === this.slot)?.address ?? null;
  }

  // 空槽聊天对应的 agent 其实已在运行:跟随它,就像一开始就找到了。
  adoptSlot(cx) {
    if (this.addr || this.phase !== "fresh") return;
    // 等待其 machine 的消息(startAgent):machine 一恢复,便一并启动。
    const waited = this.pending.filter((p) => p.waiting);
    if (waited.length && online(waited[0].machine)) {
      this.pending = this.pending.filter((p) => !p.waiting);
      const [first, ...rest] = waited.map((p) => p.msg);
      this.startAgent({ ...first, text: [first, ...rest].map((m) => m.text).join("\n\n"), files: [first, ...rest].flatMap((m) => m.files) }, cx);
      return;
    }
    const a = this.slotAgent();
    if (!a) return;
    this.addr = a;
    this.machine = a.includes("/") ? a.split("/")[0] : null;
    this.path = null;
    this.reset();
    this.phase = "finding";
    cx.spawn(async (cx) => this.follow(cx));
    cx.spawn(async (cx) => this.watchAsks(cx));
    cx.notify();
  }

  // 本聊天的 pane 与 tab,取自 mods/coordinator 的记录(shared "coordinator.slots");否则
  // 其 tab 中唯一没有 agent 的聊天 pane。
  slotRec() {
    return shared("coordinator.slots")?.[this.slot] ?? null;
  }
  slotPane() {
    const rec = this.slotRec();
    if (rec?.pane && panes().some((p) => p.pane === rec.pane)) return rec.pane;
    const taken = new Set(terminals().filter((k) => k.state === "live").map(chatPane).filter(Boolean));
    const tab = rec?.tab ?? focused()?.tab;
    const free = panes().filter((p) => p.mod === "chat" && p.tab === tab && !taken.has(p.pane));
    return free.length === 1 ? free[0].pane : null;
  }

  // 第一条消息启动 agent(用其模板),停靠在本聊天之后,并带上
  // 消息作为其任务;之后聊天照常跟随它。
  startAgent(msg, cx, thenTerminal = false) {
    const pane = this.slotPane();
    if (!pane) { toast({ title: "无法启动 Assistant", body: "此对话还没找到它的窗格。稍等再试。", level: "error" }); return; }
    const rec = this.slotRec();
    const space = spaces().find((x) => x.id === (props()?.space ?? rec?.space));
    const machine = space?.machine ?? null;
    const folder = props()?.folder ?? rec?.folder ?? space?.folder ?? null;
    // Assistant 从 "assistant" 模板启动(改名前保存的聊天仍写着 "coordinator")。
    const named = props()?.template ?? this.role;
    const template = named === "coordinator" ? "assistant" : named;
    // 无消息(header 的 Terminal):只用模板。
    const reply = msg?.quote ? `<hc reply-to="${excerpt(msg.quote.text, 80)}"/>\n` : "";
    // 本机文件以路径发送;在另一台 machine 上,等它运行后文件随后送达(需要 hc put)。
    const local = machine || !msg ? [] : msg.files.map((f) => f.path);
    const task = msg ? [reply + msg.text, ...local].filter(Boolean).join("\n\n") : "";
    const p = msg ? { id: `pending-${msg.id}`, text: msg.text, replyTo: msg.quote ? excerpt(msg.quote.text, 80) : null, files: msg.files.filter((f) => !f.image).map((f) => f.name),
      paths: msg.files.filter((f) => f.image).map((f) => f.path), at: Date.now(), sent: task, match: norm(msg.text).slice(0, 60) || null } : { failed: null };
    if (msg) this.pending.push(p);
    // 其 machine 离线:在消息下方明说,待 machine 恢复后即启动它
    // 收回(adoptSlot);期间不丢任何内容。
    if (machine && !online(machine)) {
      if (msg) Object.assign(p, { waiting: WORDS.offline(machine), machine, msg });
      else toast({ title: `${machine} is offline`, body: "它恢复后 Assistant 会自动启动。" });
      cx.notify();
      return;
    }
    this.phase = "starting";
    cx.notify();
    cx.spawn(async (cx) => {
      // 所选设置(New space dialog,props.settings):模板文字结合该
      // agent 及其参数,作为一次性模板(与 restart.sh 同法),写在
      // 模板在其运行所在 machine 上。那边未安装的 agent 会让
      // 模板自身的命令(由该 machine 的同步写入)。
 // 每次启动都经过 one-off:其命令先清除父级 Claude Code
      // holder 可能携带的会话标记(core/clean-env.js),然后 exec 启动 agent:hc 运行
      // 模板命令放在 sh -c 下,而 sh 为 dash(Debian、Ubuntu)时 shell 会一直
      // terminal 的程序,聊天因此无从得知其 CLI。
      let launch = template, oneOff = null, words = "";
      const st = this.choice?.sel ?? props()?.settings;
      const on = machine ? { on: machine } : {};
      const there = !machine || !st?.agent ? true : (await knownAgents(on).catch(() => []))
        .some((a) => (a.key === st.agent || (a.run ?? [])[0] === st.agent) && a.installed !== false);
      {
        const q = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`);
        const src = (await exec("sh", ["-c", TEMPLATE + 'cat "$dir/$1.md"', "x", template], on).catch(() => null))?.stdout ?? "";
        const head = /^---\n([\s\S]*?)\n---\n?/.exec(src);
        const body = head ? src.slice(head[0].length) : src;
        const own = /^command:[ \t]*(.+)$/m.exec(head?.[1] ?? "")?.[1]?.trim();
        const cmd = st?.agent && there ? agent.argvFor(st, { agent: null, argv: [] }).argv.map(q).join(" ") : own;
        if (body.trim() && cmd) {
          words = body.trim();
          oneOff = `herdr-${template}-${Date.now().toString(36)}`;
          const file = `---\nname: ${oneOff}\ndescription: A one-off ${template} start with chosen settings (mods/chat), removed after use.\ncommand: ${cleanCommand(cmd)}\n---\n${body}`;
          await exec("sh", ["-c", TEMPLATE + 'printf "%s" "$2" > "$dir/$1.md"', "x", oneOff, file], on);
          launch = oneOff;
        }
      }
      const args = ["run", "--bg", "--json", "--no-parent", "--keep", ...(machine ? ["--on", machine] : []), ...(folder ? ["--cwd", folder] : []),
        "--label", `herdr.chat=${chatLabel(pane)}`, "--label", `herdr.chat.slot=${this.slot}`, "--label", `herdr.chat.origin=slot:${this.slot}`,
        "--label", `herdr.role=${this.role}`,
        ...(space ? ["--label", `herdr.coordinator.space=${String(space.id).split("/").pop()}`] : []),
        ...(rec?.tab ? ["--label", `herdr.coordinator.tab=${String(rec.tab).split("/").pop()}`] : []),
        launch, ...(task ? [task] : [])];
      const r = await hc(args).catch((e) => ({ code: 1, stderr: String(e?.message ?? e), stdout: "" }));
      if (oneOff) exec("sh", ["-c", TEMPLATE + 'rm -f "$dir/$1.md"', "x", oneOff], on);
      let out = {};
      try { out = JSON.parse(r.stdout || "{}"); } catch {}
      // hc 等待把首条消息交给 agent;若 CLI 显示整屏
      // 其自身(在新文件夹信任此文件夹,位于另一台 machine):hc 超时,但
      // agent 运行后,本聊天在其就绪时发送模板文字与任务本身
      // 在该屏之后保持 idle(follow()),Assistant 绝不会在缺少指令时启动。
      const late = (r.code !== 0 || !out.address) && this.slotAgent();
      if (late) out = { address: late, first_message: { sent: false } };
      if (out.address && out.first_message?.sent === false && words) this.firstSend = [words, task].filter(Boolean).join("\n\n");
      if (r.code !== 0 && !late || !out.address) {
        p.failed = (r.stderr || r.stdout || "没有启动。").trim();
        toast({ title: `The ${this.role === "coordinator" ? "Assistant" : this.role} didn't start`, body: msg ? `${p.failed} Your message is back in the box.` : p.failed, level: "error" });
 // 新聊天不显示待发行:消息放回输入框而不是消失
        if (msg) { this.pending = this.pending.filter((x) => x !== p); if (!this.box.value().trim()) this.box.set_value(msg.text); }
        this.phase = "fresh";
        cx.notify();
        return;
      }
      // 记住用户的请求:agent 的首条消息即模板文字加上该请求。
      if (msg) {
        this.firstTask = msg.text;
        fs.mkdir(`${appHome()}/data/chat-first`, { recursive: true }).then(() => fs.writeFile(this.firstFile, msg.text)).catch(() => {});
      }
      this.addr = machine && !out.address.includes("/") ? `${machine}/${out.address}` : out.address;
      this.machine = this.addr.includes("/") ? this.addr.split("/")[0] : null;
      await this.flag();
      this.phase = "finding";
      this.wasFocused = false;
      if (machine && msg?.files.length) {
        // 在另一台 machine 上:等 agent 在那边运行后即为文件。
        cx.spawn(async () => { const paths = await attach.deliver(msg.files, this.addr, this.machine).catch(() => []); if (paths.length) await personHc(["send", this.addr, paths.join("\n")]); });
      }
      cx.spawn(async (cx) => this.follow(cx));
      cx.spawn(async (cx) => this.watchAsks(cx));
      cx.notify();
      // 来自 header 的 Terminal:agent 运行后显示其 terminal(常见的 Chat → Terminal)。
      if (thenTerminal) {
        for (let i = 0; i < 40 && terminals().find((k) => k.address === this.addr)?.state !== "live"; i++) await cx.sleep(250);
        this.toTerminal();
      }
    });
  }

  // 第一条消息之前:agent 将要开始处理的内容(框内的 model 按钮),来自
  // props.settings(herdr-winapp 设置,打开其 tab 时传入),否则用 CLI 自身默认值。
  // 在那边的选择只改配置:不会运行任何东西,因此不会有损失。按 slot 保存,所以
  // reload 后保留。在另一台 machine 上,则为那边已安装的内容。
  loadChoice(cx) {
    const space = spaces().find((x) => x.id === (props()?.space ?? this.slotRec()?.space));
    if (this.choice) return;
    this.choice = { sel: null, data: null };
    cx.spawn(async (cx) => {
      try {
        const data = await choices.loadChoices(space?.machine ?? null);
        let kept = null;
        try { kept = JSON.parse(localStorage.getItem(`choice:${this.slot}`) ?? "null"); } catch {}
        const st = kept?.agent ? kept : props()?.settings;
        const sel = st?.agent && data.menus[st.agent] ? { perm: data.permDefault[st.agent], effort: null, fast: false, ...st } : { ...data.defaults };
        this.choice = { sel, data, key: this.choice.key };
      } catch { this.choice = null; }
      cx.notify();
    });
  }

  get firstFile() { return `${appHome()}/data/chat-first/${safe(this.slot ?? this.originKey)}.txt`; }

  // 本聊天启动其 agent 时用户的提问(firstFile),也是聊天
  // reload 后按 agent 地址再次打开(此处无槽位:以 agent 的标签命名,
  // #592)。仅当可能的命名发生变化时才重新读取。
  loadFirst(cx, labels) {
    const keys = firstKeys({ slot: this.slot, labels, origin: this.originKey, addr: this.addr });
    const sig = keys.join("|");
    if (!keys.length || this.firstFor === sig) return;
    this.firstFor = sig;
    cx.spawn(async (cx) => {
      for (const k of keys) {
        const text = await fs.readFile(`${appHome()}/data/chat-first/${safe(k)}.txt`, "utf8").catch(() => null);
        if (text) { this.firstTask = text; cx.notify(); return; }
      }
    });
  }

  // 空状态:该做什么,以及 assistant 在做什么。
  fresh(t) {
    const starting = this.phase === "starting";
    return v_flex().flex_1().min_h(0).items_center().justify_center().px(24).gap(6)
      .child(div().text_size(TEXT.title).font_medium().text_color(t.foreground).child(starting ? WORDS.startingAssistant : WORDS.emptyTitle))
      .child(div().max_w(380).text_center().text_size(TEXT.label).text_color(t.dim)
        .child(WORDS.emptyBody));
  }

  // // ---- 查找(Ctrl+F)----------------------------------------------------------------------------

  openFind(cx) {
    note("feature", { type: "chat-find" });
    this.finding = true;
    this.findJump = true;
    cx.timer.after(0, () => this.findBox.focus());
    cx.notify();
  }

  closeFind(cx) {
    this.finding = false;
    this.box.focus();
    cx.notify();
  }

  findQuery() {
    return this.finding ? this.findBox.value().trim() : "";
  }

  // 已加载对话中的每个匹配:[{ index(行), id, n(其中匹配数) }]。
  findMatches(rows) {
    const q = this.findQuery().toLowerCase();
    if (!q) return [];
    const out = [];
    rows.forEach((r, index) => {
      const text = (["user", "agent", "pending", "brief"].includes(r.kind) ? r.text : r.kind === "code" ? r.code : null) ?? "";
      let n = 0, at = 0;
      const low = text.toLowerCase();
      while ((at = low.indexOf(q, at)) >= 0) { n++; at += q.length; }
      if (n) out.push({ index, id: r.id, n });
    });
    return out;
  }

  // 编号 `findIdx` 的匹配项(按全部匹配计数):其所在行。
  findRow(matches) {
    let k = this.findIdx;
    for (const m of matches) { if (k < m.n) return m; k -= m.n; }
    return matches[matches.length - 1] ?? null;
  }

  findStep(d, rows, cx) {
    const matches = this.findMatches(rows);
    const total = matches.reduce((n, m) => n + m.n, 0);
    if (!total) return;
    this.findIdx = (this.findIdx + d + total) % total;
    this.findJump = true;
    cx.notify();
  }

  // 匹配词加粗,代码内除外(用于消息的 markdown)。
  findMark(text) {
    const q = this.findQuery();
    if (!q || /[*_`\[\]\\]/.test(q)) return text;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return String(text).split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => (i % 2 ? part : part.replace(re, (m) => `**${m}**`))).join("");
  }

  // 查找栏:输入框、计数、上下导航、更早的消息、关闭。
  findBar(t, rows) {
    const matches = this.findMatches(rows);
    const total = matches.reduce((n, m) => n + m.n, 0);
    const q = this.findQuery();
    const count = !q ? "" : total ? `${Math.min(this.findIdx, total - 1) + 1} of ${total}` : WORDS.noMatches;
    const icon = (id, path, fn) => div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); })
      .child(svg(path).size(14));
    const take = (fn) => (_e, cx) => { fn(cx); cx.stop_propagation(); cx.notify(); };
    return h_flex().id("chat-find").flex_none().w_full().h(40).px(12).gap(8).items_center().border_b(1).border_color(t.border).bg(t.background)
      .key_context("chat_find")
      .on_action("chat_find_close", take((cx) => this.closeFind(cx)))
      .on_action("chat_find_next", take((cx) => this.findStep(1, rows, cx)))
      .on_action("chat_find_prev", take((cx) => this.findStep(-1, rows, cx)))
      .child(svg("mods/chat/search.svg").size(14).flex_none().text_color(t.dim))
      .child(Input.new(this.findBox).flex_1().text_size(13).text_color(t.foreground))
      .child(div().flex_none().font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5).text_color(t.dim).child(count))
      .when(Boolean(this.start), (el) => el.child(h_flex().id("find-earlier").h(22).px(8).flex_none().items_center().rounded(6).cursor_pointer()
        .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.loadEarlier(cx); })
        .child(this.loadingEarlier ? "加载中…" : WORDS.searchEarlier)))
      .child(icon("find-prev", "mods/chat/chevron-up.svg", (cx) => this.findStep(-1, rows, cx)))
      .child(icon("find-next", "mods/chat/chevron-down.svg", (cx) => this.findStep(1, rows, cx)))
      .child(icon("find-x", "mods/chat/x.svg", (cx) => this.closeFind(cx)));
  }

  // // ---- 空间(#shop)-------------------------------------------------------------------------

  // agent 所在机器可达的 spaces,取自其 herdr-task reach map(tell-assistant 依据的同
  // 之后);此处尚无:只有它本机上的 space。
  async loadReach() {
    const r = await exec("sh", ["-c", mentions.REACH_FILE], { on: this.machine }).catch(() => null);
    let graph = null;
    try { graph = JSON.parse(r?.stdout || "null")?.graph ?? null; } catch {}
    const here = graph ? null : (spaces() ?? []).filter((x) => (x.machine ?? null) === (this.machine ?? null))
      .map((x) => ({ id: String(x.id).split("/").pop(), name: x.name, route: "", machine: this.machine ?? "", target: String(x.id).split("/").pop(), assistant: false }));
    this.reach = { from: graph?.core?.name ?? this.machine, spaces: graph ? mentions.reachable(graph) : here };
  }

  // 消息文字中每个 #-mention 转为普通 markdown:其名称与机器,以及 "out of
  // 不可达”(该 agent 无法连接那个 space 时)。
  mentionsIn(text) {
    if (!mentions.hasMention(text)) return text;
    const ids = this.reach ? new Set(this.reach.spaces.map((x) => x.id)) : null;
    const by = new Map((this.reach?.spaces ?? []).map((x) => [x.id, x.machine]));
    const title = (m) => this.mentionableTasks().find((x) => taskRef(x) === m.ref && (!m.folder || x.folder === m.folder))?.title;
    return mentions.plain(text, ids, (m) => by.get(m.id), title);
  }

  // 任务的 "@" 列表:先本文件夹的,再(Assistant 的)其机器上所有文件夹的。
  mentionableTasks() {
    const seen = new Set(), out = [];
    for (const x of [...(this.tasks ?? []), ...(this.spaceTasks ?? [])]) {
      const k = `${x.folder}|${taskRef(x)}`;
      if (x.ref && !seen.has(k) && !x.archived) { seen.add(k); out.push(x); }
    }
    return out;
  }

  // // ---- 任务(#4)-----------------------------------------------------------------------------

  // 本文件夹的任务,即 agent 工作处(herdr-task;远程 agent 则在其机器上)。
  // 含已归档的(list 默认不含,需 --archived):mention 仍能找到它们。
  async loadTasks() {
    // 任务层已移除
  }

 // 消息提及的任务:按 id(HAT-1,来自 herdr-task 的 `ref`)或按 形式。
  mentioned(text) {
    const t = String(text ?? "");
 // 每条消息在每次 render 都要请求:按文本缓存,直到任务列表变化。
 // 还没有列表(已结束 agent 的聊天不会加载,):仍是 Map,避免 undefined === undefined。
    if (!this.mentions || this.mentionsOf !== this.tasks) { this.mentionsOf = this.tasks; this.mentions = new Map(); }
    const known = this.mentions.get(t);
    if (known) return known;
    // core/send.js:与 web 端相同的匹配逻辑
    const found = mentionedIn(t, this.tasks);
    if (this.mentions.size > 1000) this.mentions.clear();
    this.mentions.set(t, found);
    return found;
  }

  // 消息提到的每个 task 一行 tag line,给 agent 看:是什么、在哪里。
  taskTags(text) {
    return this.mentioned(text).map((x) => taskTag(x, taskRef(x))).join("");
  }

  // // ---- 任务动态(Assistant 的对话)--------------------------------------------------------
  // 与其他 news 一样(DECISIONS 的 Task news):space 的 task 发生的每一件事都
  // 时间线上在其时刻只占一条细线(已开始、需要你、就绪、完成等),绝不
  // 随后重写。worker 的请求在其卡片上回答,位置就在 needs-you 行之下。

  // 本聊天所属 Assistant 的 space(取其 coordinator 的标签),否则 null:worker 的
  // thread 或任何其他 agent 不显示任务行。
  assistant() {
    const l = this.t?.labels ?? {};
    if (this.thread || (l["herdr.role"] !== "coordinator" && this.role !== "coordinator")) return null;
    return l["herdr.coordinator.space"] ?? l["herdr.space"] ?? null;
  }

  // 其 machine 上每个文件夹的任务(herdr-task list --all):space 的任务可位于任意
  // 文件夹,而不只是其 Assistant 运行处。
  async loadSpaceTasks() {
    // 任务层已移除
  }

  taskSig() {
    return (this.spaceTasks ?? []).map((x) => `${x.ref}:${x.status}:${x.why ?? ""}:${x.report?.text ?? ""}:${x.report?.left ?? ""}`).join("|");
  }

  // 行:{ inline: 新闻条目 id → 其所在行, extra: [{ at, row }] }。Herdr 发给
  // Assistant(其 <herdr-news> 行,log.js)播报 needs you、ready、done、failed 和 gone quiet;
  // 开始取任务的 `started`;ready 或 done 是本处新闻从未报过的(在此前
  // 会话日志,或未发送)以任务自身的 ready_at / done_at 为准。
  newsLines(items) {
    const space = this.assistant();
    const inline = new Map(), extra = [];
    if (!space) return { inline, extra };
    // 一个 space 的 tasks 会产生数百行:沿用上次 render 的结果,除非其构成数据
 // 已变化。
    const sig = [space, this.spaceTasks, items, items.length, items[items.length - 1]?.id, this.start,
      (this.wasks ?? []).map((a) => a.ref).join(","), [...this.accepting].join(",")];
    if (this.newsMemo?.sig.every((v, i) => v === sig[i])) return this.newsMemo.out;
    const tasks = new Map();
    for (const x of this.spaceTasks ?? []) if ((x.space ?? x.queue?.space) === space && x.ref && !tasks.has(x.ref)) tasks.set(x.ref, x);
    const all = [], said = new Set();
    for (const it of items) if (it.kind === "news") { said.add(`${it.ref}:${it.event}`); all.push(it); }
    // 置于该聊天已加载内容之前:回滚到(顶部)时显示。
    const first = items.find((x) => x.at)?.at ?? 0;
    for (const [ref, x] of tasks) for (const [event, at] of [["started", x.started], ["ready", x.ready_at], ["done", x.done_at]]) {
      if (!Number.isFinite(at) || said.has(`${ref}:${event}`) || (at < first && this.start !== 0)) continue;
      all.push({ id: `tn:${ref}:${event}:${at}`, at, ref, event, text: "", made: true });
    }
    all.sort((a, b) => a.at - b.at);
    const last = new Map(), lastReady = new Map();
    for (const e of all) { last.set(e.ref, e); if (e.event === "ready") lastReady.set(e.ref, e); }
    this.needsAt = new Map();
    for (const e of all) if ((e.event === "needs-you" || e.event === "failed") && Number.isFinite(e.at)) this.needsAt.set(e.ref, [...(this.needsAt.get(e.ref) ?? []), e.at]);
    const order = [], ordered = new Set();
    for (const e of all) {
      const x = tasks.get(e.ref);
      if (!ordered.has(e.ref)) { ordered.add(e.ref); order.push(e.ref); }
      const asks = (this.wasks ?? []).some((a) => a.ref === e.ref);
      // 仍在等你:文字标红,卡片就在其正下方展开。
      const live = last.get(e.ref) === e && (e.event === "needs-you" || e.event === "failed") && (x?.status === "needs" || asks);
      // 在最新 ready 行上执行 Accept,前提是 task 仍处于 Ready。
      const accept = lastReady.get(e.ref) === e && x?.status === "ready" && !asks;
      const row = { kind: "tasknews", id: e.id, ref: e.ref, task: x ?? null, taskId: x?.id ?? null, folder: x?.folder ?? null, title: x?.title ?? "",
        ...newsWords(e, x), live, asks: live && asks, accept, busy: accept && this.accepting.has(e.ref) };
      if (e.made) extra.push({ at: e.at, row }); else inline.set(e.id, row);
    }
    this.taskOrder = order;
    this.newsMemo = { sig, out: { inline, extra } };
    return { inline, extra };
  }

  // 消息行的措辞:core/chat-view.js 的 newsWords(),与 web app 的 chat 一致。

  // task chip:点击打开其 worker 在 Tasks panel 中的聊天,否则打开那里的任务列表。
  // k:已知时为任务本身(id 在不同文件夹会重复)。
  openTask(id, k = null) {
    const x = k ?? this.tasks?.find((t) => String(t.id) === String(id));
    const live = x?.live ?? [];
    const worker = (live.find((a) => a.role === "worker") ?? (live.some((a) => a.role) ? null : live[0]))?.address;
    if (worker) { this.openThread({ terminal: worker, task: taskRef(x), title: x.title }); return; }
    run("layout.select", { stack: "panel-body", child: "tasks" });
    backToTasks();
    run("layout.show", { id: "panel" });
  }

  // worker 的 thread({ terminal, task, title }):其在 Tasks panel 内的聊天(深入查看,
  // panel.js),绝不会是本聊天旁的 pane。
  openThread(req) {
    openTaskThread(req.terminal, req.task, req.title);
  }

  // 无论 pane 在哪里:先显示其 space 和 tab,再聚焦该 pane。
  revealPane(pane) {
    const p = panes().find((x) => x.pane === pane);
    if (!p) return;
    const s = spaces().find((x) => x.tabs.some((t) => t.id === p.tab));
    if (s && !s.active) run("space.select", { id: s.id });
    run("tab.select", { id: p.tab });
    run("pane.focus", { pane });
  }

  // 点击了回复的引用:被回答的那条消息滚动到位并高亮片刻
  // (亮度原生淡入淡出:只翻转目标一次,不用定时器逐帧驱动)。
  goTo(to, before, rows) {
    const i = rows.findIndex((r) => r.id === before);
    const target = [...rows.slice(0, i < 0 ? rows.length : i)].reverse().find((r) => (r.kind === "user" || r.kind === "agent") && r.text && names(r.text, String(to).slice(0, 60)));
    if (!target) return;
    this.pinned = false;
    // 跳转到折叠回复会将其展开。
    if (target.blk) this.unfolded.add(target.blk);
    this.scroll.scroll_to_item(rows.indexOf(target), "center");
    this.flash = { id: target.id, on: true };
  }

  // // ---- 离开与关闭 ---------------------------------------------------------------------

  // 回到 terminal:header 的开关(pane-chat)把 agent 的 terminal 放回
  // 本 pane 的位置。它作用于聚焦的 pane,所以先聚焦这个。
  toTerminal() {
    // thread 的 worker 没有 pane:Tasks panel 的 header 在那里切到它的 terminal。
    if (this.thread) { if (!this.ended) requestWorkerTerminal(this.addr); return; }
    const mine = this.myPane();
    if (!mine) return;
    run("pane.focus", { pane: mine });
    run("pane-chat.toggle");
  }

  // agent 已结束:它的 pane 本会随之关闭,因此这个 pane 也关闭。
  closeSelf() {
    if (this.inner) { backToTasks(); return; }
    const mine = this.myPane() ?? this.lastPane;
    if (mine) run("pane.close", { pane: mine });
  }

  // // ---- 消息操作 ----------------------------------------------------------------------

  // 列在 pane 中的左右边界,用于消息下方的操作按钮。
  edges() {
    const outer = Math.min(this.width, COLUMN + 36);
    const left = (this.width - outer) / 2 + 18;
    return { left, right: left + outer - 36 };
  }

  // 消息的 band,各部分按序排列,左边缘在 pane 内的位置:{ what, x, w,
  // hover(仅悬停时显示)、pill? }。时间占固定宽度,位置因此不会
  // 取决于其数字的绘制方式。
  barLayout(bar) {
    const { left, right } = this.edges();
    const time = clock(bar.at);
    const parts = [];
    let at = 0;
    const add = (what, w, gap, more = {}) => { at += parts.length ? gap : 0; parts.push({ what, x: at, w, ...more }); at += w; };
    // 窄 pane 中塞多个 pill:时间放最前,让行不超出列宽。
    const room = right - left, timeW = time ? (time.length > 5 ? 82 : 38) + ACT_GAP : 0;
    const need = bar.acts.length * (ACT + ACT_GAP) + ACT + (bar.pills?.length ?? 0) * (PILL + PILL_EDGE);
    // Reactions 关闭(一个 add-on):不显示笑脸;已有的 pill 仍然保留。
    const order = bandOrder(bar.side, bar.acts, { time: Boolean(time) && need + timeW <= room, react: false });
    for (const what of order) {
      if (what === "time") add("time", timeW - ACT_GAP, ACT_GAP, { hover: true, text: time });
      // pill 之间相距 PILL_GAP,与前后内容相距 PILL_EDGE。
      else if (what === "pills") (bar.pills ?? []).forEach((p, i) => add(`pill:${p.emoji}`, PILL, i ? PILL_GAP : PILL_EDGE, { pill: p }));
      else add(what, ACT, what === "react" && bar.side !== "user" ? PILL_EDGE : ACT_GAP, { hover: true });
    }
    const x0 = bar.side === "user" ? right - at : left;
    for (const p of parts) p.x += x0;
    return { x: x0, w: at, parts };
  }

  // 点击落在带状区的哪个部分(行本身不接处理器):带状区是
  // 独立一行,列表因此能准确点名;横向则按 barLayout() 的位置。时间
  // 不是按钮。
  hitBar(row) {
    const x = this.press?.x;
    if (row.kind !== "band" || x === undefined || Date.now() - (this.press?.at ?? 0) > 3000) return null;
    const p = this.barLayout(row.bar).parts.find((p) => p.what !== "time" && x >= p.x && x <= p.x + p.w);
    if (p) this.hitLeft = p.x;
    return p?.what ?? null;
  }

  act(row, what, cx) {
    if (!what) return;
    // 行:消息的 bar({ id, of, target, text, side, acts })或其 footer 行。
    if (what === "copy") this.copy(row.text, row.id, cx);
    if (what === "reply") {
      const t = row.text.replace(/\s+$/, "");
      this.quote = { text: t.length > 280 ? t.slice(0, 279).trimEnd() + "…" : t };
      this.box.focus();
      this.saveSoon(cx);
    }
    if (what === "rewind") this.rewind(row, cx);
    if (what === "fork") this.fork(cx);
    if (what === "react") { this.keepIcons = row.of; this.openReactions(row, this.hitLeft); }
    // 一个 pill:你的 reaction 的开或关。
    if (what.startsWith("pill:")) this.toggleReaction(row.of, row.target, what.slice(5), cx);
  }

  // // ---- 表情回应 ------------------------------------------------------------------------------

  // 消息的 reaction 以 pill 呈现:{ emoji, you, agent },日志中的记录加上你刚发送的。
  pills(id) {
    if (!id) return [];
    const list = [...(this.conv?.reactions?.get(id) ?? [])];
    const mine = this.myReacts.get(id);
    if (mine) for (const [emoji, on] of mine) {
      const i = list.findIndex((r) => r.by === "you" && r.emoji === emoji);
      if (on && i < 0) list.push({ emoji, by: "you" });
      if (!on && i >= 0) list.splice(i, 1);
    }
    const by = new Map();
    for (const r of list) {
      const p = by.get(r.emoji) ?? { emoji: r.emoji, you: false, agent: false };
      p[r.by === "you" ? "you" : "agent"] = true;
      by.set(r.emoji, p);
    }
    return [...by.values()];
  }

  // emoji picker(mods/chat-react),锚定在被按的按钮上:其左缘
  // 与按钮对齐,空间够则在其上方,否则在下方;保持在 pane 的窗口区域内。
  openReactions(row, anchor) {
    const W = 360, H = 420;
    const p = this.pressWin, local = this.press;
    let at = "pointer";
    if (p && local?.rx !== undefined) {
      // 以窗口像素计(pressWin 的):聊天自身的数值基于 zoom 1。
      const z = zoomOf();
      const paneX = p.x - local.rx, paneY = p.y - (local.ry ?? 0);
      const left = anchor !== undefined && anchor !== null ? anchor * z : local.rx;
      const x = Math.max(8, Math.min(paneX + left, paneX + this.width * z - W - 8));
      const rowTop = p.y - 14, rowBottom = p.y + 14;
      const y = rowTop - H - 4 >= 8 ? rowTop - H - 4 : Math.min(rowBottom + 4, paneY + (this.height ?? 800) * z - H - 8);
      at = { x, y: Math.max(8, y) };
    }
    const fr = this.frequent(18);
    openOverlay({ mod: "chat-react", kind: "popup", width: W, height: H, at,
      props: { pane: this.myPane(), target: row.of, text: row.target, height: H, width: W,
        frequent: [...fr, ...FREQUENT.filter((e) => !fr.includes(e))].slice(0, Math.max(FREQUENT.length, fr.length)),
        mine: this.pills(row.of).filter((p) => p.you).map((p) => p.emoji) } });
  }

  // 每个 emoji 的使用频率与最近使用时间(data/chat-emoji-uses.json):仿 Slack 的
  // 按新近度排序,最近十次使用各按距今时长加权。
  frequent(n) {
    const H = 3600000, now = Date.now();
    const weight = (age) => [[4 * H, 100], [24 * H, 80], [72 * H, 60], [168 * H, 40], [720 * H, 20], [2160 * H, 10]].find(([upTo]) => age <= upTo)?.[1] ?? 0;
    const score = (u) => (u.t?.length ? (u.n * u.t.reduce((s, t) => s + weight(now - t), 0)) / u.t.length : 0);
    return Object.entries(this.uses ?? {}).map(([e, u]) => [e, score(u)]).filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(([e]) => e);
  }


  useEmoji(emoji) {
    const u = this.uses[emoji] ?? { n: 0, t: [] };
    this.uses = { ...this.uses, [emoji]: { n: u.n + 1, t: [Date.now(), ...u.t].slice(0, 10) } };
    fs.mkdir(`${appHome()}/data`, { recursive: true }).then(() => fs.writeFile(`${appHome()}/data/chat-emoji-uses.json`, JSON.stringify(this.uses))).catch(() => {});
  }

  // 对消息加(或撤)reaction:给 agent 一行 tag,立即显示。
  // agent 等待用户时(菜单、提问),改为在队列中等待。
  toggleReaction(id, text, emoji, cx) {
    const on = !this.pills(id).some((p) => p.emoji === emoji && p.you);
    const mine = new Map(this.myReacts.get(id) ?? []);
    mine.set(emoji, on);
    this.myReacts.set(id, mine);
    if (on) this.useEmoji(emoji);
    const line = reactionLine(emoji, text, on);
    const st = this.status();
    if (st === "blocked" || this.asks.length) {
      this.queue.push({ id: `r${Date.now()}`, text: line, files: [], quote: null, raw: true, label: on ? `${emoji} reaction` : `${emoji} reaction removed` });
      this.saveSoon(cx);
    } else personHc(["send", this.addr, line]);
    cx.notify();
  }

  copy(text, id, cx) {
    cx.write_to_clipboard(text);
    this.copied = id;
    cx.timer.after(1500, (cx) => { if (this.copied === id) { this.copied = null; cx.notify(); } });
  }

  // CLI 自带的 rewind,尽量落到那条消息:Claude Code 的 /rewind 会列出
  // 各条 prompt,最新的在前(每按一次 Up 回退一条);Codex 的 Esc Esc 浏览
  // 自最近一次 prompt 起的记录(每按一次 Left 回退一条)。随后 terminal 显示它。
  rewind(row, cx) {
    if (this.status() === "working") { toast({ title: "The agent is working", body: "Stop it first, then rewind.", level: "info" }); return; }
    const users = (this.conv?.items ?? []).filter((x) => x.kind === "user" && !x.from && !/^\// .test(x.text ?? ""));
    const i = users.findIndex((u) => u.id === row.of);
    const back = i < 0 ? 1 : users.length - i;
    cx.spawn(async (cx) => {
      if (this.kind === "claude") {
        await personHc(["send", this.addr, "/rewind"]);
        await cx.sleep(700);
        await hc(["keys", this.addr, ...Array(back).fill("up")]);
      } else {
        await hc(["keys", this.addr, "esc", "esc"]);
        await cx.sleep(500);
        if (back > 1) await hc(["keys", this.addr, ...Array(back - 1).fill("left")]);
      }
      this.toTerminal();
    });
  }

  // 本会话的副本,在本 space 的新 tab 中继续(CLI 自带的 fork)。
  fork(cx) {
    const session = agent.sessionOf(this.kind, this.path);
    if (!session) { toast({ title: "无法分叉", body: "此对话没有保存的会话。", level: "info" }); return; }
    const tab = panes().find((p) => p.pane === this.myPane())?.tab;
    const space = spaces().find((s) => s.tabs.some((x) => x.id === tab));
    const folder = this.t?.foreground?.cwd ?? this.t?.cwd ?? undefined;
    run("tab.new", { space: space?.id, folder, argv: agent.forkArgv(this.kind, this.argv, session) });
  }

  // // ---- 听写 ----------------------------------------------------------------------------

  // Ctrl+Shift+D、麦克风按钮和 Done:开始录音,或停止并转写。

  // 取消:丢弃录音,输入框保持原状。

  // 录音期间,输入框的底行是录音(共享的实时行):红色 X
  // 丢弃它,麦克风音量、“Recording” 与计时,Send 位置显示 Done。Done 之后
  // 麦克风与波形立即停止:显示安静的 spinner 与 “Writing…”,直至文字落定(同时说明
  // 超过 DICT_SLOW 后),红色 X 仍可放弃。已输入的文本保留在上方。

  // // ---- 语音通话 ---------------------------------------------------------------------------


  // 语音通话的屏幕工具滚动本聊天(call-screen.js):每次几行,或滚到头尾。
  scrollBy(direction) {
    const n = this.rows().length;
    if (!n || !this.range) return null;
    if (direction === "bottom") { this.pinned = true; this.scroll.scroll_to_bottom(); return "Scrolled the call's chat to the newest"; }
    if (direction === "top") { this.pinned = false; this.scroll.scroll_to_item(0, "top"); return "Scrolled the call's chat to the oldest loaded (older ones load from there)"; }
    const span = Math.max(1, this.range.end - this.range.start);
    const to = direction === "up" ? Math.max(0, this.range.start - span) : Math.min(n - 1, this.range.end + span - 1);
    this.pinned = direction === "down" && to >= n - 1;
    this.scroll.scroll_to_item(to, direction === "up" ? "top" : "bottom");
    return `Scrolled the call's chat ${direction}`;
  }

  scrollWords() {
    const n = this.rows().length;
    if (!n || !this.range) return "";
    return `messages ${this.range.start + 1} to ${Math.min(n, this.range.end)} of ${n} loaded${this.range.end < n ? " (more below)" : ""}${this.range.start > 0 ? " (more above)" : ""}`;
  }


  // read_chat 告诉 voice agent 的内容:状态与最近消息。



  // 侧栏通话卡片的数据(mods/spaces-chat voiceRow):shared "chat.calls" =
  // // { <对话窗格>: { phase, who, muted, started, beat, name, tab, said } }。

  // 通话结束或未能开始的原因:显示在窗口顶部(mods/chat-call),关闭前一直在。
  callError(text) {
    setShared("chat.callError", { text, pane: this.myPane() ?? this.lastPane ?? null, at: Date.now() });
  }

  // // ---- 模型按钮与选择器 -----------------------------------------------------------------

  current() {
    if (!this.kind) return null;
    // 续接会话的日志会标注它此前运行的模型:直到本进程接管为止
    // 写入,其参数与设置说明它运行于什么。
    let meta = this.conv?.meta ?? {};
    const born = this.t?.created_ms;
    if (born && meta.at && meta.at < born) meta = { used: meta.used, window: meta.window };
    return agent.current(this.kind, this.argv, meta, this.dflt);
  }

  // model picker(mods/chat-models),以 popover 形式出现在 model 按钮正上方:聊天
  // 算出其显示的全部内容(两个 agent 的模型、effort、权限模式)并传入
  // 作为 props 传入。`at`:按钮在窗口中被按下的位置。
  openPicker(at, cx, name = null) {
    const c = this.current();
    if (!c || this.picking) return;
    this.picking = true;
    cx.spawn(async (cx) => {
      try {
        const stale = !this.pickCache || Date.now() - this.pickCache.at > 60000 || this.pickCache.machine !== this.machine;
        if (stale) {
          const [claude, codex, known] = await Promise.all([agent.defaults("claude", this.machine), agent.defaults("codex", this.machine),
            knownAgents({ on: this.machine }).catch(() => [])]);
          const prog = (key) => known.find((a) => a.key === key || (a.run ?? [])[0] === key);
          this.pickCache = { at: Date.now(), machine: this.machine, dflts: { claude, codex },
            icons: Object.fromEntries(["claude", "codex"].map((k) => [k, { icon: prog(k)?.icon ?? null, tint: Boolean(prog(k)?.tint) }])),
            installed: Object.fromEntries(["claude", "codex"].map((k) => [k, prog(k) ? prog(k).installed !== false : true])) };
        }
        const { dflts, icons, installed } = this.pickCache;
        if (this.kind) dflts[this.kind] = this.dflt ?? dflts[this.kind];
        // 其 machine 当前不可达:一旦选定更改,菜单即提示(重启会等待)
        const offline = this.machine && !online(this.machine) ? this.machine : null;
        const currentRow = agent.rowFor(c.agent, c);
        // 仅已安装的 agent(且始终含正在运行的)。
        const menus = Object.fromEntries(["claude", "codex"].filter((k) => k === c.agent || installed[k])
          .map((k) => [k, agent.menuFor(k, dflts[k], k === c.agent ? currentRow : null)]));
        // 菜单的最大高度(chat-models 的尺寸):含 border 和 padding,另一台 machine 的
        // 离线行、agent 标签、搜索、列表(超过 8 行可滚动)、分隔线、Reasoning 标题
        // 与档位、Fast、Permissions、新会话的两行、Restart(两行)。
        const W = 340, H = 2 + 10 + 20 + 34 + 36 + 8 * 31 + 9 + 26 + 34 + 31 + 31 + 40 + 50;
        openOverlay({ mod: "chat-models", kind: "popup", frame: "none", width: W, height: H,
          at: at ? { x: Math.max(8, at.x - W + 90), y: Math.max(8, at.y - H - 10) } : "pointer",
          props: { pane: this.pickKey(), offline, width: W, height: H, select: name ? findModel(menus, name) : null,
            current: { agent: c.agent, model: currentRow, effort: c.effort ?? null, fast: c.fast, perm: c.perm ?? null },
            menus, icons, permDefault: { claude: dflts.claude?.mode ?? "manual", codex: "auto" } } });
      } finally {
        this.picking = false;
        cx.notify();
      }
    });
  }

  // 在输入框输入 /model:model button 上方的 picker(首条消息之前,
  // 用于选择启动项的菜单),并选定具名模型。无选择器时(没有
  // pane、尚无 agent)时只说明为何什么都没发出。
  modelCommand(name, cx) {
    const b = this.composerAt;
    if (this.phase === "fresh") {
      if (!this.choice?.sel || !this.choice?.data) return;
      if (b) this.choice.at = { x: b.x + b.width - 120, y: b.y + b.height - 32, width: 80, height: 28 };
      choices.openMenu(this.choice, name ? findModel(this.choice.data.menus, name) : null);
      return;
    }
    if (!this.pickKey() || !this.current()) {
      this.note = { id: `note-${Date.now()}`, text: "未发送:/model 会改变之后每个 agent 的模型。" };
      cx.timer.after(6000, (cx) => { this.note = null; cx.notify(); });
      return;
    }
    this.openPicker(b ? { x: b.x + b.width - 90, y: b.y + b.height - 18 } : this.pickAt, cx, name);
  }

  // picker 的 Restart 作用于谁(chat-models 的 props.pane,经 shared "chat.restartreq" 送回):
  // 本聊天的 pane;或任务聊天(任务面板,无独立 pane)中的 worker。
  pickKey() {
    return this.thread ? (this.addr ? `thread:${this.addr}` : null) : this.myPane();
  }

  // 按选择器所选重启 agent;此聊天跟随新 agent。
  applyPick(pick, cx) {
    if (this.thread) return this.switchTask(pick, cx);
    const mine = this.myPane();
    if (this.restarting || !mine || !this.t) return;
    this.restarting = true;
    cx.spawn(async (cx) => {
      try {
        const t = JSON.parse((await hc(["get", this.addr, "--json"])).stdout);
        const built = agent.argvFor(pick, { agent: this.kind, argv: t.foreground?.argv ?? [], session: agent.sessionOf(this.kind, this.path) });
        this.swapping = true;
        const next = await agent.restart(t, built, mine);
        this.follow_to(next);
        this.note = { id: `note-${Date.now()}`, text: built.resume ? "已重启。对话继续。" : `Started ${agent.NAMES[pick.agent]} with a handoff.` };
        cx.timer.after(6000, (cx) => { this.note = null; cx.notify(); });
      } catch (e) {
        toast({ title: "agent 没有重启", body: plainError(e), level: "error" });
      }
      this.swapping = false;
      this.restarting = false;
      cx.notify();
    });
  }

  // task 的聊天:herdr-task switch 按所选重新启动其 worker,并处于同一 session
  // CLI 不变时直接继续(否则带交接),并结束旧会话。只有 herdr-task
  // 启动它,因此它不会获得 pane、tab 或 herdr.chat(parked 清理会终止它);
  // 任务面板的视图随后跟随新 worker,如同 Resume 之后。
  switchTask(pick, cx) {
    // 任务层已移除
  }

  // 按钮按 tasks panel 的样式绘制:primary 是该视图唯一的主操作。
  // 已完成或已停止任务的 Resume:herdr-task resume 在其会话上重新启动 agent
  // (已消失时进行 handoff);Tasks panel 的视图随后跟随新 agent。
  resumeTask(cx) {
    // 任务层已移除
  }

  button(id, label, icon, kind, t, fn) {
    const primary = kind === "primary";
    return h_flex().id(id).h(28).flex_none().gap(6).items_center().rounded(7).cursor_pointer().text_size(12.5).font_medium()
      .pl(icon ? 7 : 10).pr(10)
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.88)))
      .when(kind === "secondary", (el) => el.border_1().border_color(t.input).bg(t.background).text_color(t.foreground).hover((s) => s.bg(t.hover)))
      .when(kind === "ghost", (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); })
      .when(Boolean(icon), (el) => el.child(svg(icon).size(14).flex_none()))
      .child(label);
  }

  // composer 工具栏的 26 px 图标按钮(ghost 样式,或 `on` 时处于激活态)。
  iconButton(id, icon, t, on, fn) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(7).cursor_pointer()
      .when(on, (el) => el.bg(t.blocked + "22").text_color(t.blocked))
      .when(!on, (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); })
      .child(svg(icon).size(14));
  }

  // 在本轮 render 的行(及测量出的高度)就位后,让最新一行保持在视野内。
  follow_bottom(rows) {
    if (this.reanchor) {
      this.reanchor = false;
      const i = this.anchor && Date.now() < this.anchor.until ? rows.findIndex((r) => r.id === this.anchor.id) : -1;
      if (i >= 0) this.scroll.scroll_to_item(i, "top");
    }
    if (!this.stick) return;
    this.stick = false;
    if (this.pinned) this.scroll.scroll_to_bottom();
  }

  // 以全屏消息代替会话:查找中、未找到、已结束。
  notice(t, title, body, actions = []) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().px(24).gap(6)
      .child(svg("mods/workspace-chrome/terminal.svg").size(18).flex_none().text_color(t.dim))
      .child(div().pt(4).font_medium().text_color(t.foreground).child(title))
      .when(Boolean(body), (el) => el.child(div().max_w(360).text_center().text_size(12.5).text_color(t.muted).child(body)))
      .when(actions.length > 0, (el) => el.child(h_flex().pt(8).gap(6).children(actions)));
  }

  // // ---- 对话的各行 ----------------------------------------------------------------

  rows() {
    const out = [];
    // 自 `from` 起的各行构成一条消息的块(spaced())。
    const block = (from, blk) => { for (let k = from; k < out.length; k++) out[k] = { ...out[k], blk }; };
    if (this.start === 0) out.push({ kind: "top", id: "top" });
    else if (this.start) out.push({ kind: "loading", id: "loading" });
    const items = this.conv?.items ?? [];
    const working = this.status() === "working";
    const arts = this.resolveArts(items);
    // space 各任务的新闻行(newsLines()):Herdr 的就地显示,其余各自排在
    // 其时刻之后最先说出的内容。
    const news = this.newsLines(items);
    this.loadAskEnds();
    // 已应答或已消失的启动屏(screens.js):本 agent 的,以及某 Assistant 的 worker 的。
    const screenEnds = [[this.addr, null], ...this.workerTasks()].flatMap(([addr, x]) => (addr ? cardsOf(addr) : [])
      .filter((c) => c.state !== "open").map((c) => ({ at: x?.ref ? this.afterNews(x.ref, c.opened) : c.opened,
        row: { kind: "askend", id: `se:${c.id}`, text: `${x?.ref ? `${x.ref} · ` : ""}${c.cli}'s start screen · ${c.how}` } })));
    // 等待用户处理的卡片,按其发生时刻排在 timeline 中(DECISIONS 的 Chat):这个
    // 用 agent 自己的提问取代其 "Asked you" 行,其余按时间排。
    const cards = this.timelineCards();
    const ownQ = cards.find((c) => c.question && c.owner === this.cards);
    let qAt = -1;
    if (ownQ) for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "ask" && !items[i].closed) { qAt = i; break; }
    const tasks = [...news.extra, ...this.askEnds.map((e) => ({ at: e.at, row: { kind: "askend", id: `ae:${e.id}`, text: `${e.title} · ${e.how}` } })), ...screenEnds,
      ...cards.filter((c) => !(c === ownQ && qAt >= 0)).map((c) => ({ at: c.at, card: c }))]
      .sort((a, b) => a.at - b.at);
    // 卡片由一段 strip 组成,每条占一个列表行(strips.js),合并为一个 block 呈现。
    const putCard = (c) => c.strips.forEach((s, j) => out.push({ kind: "cardstrip", id: `cs:${c.id}:${s.key}`, s, blk: c.id, first: j === 0, last: j === c.strips.length - 1,
      sig: strips.sig(s), owner: c.owner, ask: c.ask }));
    const put = (e) => { if (e.card) putCard(e.card); else out.push(e.row); };
    let ti = 0;
    // 新的一天开始处的日期行(Today、Yesterday、星期、日期),首条消息也一样。
    const days = new Set();
    const dated = (at) => {
      if (!(at > 1e12)) return;
      const d = dayOf(at);
      if (!days.has(d) && d > Math.max(-1, ...days)) { days.add(d); out.push({ kind: "day", id: `day:${d}`, text: dayLabel(at) }); }
    };
    // 会话的第一条消息:第一条用户消息(从中读出的新闻排在它之前,#589)。
    const first = firstUser(items);
    for (let i = 0; i < items.length; i++) {
      let x = items[i];
      while (ti < tasks.length && x.at && tasks[ti].at < x.at) { dated(tasks[ti].at); put(tasks[ti++]); }
      if (i === qAt) { putCard(ownQ); continue; }
      if (x.kind === "news") { const r = news.inline.get(x.id); if (r) { dated(x.at); out.push(r); } continue; }
      // Autopilot 唤醒:只一条 quiet line,绝不显示其内容(core/chat-log.js 的 pilotLine)。
      if (x.kind === "pilot") { dated(x.at); out.push({ kind: "pilot", id: x.id, text: pilotLine(x) }); continue; }
      if (x.kind !== "mark") dated(x.at);
 // 该 agent 发给另一 agent 的消息:"Assistant → ",按其他 agent 消息的样式绘制。
      if (x.kind === "sent") {
        if (x.text) out.push({ kind: "brief", id: x.id, label: `Message to ${sentTo(x, (a) => this.sender(a))}`, text: unsigned(x.text), at: x.at,
          who: selfName({ assistant: this.role === "coordinator" || assistant(this.t), task: this.taskRef, kind: this.kind }), to: sentTo(x, (a) => this.sender(a)) });
        continue;
      }
      if (x.kind === "artifact") {
        // 已发布的 artifact:其卡片(显示最近一次发布;更早的只列一行),或
        // 注册表尚未列入时显示一条安静提示。
        const r = arts.get(x.id);
        // 其最新卡片显示关键图片与开头几行(peekOf:本机 artifacts)
        if (r) out.push({ kind: "artifact", id: x.id, art: r.id, title: r.title, text: r.title, version: r.version, v: r.v, line: !r.latest, ...(r.latest ? { peek: this.peekOf(r.id, r.version) } : {}) });
        else if (Date.now() - (x.at ?? 0) < 180000) out.push({ kind: "artifact", id: x.id, pending: true, text: "" });
        continue;
      }
      // 本聊天以模板启动 agent,并把用户的话作为其任务:
      // 模板部分显示为安静行,用户的话单独成一条消息。
      const ft = this.firstTask?.trim();
      if (i === first && this.start === 0 && x.kind === "user" && ft && this.t?.template && String(x.text ?? "").trim().endsWith(ft)) {
        const body = String(x.text).trim().slice(0, -ft.length).trim();
        if (body) out.push({ kind: "brief", id: `${x.id}:b`, label: "新会话", text: body });
        x = { ...x, text: ft };
      }
      if (x.kind === "user" && !(i === first && ft && x.text === ft) && this.brief(x, i, first)) {
        // 非用户手打:启动 brief 或另一个 agent 的消息,以 quiet row 呈现。
        // 全新启动的交接信息完整写在 label 里。
        const restart = /^<restart>/.test(x.text ?? "");
 // 另一个 agent 的消息(who 为其发送者)按普通消息绘制。
        out.push({ kind: "brief", id: x.id, label: this.brief(x, i, first), text: restart ? x.text.replace(/<\/?restart>/g, "") : x.from ? unsigned(x.text) : x.text, bare: restart, ...(x.from ? { who: fromName(x, (f, t) => this.sender(f, t), this.names()), at: x.at } : {}) });
        continue;
      }
      if (x.kind === "user") {
        const from = out.length;
        if (x.replyTo) out.push({ kind: "replyref", id: `rr:${x.id}`, to: x.replyTo, of: x.id, side: "user" });
        // Rewind 定位到 prompt;/command 不算。
        out.push(x);
        const chips = this.mentioned(x.text);
        if (chips.length) out.push({ kind: "chips", id: `tc:${x.id}`, tasks: chips.map((t) => ({ id: t.id, ref: taskRef(t), title: t.title })) });
        if (x.paths?.length) out.push({ kind: "imgs", id: `i:${x.id}`, paths: x.paths });
        // 其操作位于其下方的 band 行(上一行也绘制它们:band())。
        if (x.text) {
          const bar = { id: `b:${x.id}`, of: x.id, target: x.text, text: x.text, side: "user", at: x.at, pills: this.pills(x.id),
            acts: bandActs("user", x.text, { from: x.from }) };
          out[out.length - 1] = { ...out[out.length - 1], bar };
          out.push({ kind: "band", id: `ab:${x.id}`, bar });
        }
        block(from, x.id);
        continue;
      }
      if (x.kind === "agent") {
        // 它在回复中提到的图片与视频(core/chat-view.js mediaIn,同 web 端聊天):
        // 文字下方的图片与用户的一致,每个视频显示为一行、点开可看(窗口无法播放视频)。
        const md = mediaIn(x.text, { cwd: this.t?.foreground?.cwd ?? this.t?.cwd ?? null, home: this.machine ? null : home() });
        const ps = md.text || !md.media.length ? parts(md.text || x.text) : [];
        const first = out.length;
        // 长回复:先显示前几行(行尾在截断处切断),然后是 Show more。
        const fold = ps.length ? this.foldOf(x, ps) : null;
        const clip = (n) => (fold && !fold.open ? fold.clips.get(n) : undefined);
        if (ps.length === 1 && ps[0].type === "md") out.push(clip(0) ? { ...x, clip: clip(0) } : x);
        else ps.forEach((p, n) => {
          if (fold && !fold.open && n > fold.last) return;
          if (p.type === "md") out.push({ kind: "agent", id: `${x.id}:${n}`, text: p.text, clip: clip(n) });
          else {
            out.push({ kind: "codehead", id: `${x.id}:h${n}`, lang: p.lang, code: p.code });
            out.push({ kind: "code", id: `${x.id}:c${n}`, lang: p.lang, code: p.code, clip: clip(n) });
          }
        });
        if (fold) out.push({ kind: "fold", id: `fold:${x.id}`, of: x.id, open: fold.open });
        const pics = md.media.filter((m) => m.kind === "image").map((m) => m.path);
        // (其他机器的图片不在本地无法绘制:用一行说明数量;用户本人的图片 chat 无法显示)
        if (pics.length && !this.machine) out.push({ kind: "imgs", id: `i:${x.id}`, paths: pics, left: true });
        else if (pics.length) out.push({ kind: "video", id: `i:${x.id}`, path: null, text: imagesLine(pics.length), pics: true });
        md.media.filter((m) => m.kind === "video").forEach((m, n) => out.push({ kind: "video", id: `v:${x.id}:${n}`, path: m.path, text: m.alt || m.name.replace(/\.[^.]+$/, "") }));
        // agent 的每条消息都有自己的 actions 和 reactions,工作中也不例外;
        // 只等待它可能仍在写的那个(工作中最新的)。操作
        // 其最后一行之下。
        if (!(working && i === items.length - 1) && out.length > first) {
          const bar = { id: `b:${x.id}`, of: x.id, target: x.text, text: x.text, side: "agent", at: x.at, pills: this.pills(x.id),
            acts: bandActs("agent", x.text, { fork: Boolean(this.kind) }) };
          out[out.length - 1] = { ...out[out.length - 1], bar };
          out.push({ kind: "band", id: `ab:${x.id}`, bar });
        }
        block(first, x.id);
      } else if (x.kind !== "mark") out.push(x);
    }
    while (ti < tasks.length) { dated(tasks[ti].at); put(tasks[ti++]); }
    // 回答卡片的文字,立即显示,直到日志在其对应内容之后记录下它们
    // 提问(log.js 的 answers()):它们是最新内容,因此排在最后。
    // 它工作期间输入的内容(此处、web 端或其终端)会排队在其 CLI 的
    // 队列,到下一步才接收:立即以安静的 Queued 显示。
    const st = this.status();
    const queue = st === "working" || st === "blocked" ? this.conv?.queued?.() ?? [] : [];
    const inQueue = new Set(queue.map((q) => norm(q.text)));
    if (this.replied.length || this.pending.length || queue.length) dated(Date.now());
    for (const r of this.replied) out.push({ kind: "user", id: `rp:${r.id}`, text: r.text });
    for (const p of this.pending) {
      const from = out.length;
      if (p.replyTo) out.push({ kind: "replyref", id: `rr:${p.id}`, to: p.replyTo, of: p.id, side: "user" });
      const queued = !p.waiting && p.delivered && inQueue.has(norm(p.text));
      out.push({ kind: "pending", id: p.id, text: p.text, files: p.files, failed: p.failed, late: p.late, waiting: p.waiting, delivered: p.delivered });
      if (p.paths?.length) out.push({ kind: "imgs", id: `i:${p.id}`, paths: p.paths, faded: !p.delivered });
      if (queued) out.push(this.queuedLine(p.id));
      block(from, p.id);
    }
    for (const q of queue) {
      if (this.pending.some((p) => norm(p.text) === norm(q.text))) continue;
      const from = out.length;
      out.push({ kind: "pending", id: `q:${q.id}`, text: q.text, files: q.images ? [imagesLine(q.images)] : [], delivered: true });
      out.push(this.queuedLine(`q:${q.id}`));
      block(from, `q:${q.id}`);
    }
    if (this.note) out.push({ kind: "note", id: this.note.id, text: this.note.text });
    if (out.length) out.push({ kind: "end", id: "end" });
    return this.spaced(out);
  }

  // 长回复的折叠方式,短回复(或包含 Find 搜索内容)时为 null:{ open,
  // clips:part → 其文字显示的 px,last:最后显示的部分 }。各部分的高度
  // 由其文字估算。
  foldOf(x, ps) {
    const q = this.findQuery().toLowerCase();
    if (q && String(x.text).toLowerCase().includes(q)) return null;
    const w = Math.max(240, Math.floor(Math.min(this.width, COLUMN) * 0.8)) - 24;
    const est = ps.map((p) => (p.type === "md" ? wrapLines(p.text, w) * LINE_H : 34 + 16 + p.code.split("\n").length * 19));
    if (est.reduce((a, b) => a + b, 0) <= FOLD_TALL * LINE_H) return null;
    if (this.unfolded.has(x.id)) return { open: true, clips: new Map(), last: ps.length - 1 };
    const clips = new Map();
    let left = FOLD * LINE_H, last = ps.length - 1;
    for (let n = 0; n < ps.length; n++) {
      if (est[n] < left && n < ps.length - 1) { left -= est[n]; continue; }
      clips.set(n, Math.max(3 * LINE_H, ps[n].type === "md" ? left : left - 34));
      last = n;
      break;
    }
    return { open: false, clips, last };
  }

  // Show more / Show less。展开时回复自原位置向下撑开,且列表
  // 不再跟随最新内容,正在读取的保持不动;关闭从远处读开的
  // 向下则把其开头带回视野。
  toggleFold(row, rows) {
    this.pinned = false;
    if (!this.unfolded.has(row.of)) { this.unfolded.add(row.of); return; }
    this.unfolded.delete(row.of);
    const i = rows.findIndex((r) => r.blk === row.of && r.kind !== "replyref");
    if (i >= 0 && i <= (this.range?.start ?? 0)) this.scroll.scroll_to_item(i, "top");
  }

  // 统一的节奏(DECISIONS 的 Chat > Spacing)。同一块内的行保持原样;在
  // 块边界处行会去掉外侧留白(top0 / bot0),块与块之间留一个间隔
  // 行,因此每块之间相隔 GAP:带条带的消息、一段安静行
  // (tools、"Message from …"、artifact 行)紧挨在一起时合并为一张卡片。band 总是
  // ACT_ROW:BAND_IN 的空隙,底部是操作行,可显示或不显示。
  spaced(rows) {
    const quiet = (r) => r.kind === "tools" || r.kind === "brief" || r.kind === "askend" || r.kind === "pilot" || r.kind === "tasknews" || (r.kind === "artifact" && (r.line || r.pending));
    const of = (r) => r.blk ?? (quiet(r) ? "quiet" : r.id);
    // 行的外部留白消失后,其文字距边缘的距离(回复行的
    // 小字号文本位于 18 px 行内;它只会出现在块首)。
    const inset = (r, edge) => (quiet(r) ? QUIET_IN[edge] : r.kind === "replyref" ? 5 : 0);
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      let r = rows[i];
      const prev = rows[i - 1], next = rows[i + 1];
      const top0 = !prev || of(prev) !== of(r), last = !next || of(next) !== of(r);
      // 消息的最后一行紧贴其 band。
      const bot0 = last || next?.kind === "band";
      if (r.kind === "band") {
        r.bar.box = { top: BAND_IN, h: ACT };
        out.push({ ...r, h: ACT_ROW });
      } else if (top0 || bot0) out.push({ ...r, top0, bot0 });
      else out.push(r);
      if (last && next) {
        const h = Math.max(0, GAP - (r.kind === "band" ? 0 : inset(r, "bottom")) - inset(next, "top"));
        out.push({ kind: "gap", id: `g:${r.id}`, h });
      }
    }
    return out;
  }

  // 经 hc 发送消息的一方(<hc from="t7 herd-12-fix-login">):人们所知的其角色或任务
 // 可知的名称(“Reviewer”“”“Assistant on vm-ssa”),绝非其 terminal 地址。
  // artifact 的表单给出其标题;用户自己的行(保留的密钥)显示为 "You"。发送方
  // terminal 之外(from="<machine>/ppid:123")或已消失的,按其签署的名称显示
 // 消息加注(text:"From …"),否则显示 "Another agent"。
  sender(from, text = null) {
    // core/chat-view.js:web 端聊天以同样方式称呼发送方。
    return senderName(from, text, { find: (a) => terminals().find((x) => x.address === a), machine:this.machine, taskOf: (a) => this.workerTasks().get(a)?.ref ?? null, here: coreName(), machineName: this.names().machineName });
  }

  // 另一个 Assistant 的 machine 的命名(core/chat-view.js 的 fromName):用户为其起的名字,与 sidebar 一致。
  names() {
    return { machineName: (m) => shared("spaces-chat")?.machines?.[m]?.name || null, here: this.machine ?? coreName() };
  }

  // 卡片显示的是谁的提问:CLI 的简称("Claude asks")。
  cli() {
    return this.kind === "codex" ? "Codex" : "Claude";
  }

  // 空输入框的文案:写给谁。
  placeholder() {
    if (this.role === "coordinator" || assistant(this.t)) return "Message the Assistant";
    if (this.thread && this.taskRef) return `Message ${this.taskRef}`;
    return `Message ${agent.NAMES[this.kind] ?? "agent"}`;
  }

  // 非用户手打的 user message,转为文字用于其 quiet row,否则为 null:该 session 的
  // 首条消息,当 agent 由模板启动(coordinator)、作为交接,或
  // 给任务的(herdr-task);以及另一 agent 用 hc 发来的任意消息。
  brief(x, i, first = 0) {
    // core/chat-view.js:web 端聊天用同样的方式标注。first:会话
    // 第一条消息是什么(firstUser())。
    return briefLabel(x, i, { first, start: this.start, template: this.t?.template ?? null, task: Boolean(this.t?.labels?.["herdr.task"]), sender: (f, t) => this.sender(f, t), ...this.names() });
  }

  // 行高的决定因素:按 key 与宽度各测一次。
  key(x) {
    const q = this.findQuery();
    const found = q && String(x.text ?? x.code ?? "").toLowerCase().includes(q.toLowerCase()) ? `|f:${q}` : "";
    const open = (x.kind === "tools" || x.kind === "brief") && this.opened.has(x.id);
    const shown = open && x.steps ? x.steps.filter((s) => this.results.get(s.id) != null).length : 0;
    return `${x.id}|${x.kind}${x.closed ? `.${x.closed}` : ""}|${open ? `o${x.steps?.length ?? 1}.${shown}` : ""}|${x.text?.length ?? x.code?.length ?? 0}|${x.from ? 1 : 0}${x.failed ? 1 : 0}${x.late ? 1 : 0}${x.waiting ? 1 : 0}${x.images ? 1 : 0}${x.files?.length ?? 0}|${x.paths?.length ?? 0}${x.paths?.every((p) => this.views[p]) ? "v" : ""}|${(x.pills ?? []).map((p) => p.emoji + (p.you ? 1 : 0) + (p.agent ? 1 : 0)).join("")}|${x.bar ? "b" : ""}${x.kind === "artifact" ? `|a${x.version ?? ""}${x.line ? "l" : ""}${x.pending ? "p" : ""}${x.peek ? `k${x.peek.paths.filter((p) => this.views[p]).length}.${x.peek.text.length}` : ""}` : ""}${x.kind === "tasknews" ? `|${x.accept ? "a" : ""}` : ""}${x.kind === "cardstrip" ? `|cs${x.sig}${x.first ? "F" : ""}${x.last ? "L" : ""}` : ""}|${x.clip ? `c${x.clip}` : ""}${x.open ? "o" : ""}${x.kind === "day" ? x.text : ""}|${x.top0 ? "T" : ""}${x.bot0 ? "B" : ""}${x.h ?? ""}${found}`;
  }

  // 行在测量前的高度:bands 与间距的高度由 spaced() 决定。
  guess(x) {
    return x.kind === "band" || x.kind === "gap" ? x.h : this.guessBare(x);
  }

  guessBare(x) {
    const w = Math.min(this.width, COLUMN) - 36;
    const lines = (text, width) => String(text ?? "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 7) / Math.max(120, width))), 0);
    switch (x.kind) {
      case "end": return 10;
      case "top": case "loading": case "note": return 36;
      case "brief": return this.opened.has(x.id) ? (x.who ? 46 + lines(x.text, w - 50) * 20 : 32 + lines(x.text, w) * 19) : 20;
      case "replyref": return 22;
      case "chips": return 30;
      case "imgs": return this.fitThumbs(x.paths).h + 8;
      case "video": return 24;
      case "codehead": return 34;
      case "code": return 16 + (x.clip ?? String(x.code).split("\n").length * 19);
      case "fold": case "queued": return 26;
      case "day": return 18;
      case "user": case "pending": return 30 + lines(x.text, w * 0.8 - 24) * 20 + (x.from ? 17 : 0) + ((x.images || x.files?.length) ? 20 : 0);
      case "agent": return 30 + (x.clip ?? lines(x.text, w * 0.8 - 24) * 21);
      case "tools": return this.opened.has(x.id) ? 26 + x.steps.length * 19 : 20;
      case "artifact": return x.pending || x.line ? 20 : 62 + (x.peek?.paths?.some((p) => this.views[p]) ? fitThumbs(x.peek.paths.filter((p) => this.views[p]).map((p) => this.views[p]), PEEK_W - 22).h + 8 : 0) + (x.peek?.text ? 8 + Math.ceil((x.peek.text.length * 7) / (PEEK_W - 22)) * 18 : 0);
      case "tasknews": return x.accept ? 26 : 20;
      case "cardstrip": {
        const s = x.s, edge = (x.first ? 10 : s.gap ?? 8) + (x.last ? 10 : 0);
        const h = s.kind === "title" || s.kind === "text" ? 18 * lines(s.text, w)
          : s.kind === "detail" ? 12 + 16 * Math.min(s.clip ? 11 : Infinity, s.lines?.length ?? 1)
          : { head: 18, controls: 24, option: 32 + (s.desc ? 16 : 0), review: 31, input: 32 }[s.kind] ?? 24;
        return edge + h;
      }
      default: return 60;
    }
  }

  // 对话中的一行。行在列表的 layout 内绘制:这里不挂 handler,
  // 点击经列表的 on_item_click 传入。消息的末行把其操作放在
  // 以及其下方的带状区,画在整行之上的一层里,指针悬停该行时显示:
  // 该行自身的 hover,因此始终对应指针下的消息(列表随
  // 指针移动而更新,hover 因此跟随指针),且其空间始终保留,布局不动。
  row(x, t, pre = "") {
    const keep = this.keepIcons === x.bar?.of;
    // 带状行:reaction pill 始终显示,其余部分在指针悬停时显示。
    const box = x.bar?.box ?? { top: 0, h: ACT_ROW };
    if (x.kind === "band") return div().relative().w_full().h(x.h)
      .child(this.bar(x.bar, t, x.h - box.top - box.h, false))
      .child(div().absolute().inset_0().opacity(keep ? 1 : 0).hover((s) => s.opacity(1)).child(this.bar(x.bar, t, x.h - box.top - box.h, true)));
    const el = this.rowBare(x, t, pre);
    if (!x.bar) return el;
    // 消息的末行:同样的操作绘制在消息正下方、带状行的位置,
    // 指针悬于消息上时(其行不被裁剪:见列表)。
    return div().relative().w_full().child(el)
      .child(div().absolute().inset_0().opacity(keep ? 1 : 0).hover((s) => s.opacity(1)).child(this.bar(x.bar, t, -box.top - box.h, true)));
  }

  // band 各部分按 barLayout() 的位置:悬停才出现的(时间、图标、笑脸)或
  // pills,各自独立图层绘制,其余淡入淡出时 pills 保持不动。
  bar(bar, t, bottom, hover) {
    const done = this.copied === bar.id;
    const icon = (a) => div().size(ACT).flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(done && a === "copy" ? t.foreground : t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .child(svg(`mods/chat/${done && a === "copy" ? "check" : ICONS[a]}.svg`).size(14));
    const pill = (p) => h_flex().w(PILL).h(PILL_H).gap(4).items_center().justify_center().rounded(PILL_H / 2).border_1().cursor_pointer()
      .when(p.you, (el) => el.bg(t.accent + "26").border_color(t.accent))
      .when(!p.you, (el) => el.border_color(t.border).hover((s) => s.bg(t.hover)))
      .child(div().text_size(13).child(p.emoji))
      .child(div().text_size(11.5).font_medium().text_color(p.you ? t.foreground : t.muted).child(String((p.you ? 1 : 0) + (p.agent ? 1 : 0))));
    const { parts } = this.barLayout(bar);
    return div().absolute().left(0).right(0).bottom(bottom).h(bar.box?.h ?? ACT_ROW)
      .children(parts.filter((p) => Boolean(p.hover) === hover).map((p) => div().absolute().top(0).bottom(0).left(p.x).w(p.w).flex().items_center()
        .when(bar.side === "user" && p.what === "time", (el) => el.justify_end())
        .child(p.what === "time" ? div().pr(bar.side === "user" ? 4 : 0).pl(bar.side === "user" ? 0 : 4).text_size(11.5).text_color(t.dim).child(p.text)
          : p.pill ? pill(p.pill) : icon(p.what))));
  }

  rowBare(x, t, pre = "") {
    // 易读的栏宽,pane 足够宽时居中。
    // 在块的边缘,行会省掉那侧的外部留白:spaced() 把间隙放在块与块之间。
    const col = (el, px = 18, py = 6) => h_flex().w_full().justify_center()
      .child(div().w_full().max_w(COLUMN + 2 * px).px(px).pt(x.top0 ? 0 : py).pb(x.bot0 ? 0 : py).child(el));
    const pad = (el) => col(el, 18, 7);
    // 用户的话在右侧,带强调色;agent 的在左侧,色调更收敛。
    const most = Math.max(240, Math.floor(Math.min(this.width, COLUMN) * 0.8));
    const bubble = (text, faded) => h_flex().w_full().justify_end().child(
      // 比正文颜色略带 accent 色调:在亮色与暗色主题下都清晰可读(
      // 强调色底上用其自带文字色,浅色强调下太淡)。
      div().max_w(most).px(12).py(8).rounded(12).bg(t.accent + "33").border_1().border_color(t.accent + "4d")
        .text_color(t.foreground).when(faded, (el) => el.opacity(0.55))
        .child(TextView.markdown(`${pre}chat-md-${x.id}`, this.findMark(typed(this.mentionsIn(text))) || " ").selectable(true)));
    const theirs = (text) => h_flex().w_full().justify_start().child(
      div().max_w(most).px(12).py(8).rounded(12).bg(t.raised).text_color(t.foreground)
        // 折叠:仅显示的行(shownLines()),作为独立视图
        .child(x.clip ? this.clipped(t.raised, x.clip, TextView.markdown(`${pre}chat-md-fold-${x.id}`, this.findMark(this.mentionsIn(shownLines(text, x.clip, most - 24))) || " ").selectable(true))
          : TextView.markdown(`${pre}chat-md-${x.id}`, this.findMark(this.mentionsIn(text)) || " ").selectable(true)));
    const fileLine = (label) => h_flex().gap(5).items_center().text_size(12).text_color(t.dim)
      .child(svg("mods/chat/paperclip.svg").size(12).flex_none()).child(div().truncate().child(label));
    switch (x.kind) {
      case "end":
        return div().w_full().h(10);
      case "gap":
        return div().w_full().h(x.h);
      case "top":
        return pad(div().w_full().text_center().text_size(12).text_color(t.dim).child(WORDS.top));
      case "loading":
        return pad(div().w_full().text_center().text_size(12).text_color(t.dim).child(WORDS.loading));
      case "note":
        return pad(div().w_full().text_center().text_size(12).text_color(t.muted).child(x.text));
      case "user":
        return pad(v_flex().w_full().items_end().gap(3)
          .when(Boolean(x.from), (el) => el.child(div().text_size(12).text_color(t.dim).child(`From ${this.sender(x.from, x.text)}`)))
          .when(Boolean(x.text), (el) => el.child(bubble(x.text, false)))
          .when(x.images > (x.paths?.length ?? 0), (el) => el.child(fileLine(imagesLine(x.images)))));
      case "pending":
        return pad(v_flex().w_full().items_end().gap(3)
          .when(Boolean(x.text), (el) => el.child(bubble(x.text, !x.delivered || Boolean(x.failed))))
          .when(x.files?.length > 0, (el) => el.child(fileLine(x.files.join(", "))))
          .when(Boolean(x.failed), (el) => el.child(div().text_size(12).text_color(t.blocked).cursor_pointer().child(notSent(x.failed))))
          .when(!x.failed && x.late, (el) => el.child(div().text_size(12).text_color(t.dim).child(WORDS.late)))
          .when(!x.failed && Boolean(x.waiting), (el) => el.child(div().text_size(12).text_color(t.dim).child(x.waiting))));
      case "replyref":
        // 本条消息所回复的那条,以一行淡色文本显示在其上方。
        return col(h_flex().w_full().h(18).justify_end().child(h_flex().max_w(Math.floor(Math.min(this.width, COLUMN) * 0.6)).gap(5).items_center()
          .cursor_pointer().text_size(11.5).text_color(t.dim).hover((s) => s.text_color(t.muted))
          .child(svg("mods/chat/reply.svg").size(12).flex_none())
          .child(div().min_w(0).truncate().child(x.to))), 18, 2);
      case "chips":
        return col(h_flex().w_full().h(24).gap(TASK_GAP).justify_end().children(x.tasks.map((k) => h_flex().w(TASK).h(22).flex_none().px(8).gap(6)
          .items_center().rounded(11).cursor_pointer().bg(t.accent + "26").border_1().border_color(t.accent + "4d").text_size(11.5)
          .hover((s) => s.bg(t.accent + "40"))
          .child(div().flex_none().font_medium().text_color(t.foreground).child(k.ref ?? `#${k.id}`))
          .child(div().min_w(0).truncate().text_color(t.muted).child(k.title)))), 18, 3);
      case "brief": {
        const open = this.opened.has(x.id);
 // agent 之间,以群聊形式:另一个 agent 发的消息("Assistant on Mac mini ·
 // Home"),或它发给另一个 agent("Assistant → ")。类似 news line 的安静一行:左侧一个对话气泡
        // 强调色,who(→ whom)再加强一档、其开头几句、其时间;展开后,发件人首字母取代
        // 图标,整条消息显示为来自它的气泡,再次点击同一行关闭。
        if (x.who) {
          const avatar = div().size(20).flex_none().rounded(10).flex().items_center().justify_center().text_size(10).font_semibold()
            .bg(x.to ? t.foreground + "1a" : t.accent + "2e").text_color(x.to ? t.muted : t.accent).child(initialOf(x.who));
          return col(v_flex().w_full().px(6).py(QUIET_PY).rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
            .child(h_flex().h(20).gap(6).items_center().text_size(12).text_color(t.muted)
              .child(open ? avatar : svg("mods/chat/message.svg").size(14).flex_none().text_color(t.accent))
              .child(div().flex_none().font_medium().text_color(t.foreground).child(x.who))
              .when(Boolean(x.to), (el) => el.child(svg("mods/chat/arrow-right.svg").size(12).flex_none().text_color(t.dim))
                .child(div().flex_none().font_medium().text_color(t.foreground).child(x.to)))
              .child(div().flex_1().min_w(0).truncate().child(open ? "" : String(x.text ?? "").split("\n").find((l) => l.trim()) ?? ""))
              .when(x.at > 1e12, (el) => el.child(div().flex_none().text_color(t.dim).child(clock(x.at)))))
            .when(open, (el) => el.child(h_flex().w_full().pl(26).pt(6).pb(2).child(div().max_w(most).px(12).py(8).rounded(12).bg(t.raised)
              .text_size(13).text_color(t.foreground).child(TextView.markdown(`${pre}chat-brief-${x.id}`, x.text || " ").selectable(true))))), 12, 0);
        }
        return col(v_flex().w_full().px(6).py(QUIET_PY).rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
          .child(h_flex().gap(6).items_center().text_size(12).text_color(t.dim)
            .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
            .child(div().flex_none().text_color(t.muted).child(x.label))
            .when(!open && !x.bare, (el) => el.child(div().flex_1().min_w(0).truncate().child(String(x.text ?? "").split("\n").find((l) => l.trim()) ?? ""))))
          .when(open, (el) => el.child(div().pl(18).pt(6).text_size(12.5).text_color(t.muted)
            .child(TextView.markdown(`${pre}chat-brief-${x.id}`, literal(x.text) || " ").selectable(true)))), 12, 0);
      }
      case "video":
        // agent 展示的视频:窗口无法播放,因此生成一行,点击后用系统播放器打开(clickRow)
        return col(h_flex().w_full().py(QUIET_PY).gap(6).items_center().text_size(12.5).text_color(t.muted).rounded(8).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .child(svg(x.pics ? "mods/chat/paperclip.svg" : "mods/chat/play.svg").size(12).flex_none())
          .child(div().min_w(0).truncate().child(x.pics ? x.text : videoLine(x.text))), 18, 2);
      case "imgs":
        return col(h_flex().w_full().gap(THUMB_GAP).items_start().when(!x.left, (el) => el.justify_end()).when(Boolean(x.left), (el) => el.justify_start()).when(Boolean(x.faded), (el) => el.opacity(0.55))
          .children(this.fitThumbs(x.paths).boxes.map((b) => this.shot(t, b).cursor_pointer())), 18, 4);
      case "agent":
        return pad(theirs(x.text));
      case "codehead": {
        const done = this.copied === x.id;
        return col(h_flex().w_full().h(28).pl(12).pr(4).items_center().rounded_t(8).bg(t.surface).border_1().border_b(0).border_color(t.border)
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(x.lang || "code"))
          .child(h_flex().h(22).px(6).gap(5).items_center().rounded(6).cursor_pointer().text_size(12).text_color(done ? t.foreground : t.dim)
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .child(svg(`mods/chat/${done ? "check" : "copy"}.svg`).size(12).flex_none()).child(done ? "Copied" : "Copy")), 18, 0).pt(x.top0 ? 0 : 6);
      }
      case "code": {
        // 折叠时,仅计可见行与淡出层下的一行(同 shownLines())
        const all = x.code.split("\n");
        const lines = v_flex().w_full().flex_none().children((x.clip ? all.slice(0, Math.ceil(x.clip / 19) + 1) : all).map((l) => div().min_h(19).child(l || " ")));
        return col(div().w_full().px(12).py(8).rounded_b(8).bg(t.surface).border_1().border_color(t.border).overflow_hidden()
          .font_family(settings().font_family ?? "JetBrains Mono").text_size(12.5).text_color(t.foreground)
          .child(x.clip ? this.clipped(t.surface, x.clip, lines) : lines), 18, 0).pb(x.bot0 ? 0 : 6);
      }
      case "queued":
        // 在 Claude Code 自己的队列里(#662):"Queued · it reads it at its next step",以及 Send now(clickRow()):
        // 其 Ctrl+Enter 立即发送,即使回合进行中。按下时显示 Sending…;无法发送时说明原因。
        return col(h_flex().w_full().h(22).justify_end().gap(4).items_center().text_size(12).text_color(t.dim)
          .child(div().min_w(0).truncate().child(WORDS.inQueue))
          .when(this.kind === "claude", (el) => el.child("·").child(this.steering
            ? div().flex_none().child(this.steering === true ? "Sending…" : this.steering)
            : div().flex_none().cursor_pointer().font_medium().text_color(t.muted).hover((st) => st.text_color(t.foreground)).child(WORDS.sendNow))), 18, 2);
      case "fold":
        // Show more / Show less,位于回复气泡下方,与其文字对齐(clickRow())。
        return col(h_flex().w_full().h(22).pl(12).child(h_flex().h(22).gap(4).items_center().cursor_pointer()
          .text_size(12.5).font_medium().text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .child(x.open ? WORDS.showLess : WORDS.showMore)
          .child(svg(`mods/chat/chevron-${x.open ? "up" : "down"}.svg`).size(14).flex_none())), 18, 2);
      case "day":
        return col(div().w_full().text_center().text_size(12).font_medium().text_color(t.dim).child(x.text), 18, 0);
      case "cardstrip":
        // 等待用户处理的卡片的一条 strip(strips.js):其点击经由
        // clickRow(),按其所在位置。
        return col(strips.strip(t, x.s, x.first, x.last, pre), 18, 0);
      case "pilot":
        // Autopilot 唤醒:为何唤醒,以及(出现后)结果如何;低调呈现,如同已关闭的请求。
        return col(h_flex().w_full().py(QUIET_PY).gap(6).items_center().text_size(12).text_color(t.dim)
          .child(svg("mods/chat/rocket.svg").size(12).flex_none())
          .child(div().min_w(0).truncate().child(x.text)), 18, 0);
      case "askend":
        // 已关闭的请求:问了什么、结果如何,低调呈现(卡片本体已消失)。
        return col(h_flex().w_full().py(QUIET_PY).gap(6).items_center().text_size(12).text_color(t.dim)
          .child(svg("mods/chat/check.svg").size(12).flex_none())
          .child(div().min_w(0).truncate().child(x.text)), 18, 0);
      case "artifact": {
        const icon = (n) => svg("mods/workspace-chrome/file-text.svg").size(n).flex_none();
        // "Published" 行可打开其 artifact(clickRow):指针样式和悬停提示说明这一点。
        if (x.pending || x.line) return col(h_flex().w_full().py(QUIET_PY).gap(6).items_center().text_size(12).text_color(t.dim).child(icon(12))
          .when(Boolean(x.art) && !x.pending, (el) => el.rounded(8).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.muted)))
          .child(div().min_w(0).truncate().child(x.pending ? WORDS.publishing : published(x.title, x.v))), 18, 0);
        // 点击整张卡片即在聊天上方打开它(行本身不接处理器;clickRow):其标题、"Artifact · v3" 与 Open,
        // 然后是其关键图片与开头几行(core/recipe.js 的 preview,同 web 应用卡片)。
        const peek = x.peek;
        const head = h_flex().w_full().gap(10).items_center()
          .child(div().size(32).flex_none().flex().items_center().justify_center().rounded(8).bg(t.raised).text_color(t.muted).child(icon(16)))
          .child(v_flex().flex_1().min_w(0).gap(1)
            .child(div().font_medium().text_color(t.foreground).truncate().child(x.title))
            .child(div().text_size(12).text_color(t.dim).child(artifactLine(x.version))))
          .child(h_flex().h(28).px(10).flex_none().items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
            .text_size(12.5).font_medium().text_color(t.foreground).child("Open"));
        const shots = peek?.paths?.filter((p) => this.views[p]) ?? [];
        return pad(v_flex().w_full().max_w(PEEK_W).gap(8).px(10).py(8).rounded(10).cursor_pointer()
          .bg(t.surface).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
          .child(head)
          .when(shots.length > 0, (el) => el.child(h_flex().w_full().gap(THUMB_GAP).items_start()
            .children(fitThumbs(shots.map((p) => this.views[p]), PEEK_W - 22).boxes.map((b, i) => this.shot(t, { ...b, path: shots[i] })))))
          .when(Boolean(peek?.text), (el) => el.child(div().w_full().text_size(12.5).text_color(t.muted).child(peek.text))));
      }
      case "tasknews": {
        // task 的 news line(newsLines()):其标记、id、发生了什么,然后是内容文字,变淡;
        // 仍有红色 needs-you 行在等待。整行可打开任务(clickRow());
        // Ready 行的 Accept 在其右端,由按压位置定位(行不接收
        // handler)。
        const tick = (c) => div().size(12).flex_none().rounded(6).bg(c).child(svg("mods/tasks/tick.svg").size(12).flex_none().text_color("#ffffff"));
        const dot = (c) => div().size(8).flex_none().rounded(4).bg(c);
        const mark = x.mark === "ready" ? tick(green()) : x.mark === "done" ? tick(t.dim)
          : dot(x.mark === "started" ? amber() : x.mark === "needs" ? (x.live ? red() : t.dim) : t.dim);
        return col(h_flex().w_full().px(6).py(QUIET_PY).gap(6).items_center().rounded(RADIUS.card).cursor_pointer()
          .text_size(TEXT.label).text_color(t.dim).hover((s) => s.bg(t.hover))
          .child(h_flex().w(14).h(14).flex_none().items_center().justify_center().child(mark))
          .child(div().flex_none().font_medium().text_color(t.muted).child(x.ref))
          .child(div().flex_none().text_color(x.live ? red() : t.muted).child(x.what))
          .when(Boolean(x.text), (el) => el.child(div().flex_none().child("·")).child(div().flex_1().min_w(0).truncate().child(x.text)))
          .when(!x.text, (el) => el.child(div().flex_1()))
          // Tasks 面板自己的 Accept(ui.js:primary,一行内可容 20);其点击来自
          // 经由 clickRow()。
          .when(Boolean(x.accept), (el) => el.child(this.acceptButton(x.busy)
            .when(!x.busy, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88))))), 12, 0);
      }
      case "ask":
        // 其 dialog 打开时为红色;一旦消失(已应答,或未应答而关闭),恢复平静。
        return pad(v_flex().w_full().gap(4).px(12).py(10).rounded(10).border_1().border_color(t.border)
          .child(div().text_size(12).font_medium().text_color(x.closed ? t.dim : t.blocked)
            .child(x.closed === "answered" ? WORDS.askedAnswered : x.closed ? WORDS.askedClosed : WORDS.asked))
          .child(div().text_color(x.closed ? t.muted : t.foreground).child(TextView.markdown(`${pre}chat-md-${x.id}`, x.text).selectable(true))));
      case "error":
        return pad(div().w_full().text_size(12.5).text_color(t.blocked).child(x.text));
      case "tools": {
        const open = this.opened.has(x.id);
        return col(v_flex().w_full().px(6).py(QUIET_PY).rounded(7).cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .child(h_flex().gap(6).items_center().text_size(12).text_color(t.dim)
            .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
            .child(div().flex_1().min_w(0).truncate().child(summary(x.steps))))
          .when(open, (el) => el.child(v_flex().pl(18).pt(4).pb(2).gap(3).text_size(12).text_color(t.muted)
            .children(x.steps.flatMap((s) => {
              const out = this.results.get(s.id);
              return [...s.line.split("\n").map((line) => div().truncate().child(line)),
                ...(out ? [v_flex().ml(2).mb(3).pl(8).border_l(1).border_color(t.border).text_size(11.5).text_color(t.dim)
                  .children(out.split("\n").map((l) => div().truncate().child(l || " ")))] : [])];
            })))), 12, 0);
      }
    }
    return div();
  }

  // 折叠回复中 el 的最初 `h` px,向 `bg`(其气泡颜色)淡出。
  clipped(bg, h, el) {
    const fade = [0.3, 0.55, 0.8, 0.95];
    return div().relative().w_full().max_h(h).overflow_hidden().child(el)
      .child(v_flex().absolute().left(0).right(0).bottom(0).children(fade.map((o) => div().w_full().h(8).bg(bg).opacity(o))));
  }

  // 点击行:打开 tools 行、复制代码块,或执行消息操作。
  clickRow(key, rows, cx, sizes) {
    const row = rows.find((r) => r.id === key);
    if (!row) return;
    const bar = this.hitBar(row);
    if (bar) { this.act(row.bar, bar, cx); cx.notify(); return; }
    if (row.kind === "tools") {
      if (this.opened.has(key)) this.opened.delete(key);
      else { this.opened.add(key); this.loadResults(row, cx); }
    } else if (row.kind === "codehead") this.copy(row.code, row.id, cx);
    else if (row.kind === "queued" && this.kind === "claude" && !this.steering) this.sendQueuedNow(cx);
    else if (row.kind === "pending" && row.failed) { const p = this.pending.find((x) => x.id === row.id); if (p?.msg) this.retry(p, cx); }
    else if (row.kind === "artifact" && row.art) this.openArtifact(row);
    else if (row.kind === "tasknews") {
      // Accept 在 Ready 行上的位置:行的右端,算上行内边距(如 row() 所绘:
      // col(…, 12, 0),再 px 6)。
      const inner = Math.min(this.width, COLUMN + 24) - 24;
      const off = (this.width + inner) / 2 - 6 - (this.press?.x ?? -1);
      if (row.accept && off >= -2 && off <= (this.cardW.get("accept") ?? ACCEPT) + 2) this.acceptTask(row, cx);
      // 需要你,卡片就在其正下方展开:按键交给卡片。
      else if (row.asks) { const a = (this.wasks ?? []).find((w) => w.ref === row.ref && !w.secret); if (a) this.workerCards.pressed(a); }
      else this.openTask(row.taskId, row.task);
    }
    else if (row.kind === "cardstrip") {
      // 点击落在条带哪个控件上(行本身不接处理器:strips.js hit())。
      const c = strips.hit(row.s, this.press?.x, strips.innerOf(this.edges()), this.cardW);
      if (row.ask) row.owner?.pressed(row.ask);
      if (c?.kind === "input") (c.state ?? null)?.focus();
      else c?.fn?.(cx);
    }
    else if (row.kind === "brief") { if (this.opened.has(key)) this.opened.delete(key); else this.opened.add(key); }
    else if (row.kind === "fold") {
      // 只按其文字计算(如 rowBare() 所绘:列边缘、气泡内边距)。
      const off = (this.press?.x ?? -1) - this.edges().left - 12;
      if (off >= -4 && off <= 100) this.toggleFold(row, rows);
    }
    else if (row.kind === "replyref") {
      this.goTo(row.to, row.of, rows);
      // 指示灯走原生动画:目标值翻转一次,过渡动画自动完成。
      cx.timer.after(80, (cx) => { if (this.flash) { this.flash.on = false; cx.notify(); } });
      cx.timer.after(1400, (cx) => { this.flash = null; cx.notify(); });
    } else if (row.kind === "chips") {
      const off = this.edges().right - (this.press?.x ?? -1);
      const j = Math.floor(off / (TASK + TASK_GAP));
      const k = row.tasks[row.tasks.length - 1 - j];
      if (off >= 0 && off % (TASK + TASK_GAP) <= TASK && k) this.openTask(k.id);
    }
    else if (row.kind === "imgs") {
      // 缩略图,右对齐(用户的)或左对齐(agent 的):点击落在哪一张上(行本身不接
      // 自己的 handler)。
      const x = this.press?.x;
      const boxes = this.fitThumbs(row.paths).boxes;
      if (row.left) {
        const off = x === undefined ? -1 : x - this.edges().left;
        for (let i = 0, edge = 0; i < boxes.length && off >= 0; edge += boxes[i].w + THUMB_GAP, i++)
          if (off >= edge && off <= edge + boxes[i].w) { this.openImages(row.paths, i); break; }
      } else {
        const off = x === undefined ? -1 : this.edges().right - x;
        for (let i = boxes.length - 1, edge = 0; i >= 0 && off >= 0; edge += boxes[i].w + THUMB_GAP, i--)
          if (off >= edge && off <= edge + boxes[i].w) { this.openImages(row.paths, i); break; }
      }
    }
    else if (row.kind === "video") this.openVideo(row.path);
    cx.notify();
  }

  // agent 自述其等待的内容(取自状态报告),如 "Do you prefer tea or coffee? (Tea · Coffee)"。
  asking() {
    const msg = reportMsg(terminals().find((x) => x.address === this.addr));
    return msg ? msg.replace(/^answer:\s*/i, "").trim() : null;
  }

  // // ---- 对话下方是什么 -----------------------------------------------------

  // Tasks 面板的 Accept(ui.js),此处仅绘制、不带处理器:新闻行本身就是一个列表行。
  acceptButton(busy) {
    return button("accept-news", busy ? "接受中…" : "审查", { kind: "primary", size: "xs", disabled: Boolean(busy) });
  }

  statusLine(t, st) {
    // 卡片提问(在时间线中其出现的位置):会话下方不再重复它。
    if (this.asks.length || this.sasks?.some((a) => !a.kept) || (this.addr && openCard(this.addr))) return null;
    // 本聊天正在启动的 agent,在它开口之前。
    if ((this.phase === "starting" || this.phase === "finding") && this.role && this.pending.length) {
      return h_flex().id("chat-status").flex_none().w_full().max_w(COLUMN + 36).mx_auto().h(30).px(18).gap(8).items_center().text_size(12).text_color(t.muted)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .child(div().flex_1().min_w(0).truncate().child(`Starting the ${this.role === "coordinator" ? "Assistant" : this.role}…`));
    }
    if (st === "working") {
      // 它正在做什么,以平实的话说明、已进行多久,以及 Stop。该行沿用 composer 输入框的
      // 边缘(同宽同内边距),因此 Stop 的右缘与输入框对齐。
      const secs = Math.max(0, Math.floor((Date.now() - (this.workingSince ?? Date.now())) / 1000));
      // (core/chat-view.js:web app 的工作行使用相同措辞)
      const report = reportMsg(terminals().find((x) => x.address === this.addr));
      const doing = this.stopping ? WORDS.stopping : doingWords(this.conv, report) ?? WORDS.working;
      // 仅在等待(hc wait、sleep、monitor、其依赖的 helper):平静,无 spinner;
      // 消息会唤醒它(或立即送达)。
      const waiting = this.waitingNow() && !this.stopping;
      return h_flex().id("chat-status").flex_none().w_full().max_w(COLUMN + 28).mx_auto().h(30).px(14).gap(8).items_center().text_size(12).text_color(t.muted)
        .when(waiting, (el) => el.child(svg("mods/chat/clock.svg").size(12).flex_none().text_color(t.dim)))
        .when(!waiting, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .child(div().flex_1().min_w(0).truncate().child(doing))
        .child(div().flex_none().font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5).text_color(t.dim)
          .child(elapsed(secs)))
        .child(h_flex().id("chat-stop").h(22).px(8).gap(6).flex_none().items_center().rounded(6).border_1().border_color(t.input)
          .text_size(12).text_color(t.muted)
          .when(this.stopping, (el) => el.opacity(0.45))
          .when(!this.stopping, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.stop(cx); }))
          .child(svg("mods/chat/stop-chip.svg").size(8).flex_none())
          .child(div().child("Stop"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")));
    }
    if (st === "blocked") {
      return div().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(6).child(h_flex().px(12).py(10).gap(10).items_center().rounded(10)
        .bg(t.surface).border_1().border_color(t.border)
        .child(div().size(8).flex_none().rounded(4).bg(t.blocked))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().font_medium().text_color(t.foreground).child(WORDS.needsYou))
          .child(div().text_size(12).text_color(t.muted).child(this.asking() ?? WORDS.askingInTerminal)))
        .child(this.button("chat-open-terminal", WORDS.openTerminal,"mods/workspace-chrome/terminal.svg", "primary", t, () => this.toTerminal())));
    }
    return null;
  }


  // agent 正在忙碌的 helper:其 CLI 自带的(Claude Code 已启动且尚未结束的 helper)
  // 已结束,Codex 派生的 agent)算作工作中;Herdr 的(经 hc 启动的终端:
  // 父级为本 agent)在上报 working 或 blocked 时计入。Idle 或已完成的
  // helper 以及不汇报状态的程序不计入。
  helpers() {
    // 仅 CLI 自身的 subagent(Claude Code 的 Agent/Task 运行、Codex 派生的 agent),来自
    // 其日志。它用 hc 启动的 agent 就是 Herdr 已在其下列出的 terminal
    // Agents sidebar,因此这里不再重复显示。
    return (this.conv?.running?.() ?? []).map((h) => ({ label: h.desc, at: h.at }));
  }

  // 仅在等待:其当前调用本身就是等待(hc wait、sleep、monitor、wait_agent、
  // 它所等待的 helper)。helper 仅存在并不构成等待。
  waitingNow() {
    return Boolean(this.conv?.waiting);
  }

  // agent 留在后台运行的内容(其 shell 与 watcher,core/bg-jobs.js):
  // 在 agent 存活期间有效;结束或本聊天仅显示日志时为空。
  jobs() {
    if (!this.conv || this.phase !== "ready" || this.ended || !KINDS[this.kind]) return [];
    return this.bgJobs.list(this.kind, this.conv);
  }

  // 在 agent 的 machine 上运行 shell 脚本(core/bg-jobs.js:首个参数为 $0)。
  runThere(script, args) {
    return exec("sh", ["-c", script, ...args], { on: this.machine });
  }

  // 到期时查看 agent 的进程,并再次读取打开行的最后几行。
  async lookJobs(cx) {
    const pid = this.t?.foreground?.pid;
    if (!pid || !this.conv || this.phase !== "ready") return;
    const jobs = this.bgJobs;
    if (jobs.due(this.kind, this.conv) && await jobs.look((s, a) => this.runThere(s, a), this.kind, pid, this.conv)) cx.notify();
    const open = this.jobs().find((j) => j.id === this.jobOpen);
    if (this.jobOpen && !open) { this.jobOpen = null; cx.notify(); }
    if (open?.path) {
      const text = await jobs.output((s, a) => this.runThere(s, a), open);
      if (text !== null && text !== this.jobOut.get(open.id)) { this.jobOut.set(open.id, text); cx.notify(); }
    }
  }

  // 在展开行上停止:其进程结束;CLI 随后告知 agent,如同它自己停止时一样。
  stopJob(job, cx) {
    const pid = this.t?.foreground?.pid;
    if (!pid || this.jobStopping.has(job.id)) return;
    this.jobStopping.add(job.id);
    const jobs = this.bgJobs;
    cx.spawn(async (cx) => {
      await jobs.stop((s, a) => this.runThere(s, a), this.kind, pid, job).catch(() => {});
      this.jobStopping.delete(job.id);
      if (this.jobOpen === job.id) this.jobOpen = null;
      cx.notify();
    });
  }

  // 输入框上方:先是 CLI 在工作的 subagent,再是其 background shell 和 watcher,至多一行
 // 每类各占一行:单个显示为独立行(图标、名称、时长),
  // 两个及以上合并为一行("3 background processes"、共同状态、最新者的名称),
  // 就地展开为列表。shell 或 watcher 的行展开显示其命令、
  // 最后打印的(Claude Code 的),以及 Stop。
  // herdr-winapp 设置 “Helpers above the chat box” 关闭(shared "chat.helpers" 为 false):不显示 subagent。
  background(t, st, rcx) {
    const now = Date.now();
 // 先找它在 herdr 里的 helper agent,再找 CLI 的
    const kids = shared("chat.helpers") === false || this.phase === "ended" ? [] : subagentsOf(terminals(), this.addr, now).map((k) => ({ ...k, kind: "child", id: `c:${k.address}`, label: k.title }));
    const shown = [...kids, ...(shared("chat.helpers") === false ? [] : this.helpers().map((h) => ({ ...h, kind: "agent" }))), ...this.jobs()];
    if (!shown.length) return null;
    const ago = (at) => {
      if (!at) return "";
      const s = Math.max(0, Math.floor((now - at) / 1000));
      return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
    };
    const mono = settings().font_family ?? "JetBrains Mono";
    const age = (h) => div().flex_none().font_family(mono).text_size(11.5).text_color(t.dim).child(ago(h.at));
    const row = (h, i) => {
      if (h.kind === "child") return this.subagentRow(h, t, age, rcx);
      if (h.kind === "agent") return h_flex().id(`helper-${i}`).w_full().h(24).px(6).gap(8).items_center().text_size(12)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(h.label))
        .child(age(h));
      const on = this.jobOpen === h.id;
      const head = h_flex().id(`job-${h.id}`).w_full().h(24).px(6).gap(8).items_center().rounded(6).cursor_pointer().text_size(12)
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.jobOpen = on ? null : h.id;
          cx.notify();
          if (!on) cx.spawn(async (cx) => this.lookJobs(cx));
        })
        .child(svg(h.kind === "monitor" ? "mods/chat/eye.svg" : "mods/workspace-chrome/terminal.svg").size(12).flex_none().text_color(t.working))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(h.label))
        .child(age(h))
        .child(svg(on ? "mods/chat/chevron-up.svg" : "mods/chat/chevron-down.svg").size(12).flex_none().text_color(t.dim));
      if (!on) return head;
      const out = this.jobOut.get(h.id);
      const lines = out === undefined ? null : out.split("\n").slice(-8).map((l) => (l.length > 200 ? l.slice(0, 199) + "…" : l));
      const stopping = this.jobStopping.has(h.id);
      return v_flex().w_full().child(head)
        .child(v_flex().w_full().pl(26).pr(6).pt(4).pb(6).gap(6)
          .child(div().w_full().font_family(mono).text_size(11.5).text_color(t.muted).child(h.cmd.length > 300 ? h.cmd.slice(0, 299) + "…" : h.cmd))
          .when(Boolean(h.path), (el) => el.child(v_flex().w_full().px(8).py(6).rounded(6).bg(t.surface).border_1().border_color(t.border)
            .font_family(mono).text_size(11.5).text_color(t.dim)
            .children(lines === null ? [div().child("Loading…")] : lines.length && lines.some(Boolean) ? lines.map((l) => div().w_full().truncate().child(l || " ")) : [div().child("(no output)")])))
          .child(h_flex().child(stopping
            ? h_flex().h(28).px(10).items_center().text_size(12.5).text_color(t.dim).child(WORDS.stopping)
            : this.button(`job-stop-${h.id}`, "Stop", "mods/chat/stop.svg", "secondary", t, (cx) => this.stopJob(h, cx)))));
    };
    // 同类两项及以上:一行,就地展开为各自的条目
    this.groupOpen ??= {};
    const group = (g) => {
      const on = Boolean(this.groupOpen[g.kind]);
      const icon = g.kind === "proc" ? svg("mods/workspace-chrome/terminal.svg").size(12).flex_none().text_color(t.working)
        : g.status === "working" ? svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)
        : g.status === "needs" ? div().size(6).mx(3).flex_none().rounded(3).bg(red(t))
        : svg("mods/chat/check.svg").size(12).flex_none().text_color(t.dim);
      const head = h_flex().id(`bg-group-${g.kind}`).w_full().h(24).px(6).gap(8).items_center().rounded(6).cursor_pointer().text_size(12)
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); this.groupOpen[g.kind] = !on; cx.notify(); })
        .child(icon)
        .child(div().flex_none().font_medium().text_color(t.foreground).child(g.words))
        .when(g.kind === "sub", (el) => el.child(div().flex_none().text_color(g.status === "needs" ? red(t) : t.dim).child(subagentWord(g.status))))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(g.newest.label ?? ""))
        .child(age(g.newest.ended ? { at: Date.now() - (g.newest.ended - g.newest.at) } : g.newest))
        .child(svg(on ? "mods/chat/chevron-up.svg" : "mods/chat/chevron-down.svg").size(12).flex_none().text_color(t.dim));
      if (!on) return head;
      return v_flex().w_full().child(head).child(v_flex().w_full().pl(20).pt(2).children(g.items.map((h) => row(h, shown.indexOf(h)))));
    };
    return v_flex().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(4)
      .children(bgGroups(shown).map((g) => (g.words ? group(g) : row(g.items[0], shown.indexOf(g.items[0])))));
  }

 // 输入框上方的一个 subagent,同 web 的:其状态(工作中转圈、请求时红色、完成后打勾),
  // "Reviewer · Codex",用文字说明其状态和时长。展开后显示其当前工作以及 "Open its chat":其自己的
  // 会话放进对话框(仅是 view,如同任务的线程),用户可旁观或与之对话。
  subagentRow(h, t, age, rcx) {
    // 已结束的其行保留片刻,标记完成,但不再能打开:其日志由运行中的进程
    const on = this.jobOpen === h.id && !h.ended;
    const word = subagentWord(h.status);
    const icon = h.status === "working" ? svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)
      : h.status === "needs" ? div().size(6).mx(3).flex_none().rounded(3).bg(red(t))
      : svg("mods/chat/check.svg").size(12).flex_none().text_color(t.dim);
    const head = h_flex().id(`sub-${h.address}`).w_full().h(24).px(6).gap(8).items_center().rounded(6).cursor_pointer().text_size(12)
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); if (h.ended) return; this.jobOpen = on ? null : h.id; if (!on) this.subagentWords(h.address, cx); cx.notify(); })
      .child(icon)
      .child(div().min_w(0).truncate().font_medium().text_color(t.foreground).child(h.label))
      .child(div().flex_none().text_color(h.status === "needs" ? red(t) : t.dim).child(word))
      .child(div().flex_1())
      .child(age(h.ended ? { at: Date.now() - (h.ended - h.at) } : h))
      .child(h.ended ? div().size(12).flex_none() : svg(on ? "mods/chat/chevron-up.svg" : "mods/chat/chevron-down.svg").size(12).flex_none().text_color(t.dim));
    if (!on) return head;
    const k = terminals().find((x) => x.address === h.address);
    const now = typeof k?.status === "object" ? k.status?.msg : null;
    // 其最后的话,取自其自身日志(打开时读取,打开期间每几秒刷新:subagentWords)
    const said = this.subSaid?.get(h.address);
    if (rcx && !this.subPulling?.has(h.address) && Date.now() - (this.subAt?.get(h.address) ?? 0) > 4000) this.subagentWords(h.address, rcx);
    return v_flex().w_full().child(head)
      .child(v_flex().w_full().pl(26).pr(6).pt(4).pb(6).gap(6)
        .children(said === undefined ? [div().text_size(12).text_color(t.dim).child("Loading…")]
          : said.map((w) => div().w_full().pl(8).border_l(2).border_color(t.border).text_size(12).text_color(t.muted).child(w.length > 400 ? w.slice(0, 399) + "…" : w)))
        .when(Boolean(now) || (said !== undefined && !said.length), (el) => el.child(div().w_full().truncate().text_size(11.5).text_color(t.dim).child(now || "Nothing said yet.")))
        .child(h_flex().child(this.button(`sub-open-${h.address}`, WORDS.subOpen, "mods/chat/arrow-right.svg", "secondary", t, () =>
          openOverlay({ mod: "chat", kind: "dialog", width: 760, height: 0.85, props: { terminal: h.address, thread: true, title: h.label } })))));
  }

  // subagent 的最后两条消息,取自其自身 session log(core/chat-reader.js,与 web 的 service 读取方式相同)。
  subagentWords(addr, cx) {
    this.subSaid ??= new Map(); this.subPulling ??= new Set(); this.subAt ??= new Map(); this.subReaders ??= new Map();
    this.subPulling.add(addr);
    this.subAt.set(addr, Date.now());
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    let r = this.subReaders.get(addr);
    if (!r) this.subReaders.set(addr, (r = new ChatReader({ sh: (script, args, on) => exec("sh", ["-c", script, ...args], { on: on ?? machine }) }, addr)));
    cx.spawn(async (cx) => {
      try {
        const got = await hc(["get", addr, "--json"]).then((x) => JSON.parse(x.stdout || "{}")).catch(() => null);
        if (got) await r.locate(got);
        await r.pull();
        const items = r.conv?.items ?? [];
        this.subSaid.set(addr, items.filter((x) => x.kind === "agent" && x.text).slice(-2).map((x) => norm(x.text)));
      } catch { this.subSaid.set(addr, []); }
      this.subPulling.delete(addr);
      cx.notify();
    });
  }

  // 暂挂的消息,各带 Edit 和 Cancel;agent 空闲后即发送。
  queued(t) {
    if (!this.queue.length) return null;
    const ghost = (id, label, fn) => h_flex().id(id).h(22).px(8).flex_none().items_center().rounded(6).cursor_pointer().text_size(12).font_medium()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); })
      .child(label);
    return v_flex().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(6).gap(4).children(this.queue.map((m) =>
      h_flex().id(`queued-${m.id}`).w_full().h(40).pl(10).pr(4).gap(8).items_center().rounded(8).border_1().border_color(t.border).bg(t.background)
        .child(svg("mods/chat/clock.svg").size(14).flex_none().text_color(t.dim))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(12.5).text_color(t.foreground).child(m.label ?? (m.text || m.files.map((f) => f.name).join(", "))))
          .child(div().truncate().text_size(12).text_color(t.dim).child(WORDS.queued)))
        .child(ghost(`queued-now-${m.id}`, WORDS.sendNow,(cx) => this.sendQueued(m, cx)))
        .child(ghost(`queued-edit-${m.id}`, "Edit", (cx) => this.editQueued(m, cx)))
        .child(div().id(`queued-x-${m.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.queue = this.queue.filter((x) => x !== m); this.saveSoon(cx); cx.notify(); })
          .child(svg("mods/chat/x.svg").size(12)))));
  }

  // "/" 列表:与输入内容匹配的 agent 命令。
  slashList(t, list) {
    if (!list.length) return null;
    const sel = Math.min(this.slashSel, list.length - 1);
    return v_flex().w_full().p(4).gap(1).border_b(1).border_color(t.border).children(list.map((c, i) =>
      h_flex().id(`slash-${c.key ?? c.name}`).h(28).px(8).gap(10).items_center().rounded(6).cursor_pointer()
        .when(i === sel, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); this.pick(c, cx); })
        .child(div().flex_none().text_size(12.5).font_medium().text_color(t.foreground).child(c.task || c.space ? c.name : `/${c.name}`))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(c.task ? t.muted : t.dim).child(c.about))
        .when(Boolean(c.state), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(c.state)))));
  }

  // 待发送的文件:输入框上方的小 tile,每个可移除。
  tiles(t) {
    if (!this.files.length && !this.quote) return null;
    return v_flex().w_full().px(10).pt(8).gap(6)
      .when(Boolean(this.quote), (el) => el.child(h_flex().w_full().h(24).pl(4).gap(6).items_center()
        .child(svg("mods/chat/reply.svg").size(12).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(norm(this.quote.text)))
        .child(div().id("quote-x").size(22).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.quote = null; this.saveSoon(cx); cx.notify(); })
          .child(svg("mods/chat/x.svg").size(12)))))
      .when(this.files.length > 0, (el) => el.child(div().flex().flex_wrap().gap(8).pt(2).children(this.files.map((f, i) => {
        const imgs = this.files.filter((x) => x.image).map((x) => x.path);
        const tile = f.image
          ? this.thumb(t, f.path).id(`file-${i}`).cursor_pointer()
            .on_click((_e, cx) => { cx.stop_propagation(); this.openImages(imgs, imgs.indexOf(f.path)); })
          // 非图片:同样大小的 tile,显示其图标和短名。
          : v_flex().id(`file-${i}`).size(THUMB).flex_none().px(4).gap(3).items_center().justify_center().rounded(8)
            .border_1().border_color(t.border).bg(t.surface)
            // 粘贴的文本点开即可阅读。
            .when(Boolean(f.text), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); this.openText(f); }))
            .child(svg("mods/chat/file.svg").size(16).flex_none().text_color(t.dim))
            .child(div().w_full().text_center().truncate().text_size(10.5).text_color(t.muted).child(f.name));
        return div().relative().flex_none().child(tile)
          .child(div().id(`file-x-${i}`).absolute().top(-6).right(-6).size(18).flex().items_center().justify_center().rounded(9).cursor_pointer()
            .bg(t.popover).border_1().border_color(t.border).text_color(t.muted).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); attach.drop(f); this.files = this.files.filter((x) => x !== f); this.saveSoon(cx); cx.notify(); })
            .child(svg("mods/chat/x.svg").size(10)));
      }))));
  }

  // 图像显示为 THUMB 尺寸的正方形,裁剪填满(attach.cover);在其…之前是一个低调的方块
  // 尺寸已知(needViews)。
  thumb(t, path) {
    const v = this.views[path];
    const box = div().relative().size(THUMB).flex_none().rounded(8).overflow_hidden().bg(t.raised);
    const edge = div().absolute().inset_0().rounded(8).border_1().border_color(t.foreground + "1a");
    if (!v) return box.child(edge);
    const c = attach.cover(v.w, v.h, THUMB);
    return box.child(image(v.rel).absolute().left(c.left).top(c.top).w(c.w).h(c.h)).child(edge);
  }

  // 消息下方的缩略图:每张图片完整呈现、保持形状,适配 THUMB_ONE 或
  // THUMB_MANY,绝不超出其原始尺寸,当行会越界时一起缩小
  // 列。尺寸未知前为低调占位框。{ boxes: [{ path, w, h }], h: 行高 }。
  fitThumbs(paths) {
    // core/chat-view.js:web 端聊天以同样方式定尺寸。
    const { left, right } = this.edges();
    const fit = fitThumbs(paths.map((p) => this.views[p] ?? null), right - left);
    return { boxes: fit.boxes.map((b, i) => ({ ...b, path: paths[i] })), h: fit.h };
  }

  // 其中一种:整张图片,圆角,上面覆一层淡淡的描边。
  shot(t, b) {
    const v = this.views[b.path];
    return div().relative().w(b.w).h(b.h).flex_none().rounded(8).overflow_hidden().bg(t.raised)
      .when(Boolean(v), (el) => el.child(image(v.rel).size_full()))
      .child(div().absolute().inset_0().rounded(8).border_1().border_color(t.foreground + "1a"));
  }

  // 聊天显示的图片,在 image() 可加载处附链接,并带尺寸。每张只询问一次。
  needViews(paths, cx) {
    const want = [...new Set(paths)].filter((p) => p && !this.views[p] && !this.viewAsked.has(p));
    if (!want.length) return;
    for (const p of want) this.viewAsked.add(p);
    // 从 render 中发起的:紧随其后启动。
    cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
      Object.assign(this.views, await attach.viewable(want));
      cx.notify();
    }));
  }

  // 窗口上报的 pane 尺寸,按 zoom 1 记录(列宽、行的换行)。
  paneSize(size) {
    const w = unzoom(size.width);
    if (Math.abs(w - this.width) > 1) this.width = w;
    this.height = unzoom(size.height);
  }

  // 点击 chat:在 zoom 1 下 pane 中的位置(x, y:命中测试与 layout 比较用的坐标),以及以
  // 由窗口上报(rx、ry:pressWin 时 pane 在窗口中的位置,供其上的弹出物定位)。
  notePress(e) {
    const x = e.local_position?.x, y = e.local_position?.y;
    this.press = { x: unzoom(x), y: unzoom(y), rx: x, ry: y, at: Date.now() };
  }

  // 本聊天 pane 在窗口中的位置({ x, y, width, height }),取自打开某物的那次点击
  // 其上的查看器(图片、文本、artifacts);未按下时为 null。
  paneArea() {
    const p = this.pressWin, local = this.press;
    if (!p || local?.rx === undefined) return null;
    const z = zoomOf();
    return { x: p.x - local.rx, y: p.y - (local.ry ?? 0), width: Math.round(this.width * z), height: Math.round((this.height ?? 700) * z) };
  }

  // 本聊天所在处及其输入框是否持有键盘,供 Ctrl+K 的 artifacts 使用(artview.js
  // chatArea()):其 pane,或 Tasks 面板中任务聊天用的 "thread"。区域会被记录
  // 指针事件边界显示其移动或改变尺寸时记录为 b,resize 时遗忘(为 null)。
  areaKey() { return this.inner || this.thread ? "thread" : this.myPane(); }

  noteArea(b) {
    if (b && this.area && ["x", "y", "width", "height"].every((k) => Math.abs(this.area[k] - b[k]) < 1)) return;
    if (!b && !this.area) return;
    this.area = b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
    noteChatArea(this.areaKey(), { area: this.area });
  }

  // 粘贴的文本文件在查看器中打开(mods/chat-image),覆盖此 chat pane。
  openText(f) {
    const a = this.paneArea();
    const at = a ? { x: a.x, y: a.y } : "pointer";
    const width = Math.round(this.width * zoomOf()), height = Math.round((this.height ?? 700) * zoomOf());
    openOverlay({ mod: "chat-image", kind: "popup", frame: "none", width, height, at, props: { textPath: f.path, title: f.name, width, height } });
  }

  // agent 展示的视频,用系统播放器打开:窗口无法播放。另一台 machine 的视频在那里,而非
  // 此处:由 web 应用播放。
  openVideo(path) {
    if (this.machine || !path) { toast({ title: "它在另一台机器上", body: "在网页应用中打开此对话查看。", level: "info" }); return; }
    const os = window()?.platform;
    (os === "macos" ? exec("open", [path]) : os === "windows" ? exec("cmd", ["/c", "start", "", path]) : exec("xdg-open", [path])).catch(() => {});
  }

  // artifact 卡片展示的内容:其关键图片(为 image() 附链接:needViews)与开头几行,取自其
  // 本机的 recipe(core/recipe.js 的 preview,同 web 应用的卡片)。每个版本只读一次;此前为 null,
  // 另一台机器的亦然(其卡片保留标题与 Open)。
  peekOf(id, version) {
    return this.machine || !id || !version ? null : this.peeks?.get(`${id}:${version}`) ?? null;
  }

  // 为这些行中还没有 preview 的最新卡片而读(各自只请求一次;自 render 发起,因此随后即行)。
  needPeeks(rows, cx) {
    if (this.machine) return;
    this.peeks ??= new Map();
    const want = rows.filter((r) => r.kind === "artifact" && r.art && !r.line && !r.pending && !this.peeks.has(`${r.art}:${r.version}`));
    if (!want.length) return;
    for (const r of want) this.peeks.set(`${r.art}:${r.version}`, null);
    cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
      for (const r of want) {
        const dir = `${(await dirsReady()).artifacts}/files/${r.art}/v${r.version}`;
        try {
          const p = preview(JSON.parse(await readTextFile(`${dir}/recipe.json`)));
          const text = p.lines.join(" · ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>]+/g, "").trim();
          this.peeks.set(`${r.art}:${r.version}`, { paths: p.images.map((src) => `${dir}/${src}`), text: text.length > 200 ? `${text.slice(0, 199)}…` : text });
        } catch {}
      }
      cx.notify();
    }));
  }

  // The viewer (mods/chat-image) on these images, from the i-th.
  openImages(paths, i) {
    const all = paths.map((p) => this.views[p] ? { ...this.views[p], name: p.split("/").pop(), path: p } : null);
    const images = all.filter(Boolean);
    if (!images.length) return;
    i = images.indexOf(all[i] ?? images[0]);
    // Over this chat pane, at its size (a popup's root needs its size spelled out).
    const a = this.paneArea();
    const at = a ? { x: a.x, y: a.y } : "pointer";
    const width = Math.round(this.width * zoomOf()), height = Math.round((this.height ?? 700) * zoomOf());
    openOverlay({ mod: "chat-image", kind: "popup", frame: "none", width, height, at,
      props: { images, index: Math.max(0, Math.min(images.length - 1, i)), width, height } });
  }

  // The box's height. A hidden copy of the words at the box's width (composer()) says how many
  // rows they take; the textarea gets one row more than that, the spare one tucked under the
  // toolbar, so its words never overflow it: no scrollbar and no nudge while they fit (8
  // rows). Past 8 it shows 8 and scrolls, with its bar. A taller box shortens the list above
  // it, so the list goes back to its end the same frame when it was following the newest.
  sizeBox() {
    const rows = this.lineH && this.textH ? Math.max(1, Math.round(this.textH / this.lineH)) : 1;
    const want = Math.min(rows, 8);
    const spare = Boolean(this.lineH) && rows <= 8;
    const key = `${want}|${spare}`;
    if (key === this.boxKey) return;
    this.boxKey = key;
    this.boxRows = want;
    this.boxSpare = spare;
    this.box.set_rows(spare ? want + 1 : want);
    if (this.pinned) this.stick = true;
  }

  // The desktop's own file picker (attach.pick(): xdg-desktop-portal's, or macOS's own): the chosen files join
  // the message as tiles, as a drop or a paste makes them.

  // The composer's round buttons: one size and shape, so Send, Call, End call, the mic and Mute
  // never change size or move; only the icon and fill change.
  //   fill: "solid" (Send), "call" (Call), "danger" (End call), "on" (muted), "quiet" (Mute), "ghost", "off"
  round(id, icon, t, fill, fn) {
    const el = div().id(id).size(ROUND).flex_none().flex().items_center().justify_center().rounded(ROUND / 2)
      .when(fill === "solid", (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(fill === "call" || fill === "on", (el) => el.bg(t.foreground).text_color(t.background))
      .when(fill === "danger", (el) => el.bg(t.blocked).text_color("#ffffff"))
      .when(fill === "quiet", (el) => el.bg(t.raised).text_color(t.foreground))
      .when(fill === "rec", (el) => el.bg(t.blocked + "22").text_color(t.blocked))
      .when(fill === "off", (el) => el.bg(t.raised).text_color(t.dim))
      .when(fill === "ghost", (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .child(icon === "spinner" ? svg("mods/workspace-chrome/spinner.svg").size(14).spin(900) : svg(icon).size(14));
    if (!fn) return el;
    return el.cursor_pointer().when(fill !== "ghost", (el) => el.hover((s) => s.opacity(0.85)))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); });
  }

  // The bottom row's left part, the same in a call and out of it: what the agent runs on (opens the picker; not during a call).
  pickParts(t, open) {
    const c = this.current();
    // Sized to its words, never cut: a narrow chat drops "· 1M" first.
    const model = String(c?.label ?? agent.modelName(c?.model) ?? "");
    const pick = [(this.width ?? 600) < 460 ? model.replace(/\s*·?\s*1M$/, "") : model, agent.levelName(c?.effort), c?.fast ? "Fast" : null].filter(Boolean).join(" · ") || agent.NAMES[this.kind] || "Agent";
    return [
      h_flex().id("chat-agent-pick").h(ROUND).pl(8).pr(5).gap(4).flex_none().items_center().rounded(6)
        .text_size(12).font_medium().text_color(t.muted)
        .when(open, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (e) => { this.pickAt = e.position; })
          .on_click((_e, cx) => { cx.stop_propagation(); this.openPicker(this.pickAt, cx); }))
        .child(div().flex_none().whitespace_nowrap().child(pick))
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none()),
    ].filter(Boolean);
  }

  // The live row a call and dictation share, 44 px, all on its midline: a round button on each
  // end, the wave across all the room there is, a word and the time.
  liveRow(t, id, left, word, dot, since, right) {
    const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
    return h_flex().id(id).w_full().h(44).flex_none().px(8).gap(12).items_center()
      .child(left)
      .child(this.wave(t, id))
      .child(h_flex().flex_none().gap(6).items_center()
        .when(dot, (el) => el.child(div().size(8).flex_none().rounded(4).bg(t.blocked)))
        .child(div().text_size(12.5).font_medium().text_color(t.foreground).child(word))
        // Digits of one width, so the time doesn't jiggle.
        .child(div().font_family(settings().font_family ?? "JetBrains Mono").text_size(12).text_color(t.dim)
          .child(elapsed(secs))))
      .child(right);
  }

  // The level wave: bars across the whole width (as many as fit, measured), the newest level
  // coming in on the right and moving left; a calm flat line while it's quiet.
  wave(t, id) {
    const n = Math.max(8, Math.floor(((this.waveW ?? 300) + WAVE_GAP) / (WAVE_BAR + WAVE_GAP)));
    const lv = (this.levels ?? []).slice(-n);
    const bars = [...Array(n - lv.length).fill(0), ...lv];
    // Quiet is one thin faint line across, behind the bars.
    return h_flex().id(`${id}-wave`).relative().flex_1().min_w(0).h(28).gap(WAVE_GAP).items_center().overflow_hidden()
      .on_size_change((size, cx) => { const w = unzoom(size.width); if (Math.abs((this.waveW ?? 0) - w) > 2) { this.waveW = w; cx.notify(); } })
      .child(div().absolute().left(0).right(0).top(13.5).h(1).bg(t.dim).opacity(0.3))
      .children(bars.map((v) => v < 0.04
        ? div().w(WAVE_BAR).h(1).flex_none()
        : div().w(WAVE_BAR).h(2 + Math.round(Math.min(1, v) * 26)).flex_none().rounded(2).bg(t.foreground)));
  }

  // The level loop for the wave, ten times a second while `on()` holds.

  // In a call the box is the call: Mute, the wave, what the call is doing and for how long, the
  // red X hangs up. M mutes while it has the keyboard.

  // The model button before the first message (loadChoice): the same menu, choosing what it starts on.
  freshPick(t, cx) {
    // A pick lands in this.choice.sel just after a render (settings.js applyReply), which then
    // redraws: a changed one is kept per slot here.
    const now = JSON.stringify(this.choice.sel);
    if (this.choice.saved !== undefined && now !== this.choice.saved && this.slot) try { localStorage.setItem(`choice:${this.slot}`, now); } catch {}
    this.choice.saved = now;
    return choices.modelButton(t, this.choice, {}, cx);
  }

  composer(t, st, cx = null) {
    // A thread whose worker ended: read-only now.
    if (this.thread && this.ended) return div().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(8)
      .child(h_flex().w_full().h(36).px(12).gap(8).items_center().rounded(10).border_1().border_color(t.border)
        .text_size(12.5).text_color(t.dim).child(div().size(6).flex_none().rounded(3).bg(t.dim)).child(div().flex_1().child(WORDS.ended))
        .when(Boolean(this.taskKey), (el) => el.child(this.button("chat-resume", this.resuming ? WORDS.resuming : "Resume",null, "primary", t, (cx) => this.resumeTask(cx)))));
    // An open card, or the agent's own dialog in its terminal, doesn't lock the box: words
    // written there answer it ("Reply instead…").
    const ready = this.phase === "ready" || this.phase === "fresh";
    const empty = !this.box.value().trim() && !this.files.length;
    const can = ready && !empty;
    const list = this.focused || this.paneFocused ? this.suggestions() : [];
    const rec = "idle";
    const recallable = !list.length && (!this.box.value() || this.recall >= 0);
    const take = (fn) => (_e, cx) => { fn(cx); cx.stop_propagation(); cx.notify(); };
    const sel = Math.min(this.slashSel, Math.max(0, list.length - 1));
    return div().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(8).child(v_flex().id("chat-composer").w_full().rounded(10).border_1()
      // Esc stops a working agent while the box is empty and nothing is open over it.
      .key_context([list.length ? "chat_slash" : recallable ? "chat_recall" : "chat_composer",
        st === "working" && !list.length && !this.box.value().trim() && !this.quote ? "chat_stop" : null].filter(Boolean).join(" "))
      .on_action("chat_stop", take((cx) => this.stop(cx)))
      .on_action("chat_slash_up", take(() => { this.slashSel = (sel + list.length - 1) % list.length; }))
      .on_action("chat_slash_down", take(() => { this.slashSel = (sel + 1) % list.length; }))
      .on_action("chat_slash_take", take((cx) => this.pick(list[sel], cx)))
      .on_action("chat_slash_close", take(() => { this.slashOff = this.box.value().replace(/\n+$/, ""); }))
      .on_action("chat_recall_up", take(() => this.recallStep(1)))
      .on_action("chat_recall_down", take(() => this.recallStep(-1)))
      .on_key_down((e, cx) => {
        const k = e.key, m = e.modifiers ?? {};
        // The "/" list: Up and Down choose, Tab or Enter takes one, Escape closes it.
        if (list.length) {
          const sel = Math.min(this.slashSel, list.length - 1);
          if (k === "down" || k === "up") { this.slashSel = (sel + (k === "down" ? 1 : list.length - 1)) % list.length; cx.stop_propagation(); cx.notify(); return; }
          if (k === "tab") { cx.stop_propagation(); this.pick(list[sel], cx); return; }
          if (k === "escape") { this.slashOff = this.box.value().replace(/\n+$/, ""); cx.stop_propagation(); cx.notify(); return; }
        }
        // Up in an empty box: earlier messages; Down: back again.
        if ((k === "up" && (!this.box.value() || this.recall >= 0)) || (k === "down" && this.recall >= 0)) {
          if (this.recallStep(k === "up" ? 1 : -1)) { cx.stop_propagation(); cx.notify(); }
          return;
        }
        if (k === "escape" && this.quote) { this.quote = null; cx.stop_propagation(); cx.notify(); return; }
        // Enter sends, before the textarea makes it a new line; Shift+Enter stays a new line.
        if (k !== "enter" || m.shift) return;
        cx.stop_propagation();
        this.enter(cx, Boolean(m.control || m.platform));
      })
      .on_drop((e, cx) => { this.addFiles(attach.paths(e.paths ?? [])); this.saveSoon(cx); this.box.focus(); cx.notify(); })
      // Where the box is in the window, for a typed /model's picker (modelCommand()).
      .on_mouse_move((e) => { if (e.bounds) this.composerAt = e.bounds; })
      .border_color(this.focused ? t.accent : t.input).bg(t.background)
      .child(this.slashList(t, list) ?? div())
      .child(this.tiles(t) ?? div())
      // The padding is around the textarea, not on it: its own height is then exactly its rows
      // (auto-grow, 1 to 8), so it never overflows itself by the padding, which showed a
      // scrollbar in an empty box and made it scroll a few pixels on each new line.
      .child(div().relative().w_full().min_h(TEXT_ROW).px(12).pt(9).pb(4)
        // Measured, unseen: a line's height, and the words' height at the box's width (sizeBox()).
        .child(div().id("chat-line-h").absolute().top(0).left(0).opacity(0).text_size(13).child("Xg")
          .on_size_change((size, cx) => { if (Math.abs((this.lineH ?? 0) - size.height) > 0.1) { this.lineH = size.height; this.sizeBox(); cx.notify(); } }))
        .child(div().absolute().top(0).left(12).right(12).h(0).overflow_hidden().opacity(0)
          .child(div().id("chat-text-h").w_full().text_size(13)
            .child(/\n$/.test(this.box.value()) || !this.box.value() ? `${this.box.value()} ` : this.box.value())
            .on_size_change((size, cx) => { if (Math.abs((this.textH ?? 0) - size.height) > 0.1) { this.textH = size.height; this.sizeBox(); cx.notify(); } })))
        .child(Textarea.new(this.box).w_full().text_size(13).text_color(t.foreground)
          .when(Boolean(this.boxSpare && this.lineH), (el) => el.mb(-this.lineH)))
        .when(!this.box.value().trim(), (el) => el.child(div().absolute().top(9).left(12).text_size(13).text_color(t.dim)
          .child(this.asks.length || st === "blocked" ? WORDS.replyInstead : this.placeholder()))))
      // 底部一行,右对齐:发送。Send 不变成 Stop:agent 工作时仍可发送(或排队);
      // Stop 在上方的工作状态行上。
      .when(rec === "idle", (el) => el.child(h_flex().h(36).pl(6).pr(6).gap(4).items_center().justify_end()
        // Attach on the left, as ChatGPT and Claude have it: the desktop's file picker.
        // 无附件按钮
        .when(Boolean(this.addr), (el) => el.children(this.pickParts(t, true)))
        .when(!this.addr && this.phase === "fresh" && Boolean(this.choice?.sel) && Boolean(cx), (el) => el.child(this.freshPick(t, cx)))
        // 精简:mic button removed (no recording)
 // Always Send: quiet with nothing to send, filled once there is. A call is with
 // herdr-winapp itself, from the top of the sidebar, never from a chat's box.
        .child(this.round("chat-send", "mods/chat/send.svg", t, can ? "solid" : "off", can ? (cx) => this.send(cx) : null)))));
  }

  // ---- alerts ---------------------------------------------------------------------------------

  // While its terminal is parked behind this chat, Herdr doesn't see the agent: no sound, no
  // toast. So this does what Herdr does: a sound when it needs the person, or finished while
  // they weren't looking, and a toast unless they're looking; and looking marks done as seen.
  alerts(cx) {
    const k = terminals().find((x) => x.address === this.addr);
    // An Assistant's chat on screen is read (unread.js): its space's row in the sidebar goes back to normal.
    if (!this.thread && unread(k) && onScreen(k)) markRead(k);
    const st = k?.status ?? null;
    const mine = this.myPane();
    const parked = Boolean(k) && !panes().some((p) => p.terminal === this.addr);
    const looking = Boolean(mine) && focused()?.pane === mine && window()?.active;
    if (parked && looking && st === "done") {
      const seen = shared("chat.seen") ?? {};
      if (seen[this.addr] !== k.turn) setShared("chat.seen", { ...seen, [this.addr]: k.turn });
    }
    const before = this.lastStatus;
    this.lastStatus = st;
    if (!parked || before === undefined || before === st || !mine) return;
    if (st !== "blocked" && !(st === "done" && !looking)) return;
    // An Assistant follows its space's Notify (notify.js): a new reply only on All, nothing on Off.
    if (assistant(k) && !notifies(k, st === "done" ? "message" : "need")) return;
    if (settings()?.sounds?.enabled !== false) playSound(st);
    if (looking) return;
    const tab = panes().find((p) => p.pane === mine)?.tab;
    toast({
      title: `${toastWho(k)} · ${st === "blocked" ? "Needs you" : "Finished"}`,
      body: (st === "blocked" ? this.asking() : null) ?? k.title ?? "",
      level: st === "blocked" ? "alert" : "success",
      action: tab ? { name: "tab.select", args: { id: tab } } : undefined,
    });
  }

  // This chat's own pane: the agent's core label herdr.chat (set by the pane-chat switch).
  // ---- artifacts (mods/artifacts) -----------------------------------------------------------

  // Which artifact each publish in the conversation made: the first version this agent
  // published from a few seconds before the call to five minutes after, not already taken.
  // Map item id -> { id, title, version (its latest), v (this publish's), latest }.
  resolveArts(items) {
    // core/chat-view.js: the web app's chat finds them the same way.
    return resolveArtifacts(items, this.arts, String(this.addr ?? "").split("/").pop());
  }

  // Every artifact on the agent's machine (~/.herdr/artifacts, one registry per folder): read
  // when the conversation has a publish, again every few seconds while one isn't listed yet.
  // A folder under a hidden one has a dot slug (~/.config/x: .config-x.json), so dot files
  // count too; locks end in .lock, temp files have no .json.
  loadArts(cx) {
    if (this.artsLoading || Date.now() - (this.artsAt ?? 0) < 3000) return;
    this.artsLoading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", SH + 'cd "$SHEP_ARTIFACTS" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && cat "$f" && printf "\\n\\036\\n"; done; true'], this.machine ? { on: this.machine } : {});
        const arts = [];
        for (const part of r.stdout.split("\x1e")) { try { arts.push(...(JSON.parse(part).artifacts ?? [])); } catch {} }
        this.arts = arts;
      } catch {}
      this.artsAt = Date.now();
      this.artsLoading = false;
      cx.notify();
    });
  }

  // An artifact over this chat pane, exactly like an opened image: the image viewer's shell (the
  // person's decision; Ctrl+K opens the same, artview.js). A "Published X v2" line opens v2; the
  // card, the latest.
  openArtifact(row) {
    openViewer({ id: row.art, title: row.title, version: row.line && row.v ? row.v : row.version, latest: row.version, machine: this.machine ?? null }, this.paneArea());
  }

  myPane() {
    if (!this.addr && this.role) return this.slotPane();
    // A thread's pane is the one its opener recorded for this worker (openThread()).
    if (this.thread) return threadOf(this.addr);
    const c = chatPane(terminals().find((x) => x.address === this.addr));
    if (c && panes().some((p) => p.pane === c && p.mod === "chat")) this.lastPane = c;
    return c || (this.swapping ? this.lastPane : null);
  }

  // One copy of Herdr's live lists for the whole render (live.js): a render past Herdr's 50 ms
  // is stopped, and the chat then shows "This view could not be re-rendered".
  // The message box gets the keyboard back when its pane does (opened, clicked, gone to), or after a notice; from
  // render, the focus itself from a timer right after.
  refocus(paneFocused, showsBox, cx) {
    // Focus moves only outside render: from a timer callback right after it.
    // Never while a dialog over it holds the keyboard (New space's field, #752): Herdr counts this pane focused under it.
    const dialog = dialogHolds(shared(KEY_HOLDER));
    if (paneFocused && showsBox && !dialog && (!this.wasFocused || !this.hadBox)) {
      cx.timer.after(0, () => { if (!dialogHolds(shared(KEY_HOLDER))) this.box.focus(); });
      cx.timer.after(600, () => { if (!dialogHolds(shared(KEY_HOLDER))) this.box.focus(); });
    }
    // The pane focused again (a command, a click on its header) can leave the box without the
    // keyboard: give it back, unless the person just pressed something inside the chat.
    // Not while the keyboard is somewhere else in the window that isn't a pane (#633): a task's chat, the list or its
    // search in the Tasks panel (shared "keyboard.holder", keyHolder()); Herdr still counts this pane as focused then.
    else if (paneFocused && showsBox && this.focused === false && Date.now() - (this.press?.at ?? 0) > 1500
      && !keysElsewhere(liveHolder(shared(KEY_HOLDER)), this.areaKey())
      && Date.now() - (this.refocusAt ?? 0) > 1000) {
      this.refocusAt = Date.now();
      cx.timer.after(0, () => this.box.focus());
    }
  }

  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    if (this.host) return this.host.render(cx);
    // The pane getting focus (opened, clicked, gone to) puts the keyboard in the message box.
    const mine = this.myPane();
    const paneFocused = Boolean(mine && focused()?.pane === mine);
    // Herdr settles pane focus a moment later, so ask again after it (as the help mod does).
    // The box also comes back after a notice (opening, restarting): it gets the keyboard then too.
    const showsBox = Boolean(this.addr) && this.phase === "ready";
    this.refocus(paneFocused, showsBox, cx);
    this.wasFocused = paneFocused;
    this.hadBox = showsBox;
    this.paneFocused = paneFocused;
    // 无通话监听
    // The model picker's Restart (mods/chat-models): shared "chat.restartreq" = { pane, at, pick }.
    const rr = shared("chat.restartreq"), pk = this.pickKey();
    if (rr && pk && rr.pane === pk && rr.at !== this.restartReqAt && Date.now() - rr.at < 5000) {
      this.restartReqAt = rr.at;
      cx.timer.after(0, (cx) => { this.applyPick(rr.pick, cx); cx.notify(); });
    }
    // The header's Terminal on a chat with no agent yet (pane-chat): start it, then show its
    // terminal. Shared "chat.startreq" = { pane, at }.
    const stq = shared("chat.startreq");
    if (stq && stq.pane === mine && stq.at !== this.startReqAt && Date.now() - stq.at < 5000 && this.phase === "fresh") {
      this.startReqAt = stq.at;
      cx.timer.after(0, (cx) => { this.startAgent(null, cx, true); });
    }
    // Another mod sending a message as if typed here: shared "chat.sendreq" = { pane, at, text }.
    const sq = shared("chat.sendreq");
    if (sq && sq.pane === mine && sq.at !== this.sendReqAt && Date.now() - sq.at < 5000 && String(sq.text ?? "").trim()) {
      this.sendReqAt = sq.at;
      cx.timer.after(0, (cx) => { this.deliver({ id: `m${Date.now()}`, text: String(sq.text).trim(), files: [], quote: null }, cx); this.pinned = true; this.stick = true; cx.notify(); });
    }
    // Words put in the box for the person to send (the Inbox's "Merge HAT-1"): shared
    // "chat.prefillreq" = { pane, at, text }. What they had typed stays, below.
    const pq = shared("chat.prefillreq");
    if (pq && pq.pane === mine && pq.at !== this.prefillReqAt && Date.now() - pq.at < 10000 && String(pq.text ?? "").trim()) {
      this.prefillReqAt = pq.at;
      cx.timer.after(0, () => {
        const had = this.box.value().trim();
        this.box.set_value(had && !had.startsWith(pq.text) ? `${pq.text}\n\n${had}` : had || String(pq.text));
        this.box.focus();
      });
    }
    // The emoji row's pick (mods/chat-react): shared "chat.reactreq" = { pane, at, target, text, emoji }.
    // A thread asked for (the Tasks panel, the Inbox): shared "chat.threadreq" = { terminal,
    // task, title, space, at }; the coordinator chat in that space opens it.
    const tq = shared("chat.threadreq");
    if (tq && tq.at !== this.threadReqAt && Date.now() - tq.at < 5000 && this.role === "coordinator" && mine) {
      const tab = panes().find((p) => p.pane === mine)?.tab;
      const space = spaces().find((x) => x.tabs.some((t) => t.id === tab))?.id;
      // A worker runs as its coordinator's hc child, with no space of its own: its parent's chat
      // takes it; one whose parent shows no chat goes to the coordinator of the space asked.
      const parent = terminals().find((k) => k.address === tq.terminal)?.parent ?? null;
      const pc = parent && chatPane(terminals().find((k) => k.address === parent));
      const parentChat = Boolean(pc) && panes().some((p) => p.pane === pc && p.mod === "chat");
      if (parent === this.addr || (!parentChat && (!tq.space || tq.space === space))) {
        this.threadReqAt = tq.at;
        setShared("chat.threadack", tq.at);
        cx.timer.after(0, () => this.openThread(tq));
      }
    }
    const rq = shared("chat.reactreq");
    if (rq && rq.pane === mine && rq.at !== this.reactReqAt && Date.now() - rq.at < 5000) {
      this.reactReqAt = rq.at;
      cx.timer.after(0, (cx) => { this.toggleReaction(rq.target, rq.text, rq.emoji, cx); });
    }
    // In a call, the call takes the keyboard when the pane does.
    this.alerts(cx);
    const t = theme();
    const st = this.status() ?? null;
    if (st === "working" && this.lastWorking !== "working") this.workingSince = Date.now();
    if (st !== "working") this.stopping = false;
    this.lastWorking = st;
    const root = v_flex().id("chat").size_full().bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => {
        this.paneSize(size);
        if (this.pinned) this.stick = true;
        this.noteArea(null);
        cx.notify();
      })
      .on_mouse_move((e) => { if (e.bounds) this.noteArea(e.bounds); })
      // Where a press was, for the action buttons under messages (rows can't take handlers).
      .on_mouse_down("left", (e) => { this.notePress(e); holdKeys(this.areaKey()); this.pressWin = e.position; this.keepIcons = null; if (e.bounds) this.noteArea(e.bounds); })
      // Files dropped anywhere on the chat go with the next message.
      .on_drop((e, cx) => { this.addFiles(attach.paths(e.paths ?? [])); this.saveSoon(cx); this.box.focus(); cx.notify(); });

    // Starting (or the new agent's log not there yet): the person's message shows at once.
    const starting = (this.phase === "starting" || (this.phase === "finding" && this.role && !this.path)) && this.pending.length > 0;
    if (this.phase === "fresh") {
      return root.child(this.fresh(t)).child(this.composer(t, null, cx)).child(div().flex_none().h(12));
    }
    if (!this.addr && !starting) return root.child(this.notice(t, WORDS.noAgent, WORDS.noAgentBody, [
      this.button("chat-close", "Close", null, "secondary", t, () => this.closeSelf())]));
    // A thread whose worker ended before its conversation was read: the same quiet words.
    if (this.phase === "ended" && this.thread) return root.child(this.notice(t, WORDS.taskEnded, null, [
      ...(this.taskKey ? [this.button("chat-resume", this.resuming ? WORDS.resuming : "Resume",null, "primary", t, (cx) => this.resumeTask(cx))] : []),
      this.button("chat-close", this.inner ? "返回任务" : "Close", null, "secondary", t, () => this.closeSelf())]));
    if (this.phase === "ended" && !this.swapping) return root.child(this.notice(t, WORDS.agentEnded, null, [
      this.button("chat-close", "关闭对话", null, "secondary", t, () => this.closeSelf())]));
    const open = this.button("chat-open-terminal", WORDS.openTerminal,"mods/workspace-chrome/terminal.svg", "primary", t, () => this.toTerminal());
    if (this.phase === "unsupported") return root.child(this.notice(t, WORDS.unsupported, WORDS.unsupportedBody, [open]));
    if (this.phase === "none") return root.child(this.notice(t, WORDS.notFound, WORDS.notFoundBody, [open]));
    if ((this.phase === "finding" && !starting) || this.phase === "ended") return root.child(this.notice(t, this.swapping ? WORDS.restarting : WORDS.opening, null));

    this.sizeBox();
    // An Assistant's chat: its tasks' workers' asks, before the rows (their live rows say so).
    this.wasks = this.workerAsks(cx);
    const rows = this.rows();
    // First-seen times this render found (seenAt()), shared once it's done; the newest 60 kept.
    if (this.seenNew && !this.seenFlush) {
      this.seenFlush = true;
      cx.timer.after(0, () => {
        const all = { ...(shared("chat.cardseen") ?? {}), ...this.seenNew };
        this.seenNew = null; this.seenFlush = false;
        setShared("chat.cardseen", Object.fromEntries(Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 60)));
      });
    }
    // A publish the registry doesn't list yet: read it again in a few seconds.
    if (rows.some((r) => r.kind === "artifact" && r.pending) || (this.conv?.items ?? []).some((x) => x.kind === "artifact") && !this.arts) {
      this.loadArts(cx);
      if (!this.artsTick) { this.artsTick = true; cx.timer.after(3500, (cx) => { this.artsTick = false; cx.notify(); }); }
    }
    // Find: the current match's row comes into view once per step.
    const found = this.finding ? this.findMatches(rows) : [];
    const current = found.length ? this.findRow(found) : null;
    if (this.findJump && current) { this.findJump = false; this.pinned = false; this.scroll.scroll_to_item(current.index, "center"); }
    const lit = new Set(found.map((m) => m.id));
    this.needViews([...this.files.filter((f) => f.image).map((f) => f.path), ...rows.flatMap((r) => (r.kind === "imgs" ? r.paths : r.kind === "artifact" && r.peek ? r.peek.paths : []))], cx);
    this.needPeeks(rows, cx);
    // What sits under the list (an ask card, the working line) changes its height: stay on the newest.
    const below = `${this.asks.length}|${this.sasks.map((a) => a.name + (a.kept ? "+" : "")).join(",")}|${this.wasks.map((a) => a.id).join(",")}|${[this.addr, ...this.workerTasks().keys()].map((a) => openCard(a)?.id ?? "").join("")}|${st}|${this.focused}|${this.queue.length}|${this.files.length}|${Boolean(this.quote)}`;
    if (below !== this.below) { this.below = below; if (this.pinned) this.stick = true; }
    if (Math.abs(this.heightsFor - this.width) > 1 || (this.heightsZoom ?? 1) !== zoomOf()) {
      this.heights.clear(); this.measuredAt.clear(); this.heightsFor = this.width; this.heightsZoom = zoomOf(); this.measureGen++;
    }
    const keys = rows.map((x) => this.key(x));
    // Every size a real number of pixels: one NaN, zero or runaway height leaves the list blank.
    const sizes = rows.map((x, i) => {
      const h = this.heights.get(keys[i]) ?? this.guess(x);
      return Number.isFinite(h) && h > 0 ? Math.min(h, 40000) : 60;
    });
    this.follow_bottom(rows);
    // Following the newest, the list sits at its end: the scroll position is exactly that.
    if (this.pinned && this.listH) this.scrollTop = Math.max(0, sizes.reduce((a, b) => a + b, 0) - (this.listH - 8));
    const body = rows.length === 0
      ? this.notice(t, "没有消息", "在下方写给 agent。")
      : v_flex().relative().flex_1().min_h(0).pt(8)
        .id("chat-body")
        .on_size_change((size, cx) => {
          const was = this.listH, h = unzoom(size.height);
          this.listH = h;
          if (was && Math.abs(was - h) > 0.5 && this.pinned) { this.stick = true; cx.notify(); }
        })
        // How far down the list a press was, for the action bands (rows take no handlers).
        .on_mouse_down("left", (e) => { this.bodyPress = unzoom(e.local_position?.y); })
        // Rows' hover styles show on a redraw: one per 6 px the pointer moves down or up.
        .on_mouse_move((e, cx) => {
          const b = Math.floor(unzoom(e.local_position?.y ?? 0) / 6);
          if (b !== this.hoverBand) { this.hoverBand = b; cx.notify(); }
        })
        .on_hover((hovered, cx) => { if (!hovered) { this.hoverBand = null; cx.notify(); } })
        .on_scroll_wheel((e, cx) => {
          const y = e.delta?.y ?? 0;
          // Where the list is scrolled to, as near as known (the list doesn't say): wheel moves it.
          this.scrollTop = Math.max(0, (this.scrollTop ?? 0) - y);
          // Scrolling up to read stops following the newest; back at the bottom follows again.
          if (y > 0 && this.pinned) { this.pinned = false; cx.notify(); }
          if (y < 0 && !this.pinned && this.range && this.range.end >= rows.length) { this.pinned = true; cx.notify(); }
          if (y > 0 && (this.range?.start ?? 9) <= 1) this.loadEarlier(cx);
        })
        .child(v_virtual_list("chat-rows", rows.length, sizes, (i) => rows[i].id, (range) => {
          this.range = range;
          if (rows.length && !(range.end > range.start)) this.blank = true;
          // The first row on screen bounds the scroll position: keep the estimate inside it.
          const top = sizes.slice(0, range.start).reduce((a, b) => a + b, 0);
          if ((this.scrollTop ?? 0) < top || (this.scrollTop ?? 0) >= top + (sizes[range.start] ?? 0)) this.scrollTop = top;
          return rows.slice(range.start, range.end).map((x, j) => {
            const flash = this.flash && (x.id === this.flash.id || String(x.id).startsWith(`${this.flash.id}:`));
            return div().relative().w_full().h(sizes[range.start + j]).when(!x.bar || x.kind === "band", (el) => el.overflow_hidden())
              // Find: rows with matches tinted, the current one more.
              .when(lit.has(x.id), (el) => el.child(div().absolute().inset_0().rounded(10).bg(t.accent + (current?.id === x.id ? "38" : "14"))))
              // Ids carry the width's generation, as the measurer's do: a reply's words keep the
              // width they were first laid out at, so after a resize (a restart's first narrow
              // frames) they'd stay narrow and tall, spilling under the next row.
              .child(this.row(x, t, `v${this.measureGen}-`))
              .when(Boolean(flash), (el) => el.child(div().id(`flash-${x.id}`).absolute().inset_0().rounded(10).bg(t.accent + "26")
                .opacity(this.flash.on ? 1 : 0).transition("opacity", { duration: 1100, easing: "ease-out" })));
          });
        })
          .track_scroll(this.scroll).size_full()
          .on_item_click((key, cx) => this.clickRow(key, rows, cx, sizes)))
        .child(Scrollbar.vertical("chat-rows").absolute().inset_0())
        .child(this.measurer(rows, keys, t))
        // Cards' controls measured (strips.js hit()), and where question cards' keys come in.
        .child(strips.measure(t, rows.filter((r) => r.kind === "cardstrip").map((r) => r.s), this.cardW, (cx) => cx.notify(), unzoom)
          .child(div().id("mw-accept").flex_none().on_size_change((size, cx) => { const w = unzoom(size.width); if (this.cardW.get("accept") !== w) { this.cardW.set("accept", w); cx.notify(); } })
            .child(this.acceptButton(false))))
        .child(this.cards.sink("own")).child(this.workerCards.sink("worker"))
        .when(!this.pinned, (el) => {
          // Scrolled up: a card waiting below what's shown is pointed to; else the newest.
          const below = rows.map((r, i) => (r.kind === "cardstrip" && r.first && i >= (this.range?.end ?? rows.length) ? i : -1)).filter((i) => i >= 0);
          const label = questionsBelow(below.length);
          return el.child(h_flex().absolute().bottom(10).left(0).right(0).justify_center()
            .child(h_flex().id("chat-latest").h(26).px(10).gap(5).items_center().rounded(13).cursor_pointer()
              .bg(t.popover).border_1().border_color(t.border).shadow_md().text_size(12).text_color(t.muted)
              .hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => {
                if (below.length) this.scroll.scroll_to_item(below[0], "center");
                else { this.pinned = true; this.stick = true; }
                cx.notify();
              })
              .when(below.length > 0, (el) => el.child(div().size(6).flex_none().rounded(3).bg(red())))
              .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none()).child(label)));
        });
    return root
      .when(this.finding, (el) => el.child(this.findBar(t, rows)))
      .child(body)
      .when(Boolean(this.error), (el) => el.child(div().flex_none().px(18).py(4).text_size(12).text_color(t.blocked).truncate().child(this.error)))
      .child(this.statusLine(t, st) ?? div())
      .child(this.queued(t) ?? div())
      .child(this.background(t, st, cx) ?? div())
      .child(this.composer(t, st))
      .child(div().flex_none().h(12));
  }

  // Rows not measured yet, drawn once out of sight at the list's width; their heights go to
  // the list, which then places every row exactly. Those near what is shown go first.
  measurer(rows, keys, t) {
    const near = this.anchor && Date.now() < this.anchor.until
      ? Math.max(0, rows.findIndex((r) => r.id === this.anchor.id))
      : this.range ? this.range.start : rows.length - 1;
    // Rows never measured, nearest first; and, measured again, the rows on screen and those
    // measured in the last few seconds: markdown can lay out a moment after its first frame (a
    // long message first measures as one line), so a height is never taken once and kept.
    const now = Date.now();
    const lo = Math.max(0, (this.range?.start ?? rows.length) - 2), hi = Math.min(rows.length, (this.range?.end ?? 0) + 2);
    const fresh = rows.map((_, i) => i).filter((i) => !this.heights.has(keys[i]))
      .sort((a, b) => Math.abs(a - near) - Math.abs(b - near)).slice(0, 30);
    const again = rows.map((_, i) => i).filter((i) => this.heights.has(keys[i]) && ((i >= lo && i < hi) || now - (this.measuredAt.get(keys[i]) ?? 0) < 4000));
    const order = [...new Set([...fresh, ...again])].slice(0, 60);
    return div().absolute().top(0).left(0).w(this.width).h(0).overflow_hidden().opacity(0)
      .child(v_flex().w_full().children(order.map((i) => div().id(`m${this.measureGen}-${keys[i]}`).flex_none().w_full()
        .on_size_change((size, cx) => {
          if (!this.measuredAt.has(keys[i])) this.measuredAt.set(keys[i], Date.now());
          const h = unzoom(size.height);
          if (this.heights.get(keys[i]) === h) return;
          this.heights.set(keys[i], h);
          if (this.pinned) this.stick = true;
          if (this.anchor && Date.now() < this.anchor.until) this.reanchor = true;
          cx.notify();
        })
        // Its words' ids carry the width's generation too, as the list's rows do: kept from an older width, a
        // reply measured at the wrap it first had there (shorter or taller than drawn: the next row over it, #775).
        .child(this.row(rows[i], t, `m${this.measureGen}-`)))));
  }
}
