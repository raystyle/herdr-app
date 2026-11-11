// Shared core:源文件为 core/screens.js;bin/sync-shared 复制进 mods/chat/core/。请在此处编辑。
// CLI 会话开始前自己的界面(信任此文件夹、主题、登录、更新提示,以及后续版本可能加入的任何
// 版本新增的),从 agent 屏幕读取为带选项的卡片,窗口的聊天以同样方式监视
// (mods/chat/screens.js,其卡片存于 shared "chat.screens"),service 端为 web app 生成(service/screens.ts)。
// 没有 hook 上报这些,因此靠读取屏幕:相隔一次轮询的两次一致读取即弹出卡片,且在
// 选项会在终端里按下,且仅当屏幕仍显示卡片所依据的内容。屏幕
// 无可选择就不出卡片(可能是启动缓慢),除非之前已有卡片且本张带链接(
// 登录)。已上报状态(其会话已启动)或已执行回合的 agent 不再显示。
// 卡片:{ id, addr, cli, words, choices: [{ label, description? }], at (光标处的选项), all (screenText),
// 最近查看(sameScreen)、state:"open" | "answered" | "closed"、结束方式、opened、changed }。

// // ---- 读取屏幕 ------------------------------------------------------------------------

const MARKER = /^(\s*[❯›▶►➤→>]\s+)(.*)$/u;
const TICK = /^[✔✓]\s+/u;
const NUMBER = /^\d{1,2}[.)]\s+/;
const ENTER = /press enter|enter to continue/i;
const MOST_WORDS = 8;
// 常用 Braille spinner 或 Claude Code 的动画的一帧,置于行首,可带框可不带。
const SPINNER = /^([\s│┃]*)[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✢✳✶✻✽](?=\s|$)/u;

// 框线转成空格,使各列保持在 CLI 绘制的位置。
const cleaned = (text) => String(text ?? "").split("\n").map((line) => line.replace(/[│┃]/g, " ").trimEnd());
const indent = (line) => line.length - line.trimStart().length;
// 文字,而非 logo、分隔线或 spinner。
const wordy = (line) => { const text = line.replace(/\s/g, ""); return text.length > 2 && [...text.matchAll(/\p{L}/gu)].length * 2 > text.length; };

function optionAt(line, index, numbered, column) {
  const mark = line.match(MARKER), text = mark ? mark[2] : line.trimStart(), tick = text.match(TICK)?.[0] ?? "";
  const label = text.slice(tick.length), at = (mark ? mark[1].length : indent(line)) + tick.length;
  if (at !== column || numbered !== NUMBER.test(label)) return undefined;
  return { line: index, column: at, label: label.replace(NUMBER, "").replace(/\s{2,}/g, " · ") };
}

function menuAt(lines, line) {
  const mark = lines[line].match(MARKER);
  if (!mark) return undefined;
  const tick = mark[2].match(TICK)?.[0] ?? "", numbered = NUMBER.test(mark[2].slice(tick.length)), column = mark[1].length + tick.length;
  // 编号菜单的选项可能分布稀疏;普通菜单止于首个空行。
  const walk = (step) => {
    let end = line;
    for (let at = line + step, blanks = 0; at >= 0 && at < lines.length; at += step) {
      if (!lines[at]) { if (!numbered || ++blanks > 1) break; continue; }
      blanks = 0;
      if (optionAt(lines[at], at, numbered, column)) end = at;
      else if (indent(lines[at]) <= column) break;
      else if (step > 0) end = at;
    }
    return end;
  };
  const top = walk(-1), bottom = walk(1), options = [];
  for (let at = top; at <= bottom; at++) {
    const option = optionAt(lines[at], at, numbered, column);
    if (option) options.push({ label: option.label, line: at });
    else if (lines[at] && options.length) options[options.length - 1].description = [options[options.length - 1].description, lines[at].trim()].filter(Boolean).join(" ");
  }
  return options.length > 1 ? { top, options, current: options.findIndex((o) => o.line === line) } : undefined;
}

// 正上方的文字:退回 logo 或分隔线,或留一大段空白。
function wordsAbove(lines, end, most) {
  const words = [];
  for (let at = end - 1, blanks = 0; at >= 0 && words.filter(Boolean).length < most; at--) {
    if (!lines[at]) { if (++blanks > 1 && words.length) break; continue; }
    if (!wordy(lines[at])) { if (words.length) break; blanks = 0; continue; }
    if (blanks && words.length) words.unshift("");
    blanks = 0;
    words.unshift(lines[at].trim());
  }
  return words.join("\n").trim();
}

