// Claude 通过 PermissionRequest hook(ask-hook.sh)向用户请求的内容,以文字描述
// chat 的卡片以及 hook 的答案。没有任何内容会在未读时被允许,也没有内容会超长
// 在 chat 中回答:卡片完整显示请求,在其内部滚动。
// 共享核心:源为 core/asks.js(窗口的 mod、service 和 web app 都使用它);
// bin/sync-shared 会把它复制到 lib/COPIES 里的每个 mod。请编辑 core/asks.js,不要改副本,然后运行 bin/sync-shared。

// 卡片最多显示这么多行(任何真实请求都能完整容纳),每行至多 LINE 个字符。
const SHOWN = 2000, LINE = 2000;
// 选项的 preview,至多这么多字符。
const PREVIEW = 8000;
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const base = (p) => String(p ?? "").split("/").filter(Boolean).pop() ?? "";
const firstLine = (s) => String(s ?? "").split("\n")[0];
// 用户所见的文件路径:相对 agent 文件夹,否则相对 home,否则完整路径;仅显示
// 名称过长时(原因至多 40 字符)。
function rel(p, cwd) {
  const f = String(p ?? "");
  const home = (/^(\/home\/[^/]+|\/Users\/[^/]+|\/root)(?=\/)/.exec(f) ?? [])[0];
  const r = cwd && f.startsWith(`${cwd}/`) ? f.slice(cwd.length + 1) : home ? `~${f.slice(home.length)}` : f;
  return r.length > 32 ? base(f) : r;
}
const host = (u) => { try { return new URL(String(u)).host || String(u); } catch { return String(u ?? ""); } };

// 细节行数,以及是否有内容被迫省略(超过 SHOWN 行或 LINE 字符时:
// 卡片已说明,其余在 terminal)。
function lines(...parts) {
  const all = parts.filter((p) => p !== undefined && p !== null && p !== "").flatMap((p) => String(p).split("\n"));
  const long = all.some((l) => l.length > LINE);
  return { detail: all.slice(0, SHOWN).map((l) => clip(l, LINE)).join("\n"), cut: all.length > SHOWN || long };
}
// 用户所见的 MCP server 名:“executor-me” 显示为 Executor,“claude_ai_Gmail” 显示为 Gmail。
function app(server) {
  const w = String(server).replace(/^(claude_ai|plugin)_/i, "").replace(/[-_](me|mcp|server)$/i, "").replace(/[-_]+/g, " ").trim();
  return w ? w[0].toUpperCase() + w.slice(1) : String(server);
}

