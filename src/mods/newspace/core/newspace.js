// New space 对话框的文案与规则,窗口端(mods/newspace)与 web 端保持一致
// (web/plugins/places/add.tsx、service/spaces.ts):其输入框存放 space 所在文件夹,
// 建议为该 machine 最近使用的文件夹(至多 SHOWN 个),Browse… 列出某文件夹的子文件夹
// 另一台机器,不在 git 中的文件夹会提供 "Make it a git repo"。开机机器多于一台时,起始为
// 带 Machine 选择(machine 的 + 仅预选它);指定时不再显示该选择。
// 纯 JS(不 import herdr 或 node):bin/sync-shared 会把它复制进 mods/newspace/core/。

import { isWorktreePath } from "./paths.js";
export const WORDS = {
  title: "新建空间",
  on: (machine) => `on ${machine}`,
  machine: "Machine",
  label: "图标和文件夹",
  placeholder: "~/path/to/folder",
  browse: "浏览…",
  loading: "加载中…",
  empty: "里面没有文件夹",
  noMatch: "没有匹配的文件夹",
  missing: "此文件夹不存在,将会创建。",
  makeRepo: "设为 git 仓库",
  makeRepoWhy: "这样每个任务有自己的 worktree",
  isRepo: "git 仓库:每个任务有自己的 worktree",
  create: "创建空间",
  creating: "创建中…",
  cancel: "Cancel",
  cantList: (dir, machine) => `Couldn't list ${dir}${machine ? ` on ${machine}` : ""}.`,
  cantMake: (dir) => `Couldn't make ${dir}.`,
  cantRepo: (why) => `Couldn't make it a git repo: ${why || "git 失败"}`,
  // 已创建但尚未列入列表(另一台 machine 的 spaces 还在同步):明确提示,绝不静默关闭
  notShown: (machine) => `Made it${machine ? ` on ${machine}` : ""}, but it hasn't shown up yet. It opens here once it does.`,
};

// 建议项的最大显示数量。
export const SHOWN = 5;

// 新仓库,与 herdr-winapp 一致:main 分支、一个空提交,无 hook 和签名干扰。
export const NEW_REPO = [["init", "-q", "--initial-branch=main"],
  ["-c", "user.useConfigOnly=false", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "首次提交"]];

// 文件夹的子文件夹,排除隐藏项,已排序(sh -c SUBFOLDERS x <dir>)。
export const SUBFOLDERS = 'cd "$1" 2>/dev/null || exit 1; for d in */; do [ -d "$d" ] && printf "%s\\n" "${d%/}"; done; true';

// 文件夹取其 repo 顶层(sh -c REPO_TOPS x <paths…>),每行一个。
export const REPO_TOPS = 'for d; do [ -d "$d" ] || continue; git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d"; done';

// builder 的临时文件夹(/tmp 下的 scratchpad):不属于任何人的工作,从不推荐。
export const scratch = (p) => /^\/(private\/)?(var\/)?tmp(\/|$)/.test(p) || /\/scratchpad(\/|$)/.test(p);

// 路径与 dialog 显示一致:machine 的 home 以 ~ 表示。
export const tilde = (p, home) => (p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p);
export const untilde = (p, home) => (p === "~" ? home : p.startsWith("~/") ? home + p.slice(1) : p);
export const base = (p, home) => (p === home ? "Home" : p.split("/").filter(Boolean).pop() ?? p);
export const parent = (p) => p.replace(/\/[^/]+\/?$/, "") || "/";

// 输入框文本所指的文件夹;不是路径时(过滤词)为 null。
export const pathOf = (text, home) => {
  const f = String(text ?? "").trim();
  return /^[~/]/.test(f) ? untilde(f.length > 1 ? f.replace(/\/+$/, "") : f, home) : null;
};

