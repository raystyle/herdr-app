// 把用户的话发给 agent,窗口聊天与 web app 走同一条路:
// Herdr 加在其前的标签行(所回复的消息、提及的任务),再 hc send。当
// agent 在其 terminal 中被自身对话框阻塞(提问、权限)时,Esc 关闭它,文字发出
// 作为消息("Reply instead…")。Claude Code 会扣住轮次中途输入的消息直到该轮结束:其自带
// "send now"(Ctrl+Enter)让它立即转向(DECISIONS:除非用户要求,消息绝不暂存)。
// io = { hc(args) -> Promise<{ code, stdout, stderr }>, sleep(ms), status() -> agent 当前状态 }。
// Shared core:源文件为 core/send.js;bin/sync-shared 会把它复制进 lib/COPIES 中的各 mod。

import { excerpt } from "./chat-log.js";

// hc 的拒绝及说明:{ kind(“blocked” 表示其自身对话框已打开), message }。
export function refusal(r) {
  const text = String(r?.stderr || r?.stdout || "").trim();
  try { const e = JSON.parse(text).error; if (e?.message) return { kind: e.kind ?? null, message: e.message }; } catch {}
  return { kind: /"kind":"blocked"/.test(text) ? "blocked" : null, message: text || "It didn't go through." };
}

const attr = (v) => String(v ?? "").replace(/\s*\n\s*/g, " ").replace(/"/g, "”");

// A mentioned task's tag line: <hc task=… title=… state=… folder=…>its prompt</hc>.
export function taskTag(x, ref) {
  return `<hc task="${attr(ref.replace(/^#/, ""))}" title="${attr(x.title)}" state="${attr(x.status_text ?? x.state)}"${x.why ? ` why="${attr(x.why)}"` : ""} folder="${attr(x.folder)}">${String(x.prompt ?? "").slice(0, 500)}</hc>\n`;
}

// The tasks a message mentions: HAT-1 as written (or #HAT-1, @HAT-1 and a picked [@HAT-1](task:…), core/mentions.js); a
// task without a prefix only as, never a bare number.
// tasks: [{ ref, id, ... }] (the chat's folder's).
export function mentionedIn(text, tasks) {
  const t = String(text ?? ""), low = t.toLowerCase();
  return (tasks ?? []).filter((x) => {
    if (!low.includes(String(x.ref ? x.ref : `#${x.id}`).toLowerCase())) return false;
    const ref = x.ref ? `[#@]?${String(x.ref).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` : `#${x.id}`;
    return new RegExp(`(^|[\\s([])${ref}\\b`, "i").test(t);
  });
}

// The words as the agent gets them: the reply tag, the task tags, then the person's text.
export function messageBody({ text, quote = null, tags = "" }) {
  const reply = quote ? `<hc reply-to="${excerpt(quote, 80)}"/>\n` : "";
  return reply + tags + text;
}

// The agent waits on its own dialog: Esc closes it, then the words go once it takes typing again.
export async function replyInstead(io, addr, text) {
  await io.hc(["keys", addr, "esc"]);
  let r;
  for (let i = 0; i < 10; i++) {
    await io.sleep(300);
    r = await io.hc(["send", addr, text]);
    if (r.code === 0 || refusal(r).kind !== "blocked") break;
  }
  return r;
}

// Claude Code's "send now" for a message it queued while working: Ctrl+Enter, only when its screen offers it
// (pressed on an empty prompt it would do something else). Also a queued message's own Send now (#662), for one left
// in its queue when the screen didn't offer it in time. -> whether it was pressed.
export async function steerNow(io, addr) {
  for (let i = 0; i < 4; i++) {
    await io.sleep(i ? 300 : 150);
    const r = await io.hc(["read", addr, "--lines", "40"]).catch(() => null);
    if (/ctrl\+enter to send now/i.test(r?.stdout ?? "")) { await io.hc(["keys", addr, "ctrl+enter"]); return true; }
    if (io.status() !== "working") return false;
  }
  return false;
}

// A picture's path on a line of its own, as a sent file goes after the words.
const PICTURE = /^[/~]\S*\.(png|jpe?g|gif|webp|bmp|heic)$/im;

// Claude Code's input box: the last line of its screen starting with its prompt mark, right under the box's top rule
// (a past message in the conversation has the same mark, never the rule over it; a dialog shows no box at all).
export function inputLine(screen) {
  const lines = String(screen ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("❯")) continue;
    return /^\s*─/.test(lines[i - 1] ?? "") ? lines[i].trim() : null;
  }
  return null;
}