// { title, detail, cut, kind: "permission" | "question" | "plan", options?, question? }
export function words(req) {
  const tool = String(req?.tool_name ?? "");
  const v = req?.tool_input && typeof req.tool_input === "object" ? req.tool_input : {};
  const cwd = String(req?.cwd ?? "");
  switch (tool) {
    case "AskUserQuestion": {
      // 每个问题及其选项:chat 的问题卡片一次性回答全部。
      const questions = (Array.isArray(v.questions) ? v.questions : []).map((q) => ({
        text: String(q?.question ?? ""), header: String(q?.header ?? ""), multi: q?.multiSelect === true,
        options: (Array.isArray(q?.options) ? q.options : []).map((o) => {
          const label = typeof o === "string" ? o : String(o?.label ?? "");
 // 其 preview:agent 为比较各选项而画的 mockup、代码或图表,按其 prompt 呈现方式
          const preview = typeof o === "object" && typeof o?.preview === "string" ? clip(o.preview, PREVIEW) : "";
          return { label, name: label.replace(/\s*\(recommended\)\s*$/i, ""), recommended: /\(recommended\)\s*$/i.test(label), description: typeof o === "object" ? o?.description ?? "" : "", ...(preview ? { preview } : {}) };
        }).filter((o) => o.label),
      })).filter((q) => q.text);
      return { kind: "questions", title: questions[0]?.text ?? "一个问题", detail: "", questions, cut: false };
    }
    case "ExitPlanMode": {
      const l = lines(v.plan);
      return { kind: "plan", title: "待批准的计划", ...l };
    }
    case "Bash": return { kind: "permission", title: `Run: ${clip(firstLine(v.command), 120)}`, ...lines(v.description, v.command) };
    case "Write": return { kind: "permission", title: `Write ${rel(v.file_path, cwd)}`, ...lines(v.file_path, v.content) };
    case "Edit": return { kind: "permission", title: `Edit ${rel(v.file_path, cwd)}`, ...lines(v.file_path,
      ...String(v.old_string ?? "").split("\n").map((l) => `- ${l}`), ...String(v.new_string ?? "").split("\n").map((l) => `+ ${l}`)) };
    case "MultiEdit": return { kind: "permission", title: `Edit ${rel(v.file_path, cwd)}`, ...lines(v.file_path,
      ...(Array.isArray(v.edits) ? v.edits : []).flatMap((e) => [...String(e?.old_string ?? "").split("\n").map((l) => `- ${l}`), ...String(e?.new_string ?? "").split("\n").map((l) => `+ ${l}`)])) };
    case "NotebookEdit": return { kind: "permission", title: `Edit ${rel(v.notebook_path, cwd)}`, ...lines(v.notebook_path, v.new_source) };
    case "Read": return { kind: "permission", title: `Read ${rel(v.file_path, cwd)}`, ...lines(v.file_path) };
    case "Glob": case "Grep": return { kind: "permission", title: `Search for ${clip(v.pattern, 80)}`, ...lines(v.path) };
    case "WebFetch": return { kind: "permission", title: `Fetch ${clip(host(v.url), 100)}`, ...lines(v.url, v.prompt) };
    case "WebSearch": return { kind: "permission", title: `Search the web: ${clip(v.query, 100)}`, detail: "", cut: false };
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  const json = Object.keys(v).length ? JSON.stringify(v, null, 1) : "";
  // 某个 app(MCP)的 tool:顶部为 app 名,下方为 tool 及其输入。
  return { kind: "permission", title: mcp ? `Use ${app(mcp[1])}` : `Use ${tool || "工具"}`, ...(mcp ? lines(mcp[2], json) : lines(json)) };
}

const out = (decision) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });
export const allow = () => out({ behavior: "allow" });
export const deny = (message = "对方在对话中拒绝了。") => out({ behavior: "deny", message });
// 问题的答案通过 `answers` 作为 tool 输入返回;Claude 随后继续。
export const answer = (req, label) => out({ behavior: "allow", updatedInput: { ...(req.tool_input ?? {}), answers: { [String(req.tool_input?.questions?.[0]?.question ?? "")]: label } } });
// 问题卡片全部答案:{ [问题文本]: answer }(多选用 “, ” 连接,
// (“Other” 按原样),与 Claude 自身 prompt 给出的一致。
// annotations:{ [问题文本]: { preview?, notes? } },同 Claude 的 prompt 所附:第一个问题的
// 所选项,以及用户的备注。
export const answers = (req, map, annotations) => out({ behavior: "allow", updatedInput: { ...(req.tool_input ?? {}), answers: map,
  ...(annotations && Object.keys(annotations).length ? { annotations } : {}) } });
// 问题卡片答案的 annotations:每个问题所选项的 preview(单选),以及
// 用户自写备注时第一问的内容。w:words(req);map:按 answers() 的格式。
export function annotationsOf(w, map, note) {
  const out = {};
  (w?.questions ?? []).forEach((q, i) => {
    const a = {};
    const o = q.multi ? null : q.options.find((x) => x.name === map?.[q.text]);
    if (o?.preview) a.preview = o.preview;
    if (i === 0 && note && String(note).trim()) a.notes = String(note).trim();
    if (Object.keys(a).length) out[q.text] = a;
  });
  return out;
}
// “Chat about this”:无答案;Claude 得知用户想先聊一聊。
export const chatAbout = () => deny("The person wants to talk about these questions before answering. Don't ask them again now: wait for their message in the chat and answer it.");
// “Dismiss”(或卡片上的 Esc):不作回答直接关闭,同 Claude 自身 prompt 里的 Esc,区别是 Claude 会继续
// 而非停下:它得知用户拒绝后在没有该权限的情况下继续。kind:卡片的(words().kind)。
export const DISMISSED = "对方未回答就关闭了";
export const dismiss = (kind) => deny(kind === "questions"
  ? `${DISMISSED}. Don't ask these questions again now: carry on with your best judgment, and say what you assumed.`
  : kind === "plan"
    ? `${DISMISSED}: the plan isn't approved. Stay in plan mode and wait for the person's message.`
    : `${DISMISSED}: don't do it. Carry on without it, or another way.`);