// 输入框文本所在的文件夹,同 shell 补全路径:最后一个 / 之前的部分(作为路径),以及
// 其后一词;文本无 / 或不是路径时返回 null("~/dev/sh" → { dir: <home>/dev, word: "sh" })。
export const typedDir = (text, home) => {
  const f = String(text ?? "").trimStart();
  const i = f.lastIndexOf("/");
  if (i < 0 || !/^[~/]/.test(f)) return null;
  const d = f.slice(0, i + 1);
  return { dir: d === "/" ? "/" : untilde(d.replace(/\/+$/, "") || "/", home), word: f.slice(i + 1) };
};

// 输入框中用于列出内容的文件夹形式:home 显示为 ~,以 / 结尾。
export const asDir = (p, home) => { const t = tilde(p, home); return t.endsWith("/") ? t : t + "/"; };

// 名称匹配 `word` 的子文件夹(路径),忽略大小写:以其开头的排前,然后是
// 包含它的那些,各自保持顺序。
export function matching(paths, word) {
  const w = String(word ?? "").toLowerCase();
  if (!w) return [...paths];
  const name = (p) => (p.split("/").filter(Boolean).pop() ?? p).toLowerCase();
  return [...paths.filter((p) => name(p).startsWith(w)), ...paths.filter((p) => !name(p).startsWith(w) && name(p).includes(w))];
}

// 建议项:`all`(最近文件夹,Browse… 选中的排前)中匹配输入内容的(输入为空时全部
// 输入框为空或为路径时),至多 SHOWN 条,不含输入框自身的文件夹。
export function suggestions(all, text, home) {
  const word = String(text ?? "").trim().toLowerCase();
  const p = pathOf(text, home);
  return all.filter((f) => f !== p && (!word || tilde(f, home).toLowerCase().includes(word) || base(f, home).toLowerCase().includes(word)))
    .slice(0, SHOWN);
}

// 机器各终端的最近文件夹({ cwd, at } 最新在前),在其归并为仓库顶层之前:
// 无 scratch 且无任务 worktree,至多询问 40 个。
export function recentCandidates(list) {
  const at = new Map();
  for (const { cwd, at: t } of list) if (cwd && !isWorktreePath(cwd)) at.set(cwd, Math.max(at.get(cwd) ?? 0, t ?? 0));
  return [...at.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 40);
}

// 以 REPO_TOPS 的输出作为 recent folders:去重、不含 task worktree、至多 8 个。
export function recentFrom(stdout) {
  const out = [];
  for (const p of String(stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (!out.includes(p) && !isWorktreePath(p)) out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

// 输入框的初始值:用户当前工作的文件夹(若在 repo 内则取其顶层,同最近记录),
// 否则 home;绝不用临时文件夹。
export function startFolder(at, recent, home) {
  if (!at || scratch(at)) return home;
  return recent.find((r) => at === r || at.startsWith(r + "/")) ?? at;
}

// 是否显示 "Make it a git repo":已确认不在 repo 中的文件夹,且不是 home 或 /。
export const offersRepo = (folder, inRepo, home) => Boolean(folder) && folder !== home && folder !== "/" && inRepo === false;

// Herdr 对该处未命名 space 的叫法:home 处为 "Home",否则取 repo 顶层文件夹,再否则取文件夹名。
export const placeName = (folder, top, home) => (folder === home ? "Home" : (top || folder).split("/").filter(Boolean).pop() ?? folder);

// New space 可在其上创建 space 的机器:处于开机且可达状态的(`list`: { key, on },本机的 key 为 null
// 本机),按顺序排列。仅两台及以上时才显示 Machine 选择。
export const reachable = (list) => list.filter((m) => m.on).map((m) => m.key);
export const choosesMachine = (keys) => keys.length > 1;

// 对话框初始所在机器:指定的那台(机器的 +),否则为当前 space 所在机器(需可达);
// 否则取第一台可行的(开机时本机优先)。undefined:无机器可行。
export function startMachine(keys, asked, shown) {
  for (const k of [asked, shown]) if (k !== undefined && keys.includes(k)) return k;
  return keys.length ? keys[0] : undefined;
}