// The words a message shows in Claude Code's box by: its first line that isn't a sent file's path or a tag line (a
// picture becomes "[Image]", a long paste "[Pasted text +12 lines]").
function wordsLine(body) {
  const lines = String(body ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  // files alone (no words): its first file's path, as typed (a picture shows as its marker instead)
  return lines.find((l) => !/^[/~]\S+$/.test(l) && !/^<hc\b/.test(l)) ?? lines.find((l) => !/^<hc\b/.test(l) && !PICTURE_LINE.test(l)) ?? "";
}
const PICTURE_LINE = /^[/~]\S*\.(png|jpe?g|gif|webp|bmp|heic)$/i;
const MARKS = /\[(Image|Pasted text) #\d+[^\]]*\]/g;

// Claude Code's box still holds this message, not taken in: its first words in it, or a picture or paste marker (just
// typed by this send, so the box is its own). exact: only this very message (its words line and markers, nothing
// else), for one sent again after it stayed in the box.
export function holds(box, body, exact = false) {
  const rest = String(box ?? "").replace(/^❯\s?/, "").trim();
  if (!rest) return false;
  const words = wordsLine(body);
  if (exact) {
    const bare = rest.replace(MARKS, " ").replace(/\s+/g, " ").trim();
    return bare === words.replace(/\s+/g, " ") || (!bare && /\[(Image|Pasted text) #\d+/.test(rest));
  }
  if (words && rest.includes(words.slice(0, 24))) return true;
  return /\[(Image|Pasted text) #\d+/.test(rest);
}

// Claude Code's box: its line (null: no box on screen, a dialog), or undefined when the screen couldn't be read
async function boxOf(io, addr) {
  const r = await io.hc(["read", addr, "--lines", "0"]).catch(() => null);
  if (!r || r.code !== 0) return undefined;
  return inputLine(r.stdout);
}

// How long a message may sit in Claude Code's box after hc send before it counts as stuck, and how many Enters it gets.
export const SETTLE = { looks: 40, every: 400, enters: 4 };

// After hc send: Claude Code reads the pictures (or a long paste) a message names before it takes Enter, and an Enter
// that comes meanwhile is lost, so the message can sit in its box for good. While the box holds it, the same on two
// looks, it gets its Enter again (a few times at most); once the box is clear it went in. A screen that can't be read
// proves nothing: it keeps looking (none read at all: hc send's word stands). -> true: in; false: stuck.
export async function settleBox(io, addr, body, opts = SETTLE) {
  let last = null, enters = 0, seen = false;
  for (let i = 0; i < opts.looks; i++) {
    const box = await boxOf(io, addr);
    if (box !== undefined) {
      seen = true;
      if (box === null || !holds(box, body)) return true;
      if (box === last && enters < opts.enters) { await io.hc(["keys", addr, "enter"]).catch(() => null); enters++; last = null; }
      else last = box;
    }
    await io.sleep(opts.every);
  }
  const box = await boxOf(io, addr);
  if (box === undefined) return !seen;
  return box === null || !holds(box, body);
}

// hc send for one CLI. Claude Code reads the pictures a pasted message names before it takes
// Enter: an Enter that comes meanwhile is lost, and the message sits in its box ("[Image]
// 文字”)直到下一条把它挤走(hc send 约 5 秒后才报告)。hc send 进行期间
// 它这边的输入框仍保留图片、两次读取一致时,回车发送;其后,
// 输入框被持续监视直到清空(settleBox)。again:上一条发送还留在框里;若框
// 仍与原文完全一致时,直接回车,绝不重复输入。-> hc 的结果;卡住:仍留在输入框。
export async function sendTyped(io, addr, kind, body, opts = SETTLE, again = false) {
  if (kind !== "claude") return io.hc(["send", addr, body]);
  if (again) {
    const box = await boxOf(io, addr);
    if (holds(box, body, true)) {
      await io.hc(["keys", addr, "enter"]).catch(() => null);
      const ok = await settleBox(io, addr, body, opts);
      return ok ? { code: 0, stdout: "{}", stderr: "" } : { code: 1, stdout: "", stderr: STUCK, stuck: true };
    }
    // 输入框已放开该键(Claude Code 后来支持了):再次输入会重复发送
    if (box !== undefined && !holds(box, body)) return { code: 0, stdout: "{}", stderr: "" };
  }
  const going = io.hc(["send", addr, body]);
  let back = false, last = null;
  const sent = going.finally(() => { back = true; });
  if (PICTURE.test(body)) {
    for (let i = 0; i < 20 && !back; i++) {
      await Promise.race([io.sleep(100), sent.catch(() => null)]);
      if (back) break;
      const box = await boxOf(io, addr);
      if (box && /\[Image #\d+\]/.test(box) && box === last) { await io.hc(["keys", addr, "enter"]).catch(() => null); break; }
      last = box;
    }
  }
  const r = await sent;
  if (r.code !== 0) return r;
  let started = false;
  try { started = JSON.parse(r.stdout || "{}").started === true; } catch {}
  if (started || (await settleBox(io, addr, body, opts))) return r;
  return { code: 1, stdout: r.stdout, stderr: STUCK, stuck: true };
}

// 留在 Claude Code 输入框里的消息:再次发送是按它的 Enter(绝不重复输入文字)。
export const STUCK = "还在 agent 的消息框里:它的回车没生效。";

// 用户对消息的 reaction,按 agent 读到的形式(on:添加,否则移除)。
export const reactionLine = (emoji, text, on = true) => `<hc from="person" ${on ? "reaction" : "reaction-removed"}="${emoji}" to="${excerpt(text)}"/>`;

// 发送正文。kind:"claude"、"codex" 或其他 CLI。-> hc 的结果(code 0:已送入 agent 的 terminal)。
// 再次发送:上一条还留在 Claude Code 的输入框里(sendTyped)。
export async function sendBody(io, addr, kind, body, again = false) {
  let r = await sendTyped(io, addr, kind, body, SETTLE, again);
  if (r.code !== 0 && refusal(r).kind === "blocked" && (kind === "claude" || kind === "codex")) r = await replyInstead(io, addr, body);
  if (r.code === 0 && kind === "claude") await steerNow(io, addr);
  return r;
}
