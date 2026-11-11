// toast,同窗口端(mods/toasts):最后三条,每条一个按级别着色的圆点、标题一行,
// 正文至多折 3 行,悬停显示 X;点击执行其操作并关闭;各自按其级别的
// 时显示,指针悬停其上时不消失。窗口由 mods/toasts 绘制,web 应用由 web/plugins/alerts 绘制;
// 两端都从这里读取这些规则与文案。
// Shared core:源文件为 core/toasts.js;bin/sync-shared 会把它复制进 lib/COPIES 中的各 mod。请在此编辑,切勿
// 一份副本。

import { REASONS } from "./needs.js";

// 同屏显示多少条、多宽,以及正文可占多少行。
export const SHOWN = 3;
export const WIDTH = 360;
export const LINES = 3;
// 正文截断到此字符数(按 toast 宽度约 3 行)。
export const BODY_MAX = 140;
// 各 level 停留的时长(ms);其余保持 6 秒。
export const TIMEOUT = { alert: 20000, error: 12000, warning: 10000 };
export const TIMEOUT_DEFAULT = 6000;
export const timeoutOf = (n) => n.timeout ?? TIMEOUT[n.level] ?? TIMEOUT_DEFAULT;
// 至多保留这么久,且在新条之外至多这么多个。
export const KEEP_MS = 120000;
export const KEEP = 4;

// toast 的圆点:红为 alert 或 error,琥珀为 warning,绿为完成,其余用 accent 色。
export const tone = (level) => (level === "alert" || level === "error" ? "red" : level === "warning" ? "amber" : level === "success" ? "green" : "accent");

export const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// agent 发言的统一标题格式:"· Needs you"、"~ Assistant · Finished"。
export const NEEDS_YOU = "需要你";
export const FINISHED = "Finished";
export const toastTitle = (who, what) => `${who} · ${what}`;
// Assistant 的称谓,按其 space 的名称("tt-repo Assistant");任务的 agent 用其任务 ref(""),在
// 另一台机器则加其机器名,与聊天对远端 agent 的称呼一致(core/chat-view.js):"on vm"。
export const assistantWho = (spaceName) => (spaceName ? `${spaceName} Assistant` : "Assistant");
export const taskWho = (ref, machine) => (machine ? `${ref} on ${machine}` : ref);

// 多条 toast 合并为一行(手机只显示一条):各项都是待办任务时显示 "2 tasks need you"
// 你”;其中有 Assistant 时为 “2 need you”,否则 “3 updates”。
export function together(list) {
  const n = list.length;
  if (list.every((x) => x.need)) return `${n} ${list.every((x) => x.task) ? "任务 " : ""}need you`;
  return `${n} updates`;
}

// agent 需要用户的原因,即 Needs you toast 正文所述(web 端与服务端的 need: { question?:
// { kind, title }、secret?: { name }、text? }):它的问题、待批准的计划、索取的 secret,或其
// 最后说明;否则用标准原因(core/needs.js)。
export function needReason(n) {
  if (n?.question) return n.question.kind === "Plan" ? REASONS.plan : n.question.title || REASONS.question;
  if (n?.secret) return `Asks for ${n.secret.name}`;
  return n?.text || REASONS.question;
}

// 加入新 toast 后的列表(新的在最后):超过 KEEP_MS 的移除,只留最后 KEEP 条在旁。带
// 相同 key(同一事件:agent 需要你,随着了解更多会再次上报)会取代旧条目的位置与 id。
export function withToast(list, n, at = Date.now(), id = `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  const same = n.key ? (list ?? []).find((x) => x.key === n.key) : null;
  const kept = (list ?? []).filter((x) => x !== same && at - x.at < KEEP_MS).slice(-KEEP);
  return [...kept, { ...n, level: n.level ?? "info", id: same?.id ?? id, at }];
}

// `now` 时刻仍在的 toast:各自到期即移除。
export const unexpired = (list, now = Date.now()) => (list ?? []).filter((n) => now - n.at < timeoutOf(n));