// 链接在屏幕边缘处换行但保持完整,不受其他因素挤占文字的影响。
function links(lines, width, words) {
  const found = lines.flatMap((line, at) => {
    if (!/https?:\/\// .test(line)) return [];
    let link = line.slice(line.search(/https?:\/\// )), end = at;
    while (lines[end].length >= width && lines[end + 1]) link += lines[++end];
    return [link.split(/\s/)[0]];
  });
  return [...new Set(found)].filter((link) => !words.includes(link));
}
const withLinks = (words, lines, width) => [words, ...links(lines, width, words)].filter(Boolean).join("\n\n");

// 屏幕最下方的菜单,因为它是当前生效的那个:一行带有 CLI 光标标记且至少含一个
// 旁边的兄弟元素。
function cursorLine(lines) {
  for (let i = lines.length - 1; i >= 0; i--) if (menuAt(lines, i)) return i;
  return -1;
}

// { words, choices: [{ label, description? }] 按屏幕顺序,at:光标所在选项 }。
export function readScreen(text, width = Infinity) {
  const lines = cleaned(text), line = cursorLine(lines);
  if (line >= 0) {
    const menu = menuAt(lines, line);
    return { words: withLinks(wordsAbove(lines, menu.top, MOST_WORDS), lines.slice(0, menu.top), width),
      choices: menu.options.map(({ label, description }) => ({ label, ...(description ? { description } : {}) })), at: menu.current };
  }
  let enter = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (ENTER.test(lines[i])) { enter = i; break; }
  return { words: withLinks(wordsAbove(lines, enter >= 0 ? enter : lines.length, MOST_WORDS), lines, width), choices: enter >= 0 ? [{ label: "Continue" }] : [], at: 0 };
}

// 仅取字母,这样带计时器的屏幕也能稳定到足以显示。
export const sameScreen = (text) => cleaned(text).join(" ").replace(/[^\p{L}]+/gu, " ").trim();
// 屏幕原样呈现,除动画外文字一字不动:菜单光标与 spinner 的帧。一
// 按下时需与此项绘制时的数据一致。
export function screenText(text) {
  const lines = String(text ?? "").split("\n"), plain = cleaned(text), cursor = cursorLine(plain);
  if (cursor >= 0) { const mark = plain[cursor].search(/\S/); lines[cursor] = `${lines[cursor].slice(0, mark)} ${lines[cursor].slice(mark + 1)}`; }
  return lines.map((line) => line.replace(SPINNER, "$1 ").trimEnd()).join("\n");
}
// 在光标与选项之间移动并确认选择的按键。
export const pressKeys = (at, choice) => [...Array(Math.abs(choice - at)).fill(choice < at ? "up" : "down"), "enter"];

// // ---- 监视启动中的 agent ---------------------------------------------------------

const FIRST_LOOK = 6000;  // 这么年轻的 agent 可能只是启动慢
const RETRY = 10000;      // 被按过的选项在离开屏幕后这么长时间内不再询问
export const KEEP = 6;    // 已关闭卡片按 agent 保存(用于其淡色提示行)
export const CLI = { claude: "Claude Code", codex: "Codex" };

// 终端运行的是哪个 CLI:由其报告或程序判断 { claude | codex },否则 null。
export function cliOf(k) {
  const a = String(k?.status?.app ?? k?.agent ?? k?.foreground?.name ?? "");
  return /^claude/.test(a) ? "claude" : /^codex/.test(a) ? "codex" : null;
}

// 仍在其 session 之前:存活、未报告状态、未进行轮次。(hc ls 的 `status` 是报告中的状态词,
// 或 null。)
export function starting(k) {
  const st = typeof k?.status === "string" ? k.status : k?.status?.state ?? null;
  return Boolean(k) && k.state === "live" && !st && !(k.turn > 0) && Boolean(cliOf(k));
}

// 启动屏卡片上的文字:标题、按键结果、结束方式。
export const SCREEN = {
  title: (cli) => `${cli} is waiting on its screen`,
  answered: (label) => `Answered: ${label}`,
  inTerminal: "已在终端里回答",
  stopped: "agent 已停止",
  changed: "屏幕变了",
  gone: "此屏幕不再等待。",
  changedNothing: "屏幕变了,所以什么都没按。",
  failed: "没有成功。",
  ended: (cli, how) => `${cli}'s start screen · ${how}`,
};

// 监控 agent 屏幕:每个聊天副本(窗口端)一个,或 web 应用共用一个(服务端)。io: { hc(args)
// -> { code, stdout },cards(addr) -> [card],save(addr, list) }。agent 运行期间每几秒 tick(addr, k) 一次
// 正在启动;它通过 onPost 报告何时挂出新卡片,供提醒使用。
export class ScreenWatch {
  constructor(io, onPost) {
    this.io = io;
    this.onPost = onPost;
    this.last = new Map();
    this.looking = new Set();
    this.pressing = new Set();
  }

  open(addr) { const c = this.io.cards(addr).at(-1); return c?.state === "open" ? c : null; }
  update(card, change) { this.io.save(card.addr, this.io.cards(card.addr).map((c) => (c.id === card.id ? { ...c, ...change, changed: Date.now() } : c))); }
  // 卡片未经点击就消失:`how` 说明原因。
  close(card, how) { this.update(card, { state: "closed", how }); }

  // k:hc get 返回的 terminal(created_ms、cols)或实时列表条目。
  async tick(addr, k, now = Date.now()) {
    const was = this.open(addr);
    if (!starting(k)) {
      this.last.delete(addr);
      // 其 session 已启动(有报告或进行了一轮),或已结束:卡片的等待结束。
      if (was) this.close(was, k?.state === "live" ? SCREEN.inTerminal : SCREEN.stopped);
      return;
    }
    if (this.looking.has(addr) || this.pressing.has(addr)) return;
    this.looking.add(addr);
    try {
      // 实时列表不含开始时间与宽度:hc get 才有。
      if (k.created_ms === undefined) { try { k = { ...JSON.parse((await this.io.hc(["get", addr, "--json"])).stdout || "{}"), ...k }; } catch {} }
      if (k.created_ms && now - k.created_ms < FIRST_LOOK) return;
      const r = await this.io.hc(["read", addr]);
      if (r.code !== 0) return;
      const text = r.stdout ?? "";
      const seen = sameScreen(text), all = screenText(text), { words, choices, at } = readScreen(text, k.cols ?? Infinity);
      const shown = JSON.stringify([all, choices]);
      const before = this.last.get(addr);
      this.last.set(addr, { seen, shown });
      if (before?.seen !== seen) return; // 仍在移动
      const cards = this.io.cards(addr), last = cards.at(-1);
      const open = last?.state === "open" && last.seen === seen ? last : null;
      // 同一屏幕但代码或编号已变:算作新卡片,这样对旧卡片的按键不会落到它已
      // 没有显示。
      if (open && before.shown === shown && JSON.stringify([open.all, open.choices]) !== shown) { this.close(open, SCREEN.changed); this.post(addr, k, { seen, all, words, choices, at }); return; }
      if (open || cards.some((c) => c.seen === seen && now - (c.changed ?? c.opened) < RETRY)) return;
      if (last?.state === "open") this.close(last, SCREEN.inTerminal);
      if (!choices.length && !(words && cards.length && /https?:\/\// .test(text))) return;
      this.post(addr, k, { seen, all, words, choices, at });
    } finally {
      this.looking.delete(addr);
    }
  }

  post(addr, k, s) {
    const card = { id: `scr-${addr}-${Date.now()}`, addr, cli: CLI[cliOf(k)] ?? "agent", ...s, state: "open", opened: Date.now() };
    this.io.save(addr, [...this.io.cards(addr), card].slice(-KEEP));
    this.onPost?.(card);
  }

  // 点击选项:只在卡片绘制自的那块屏幕上生效。以错误文字 resolve,或
  // 已按下。
  async press(card, choice) {
    if (this.pressing.has(card.addr)) return null;
    const now = this.open(card.addr);
    if (!now || now.id !== card.id) return SCREEN.gone;
    this.pressing.add(card.addr);
    try {
      const r = await this.io.hc(["read", card.addr]);
      const s = r.code === 0 ? readScreen(r.stdout, Infinity) : null;
      if (!s || screenText(r.stdout) !== card.all || JSON.stringify(s.choices) !== JSON.stringify(card.choices)) {
        this.close(card, SCREEN.changed);
        return SCREEN.changedNothing;
      }
      const k = await this.io.hc(["keys", card.addr, ...pressKeys(s.at, choice)]);
      if (k.code !== 0) return SCREEN.failed;
      this.update(card, { state: "answered", how: SCREEN.answered(card.choices[choice].label) });
      this.last.delete(card.addr);
      return null;
    } finally {
      this.pressing.delete(card.addr);
    }
  }
}
