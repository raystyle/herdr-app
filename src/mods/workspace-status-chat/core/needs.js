// 为何需要用户,一行至多 40 字符:Tasks 列表、inbox 和
// web app 都显示。共享核心:源为 core/needs.js;bin/sync-shared 会把它复制到 lib/COPIES 里的各 mod。
// lib/COPIES(与重新导出它的 lib/inbox.js 并列)。请在此编辑,不要改副本。
import { words } from "./asks.js";

// 至多这么多字符,同 herdr-winapp 的状态行(herdr-task 的 LINE_MAX)。
export const LINE_MAX = 40;
export const REASONS = { plan: "待批准的计划", permission: "请求权限", question: "问你的问题",
  reply: "等你的回复", signedOut: "已退出登录", stopped: "agent 已停止", trust: "请求信任此文件夹" };

// 一行至多 n 字符,超长时在词边界截断(末尾 “…”)(herdr-task 的 fit())。
export function fit(text, n = LINE_MAX) {
  const s = String(text ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (s.length <= n) return s;
  let cut = s.slice(0, n - 1);
  if (cut.includes(" ") && s[n - 1] !== " ") cut = cut.slice(0, cut.lastIndexOf(" "));
  return cut.replace(/[ ,;:.-]+$/, "") + "…";
}

// hook 请求为何等待(Claude 的 PermissionRequest):一个 plan、其问题(截断以适配),或
// 权限的用途,按其卡片所述(“Run: npm test”、“Edit mods/chat/main.js”)。
export function reqReason(req) {
  const tool = String(req?.tool_name ?? ""), v = req?.tool_input ?? {};
  if (tool === "ExitPlanMode") return REASONS.plan;
  if (tool === "AskUserQuestion") { const q = v?.questions?.[0]?.question; return q ? fit(q) : REASONS.question; }
  return fit(words(req).title) || REASONS.permission;
}

// 权限用途,来自 agent 自己的报告(OSC 7501 消息:Claude 的 “approve
// Bash: npm test”),当没有 hook 持有它的请求时:“Run: npm test”。否则 null。
export function reportReason(msg) {
  const m = /^approve\s+(\S+?):\s*(.+)$/i.exec(String(msg ?? "").trim());
  if (!m) return null;
  return fit(m[1] === "Bash" ? `Run: ${m[2]}` : m[1] === "WebFetch" ? `Fetch ${m[2]}` : `${m[1]} ${m[2]}`);
}