// 未决定:Claude 在 terminal 里显示自己的 prompt。
export const release = () => "";

// 卡片回答的结果,用于其安静行(“Allowed in the chat”);未决定时为 null(由 terminal 询问
// 代替)。ask:{ words },text:hook 的答案,where:“in the chat”、“in the task's chat”...
export function howAnswered(ask, text, where) {
  let d = null;
  try { d = JSON.parse(text).hookSpecificOutput?.decision; } catch {}
  if (!d) return null;
  const plan = ask.words.kind === "plan";
  if (d.behavior === "deny" && String(d.message ?? "").startsWith(DISMISSED)) return `Dismissed ${where}`;
  if (d.behavior === "allow") return `${plan ? "Approved" : d.updatedInput ? "Answered" : "Allowed"} ${where}`;
  if (ask.words.kind === "questions") return `Left to talk over ${where}`;
  return plan ? `Sent back to planning ${where}` : `Denied ${where}`;
}

// // ---- Codex 自己的提问(request_user_input)----------------------------------------------
// Codex 未给其问题 tool 提供 hook(它的 PermissionRequest hook 只用于审批),因此其卡片在
// 其屏幕,像用户一样操作:逐题作答,数字键选择一项(并进入下一题;
// 最后一题提交全部),自己的回答写在 “None of the above” 的备注里(按到该项,tab,
// 粘贴文字后回车)。仅在屏幕正显示卡片所依据的问题时有效。

/* request_user_input 的参数,作为卡片的问题:[{ text, header, choices: [{ label, description? }] }]。 */
export function codexQuestions(args) {
  let a = args;
  try { a = typeof a === "string" ? JSON.parse(a) : a; } catch { return []; }
  return (Array.isArray(a?.questions) ? a.questions : []).map((q) => ({
    text: String(q?.question ?? ""), header: String(q?.header ?? ""),
    choices: (Array.isArray(q?.options) ? q.options : []).map((o) => (typeof o === "string" ? { label: o } : { label: String(o?.label ?? ""), ...(o?.description ? { description: String(o.description) } : {}) })).filter((o) => o.label),
  })).filter((q) => q.text);
}

/* 卡片所示的一个选择:以 “(Recommended)” 为标签,同 Claude 的做法。 */
export const codexChoice = (c) => {
  const rec = /\s*\(recommended\)\s*$/i.test(c.label);
  return { label: c.label.replace(/\s*\(recommended\)\s*$/i, ""), ...(c.description ? { description: c.description } : {}), ...(rec ? { recommended: true } : {}) };
};

/* Codex 的屏幕是否在其第一个问题处显示这些问题的选择器,且尚无任何回答。 */
export function codexOnScreen(screen, questions) {
  const s = String(screen ?? "").replace(/\s+/g, " ");
  const q = questions?.[0];
  if (!q) return false;
  const n = questions.length;
  const one = (w) => s.includes(String(w).replace(/\s+/g, " ").trim());
  return new RegExp(`Question 1/${n} \\(${n} unanswered\\)`).test(s) && one(q.text) && q.choices.every((c) => one(c.label));
}

/* 回答它们的步骤:[{ keys: [...] } | { paste: words }],每问一答,内容为其选项的标签或用户自己的话。有回答缺失时为 null。 */
export function codexSteps(questions, answers) {
  if (!Array.isArray(answers) || answers.length !== questions.length) return null;
  const steps = [];
  for (const [i, q] of questions.entries()) {
    const said = String(answers[i] ?? "").trim();
    if (!said) return null;
    const k = q.choices.findIndex((c) => c.label === said || codexChoice(c).label === said);
    if (k >= 0 && k < 9) steps.push({ keys: [String(k + 1)] });
    else if (k >= 0) steps.push({ keys: [...Array(k).fill("down"), "enter"] });
    // “None of the above” 及其备注:粘贴文字后回车(Codex 收到 “None of the above” 和备注)
    else steps.push({ keys: [...Array(q.choices.length).fill("down"), "tab"] }, { paste: said });
  }
  return steps;
}
