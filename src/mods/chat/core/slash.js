// 消息框上方 "/" 列表的 slash 命令,窗口聊天与 web app 共用:CLI 自带的、
// 会在 CLI 中打开菜单的命令,以及在 agent
// machine。用户输入原样发给 agent;这里只提供建议。
// Shared core:源文件为 core/slash.js;bin/sync-shared 会把它复制进 lib/COPIES 中的各 mod。

export const CLAUDE = [
  ["add-dir", "添加工作文件夹"], ["agents", "管理子 agent"], ["clear", "开始新对话"],
  ["compact", "总结对话以释放上下文"], ["config", "打开设置"], ["context", "显示上下文用量"],
  ["cost", "显示此会话的花费"], ["doctor", "检查安装"], ["effort", "设置强度等级"],
  ["export", "导出对话"], ["fast", "开启或关闭快速模式"], ["help", "显示帮助"], ["hooks", "管理 hooks"],
  ["init", "为此项目写 CLAUDE.md"], ["login", "登录"], ["logout", "退出登录"], ["mcp", "管理 MCP 服务器"],
  ["memory", "编辑记忆文件"], ["model", "选择模型"], ["permissions", "管理工具权限"],
  ["plugin", "管理插件"], ["resume", "恢复其他对话"], ["review", "审查 Pull Request"],
  ["rewind", "回到更早的节点"], ["status", "显示版本、模型和账号"], ["theme", "更换主题"],
  ["usage", "显示套餐用量"],
];
export const CODEX = [
  ["model", "选择模型和强度"], ["approvals", "选择哪些操作无需询问"], ["review", "审查变更"],
  ["new", "开始新对话"], ["init", "为此项目写 AGENTS.md"], ["compact", "总结对话以释放上下文"],
  ["diff", "显示 git diff"], ["mention", "提及文件"], ["status", "显示会话设置和用量"],
  ["mcp", "列出 MCP 工具"], ["resume", "恢复其他对话"], ["fork", "分叉此对话"],
  ["logout", "退出登录"], ["quit", "退出 Codex"],
];
// 不带参数调用时会在 CLI 中打开菜单的命令。
export const MENU = {
  claude: new Set(["agents", "config", "doctor", "effort", "export", "hooks", "login", "mcp", "memory", "model", "permissions", "plugin", "resume", "rewind", "status", "theme", "usage"]),
  codex: new Set(["model", "approvals", "review", "mention", "resume", "fork", "status", "diff"]),
};

// 用户自定义的命令与 skills,位于 agent 所在机器:每行 "name<TAB>description"。
export const SCAN = `
cwd="$1"
desc() { awk '/^description:/ { sub(/^description:[[:space:]]*/, ""); if ($0 ~ /^[>|]-?$/ || $0 == "") { getline; sub(/^[[:space:]]+/, "") } gsub(/"/, ""); print substr($0, 1, 90); exit }' "$1" 2>/dev/null; }
for d in "$HOME/.claude/commands" "$cwd/.claude/commands"; do
  [ -d "$d" ] || continue
  find "$d" -name '*.md' 2>/dev/null | while read -r f; do n=\${f#"$d"/}; n=\${n%.md}; printf '%s\\t%s\\n' "$(echo "$n" | tr / :)" "$(desc "$f")"; done
done
for d in "$HOME/.claude/skills" "$cwd/.claude/skills"; do
  for f in "$d"/*/SKILL.md; do [ -f "$f" ] || continue; n=\${f%/SKILL.md}; printf '%s\\t%s\\n' "\${n##*/}" "$(desc "$f")"; done
done
true`;

// 把 SCAN 的输出当作命令:[{ name, about }]。
export function scanned(stdout) {
  return String(stdout ?? "").split("\n").filter(Boolean).map((l) => { const [name, about] = l.split("\t"); return { name, about: about || "你的命令" }; });
}

// agent 认识的每个命令,其 CLI 的在前:[{ name, about }]。mine:用户自己的(仅 Claude Code)。
export function commandList(kind, mine = []) {
  const list = (kind === "codex" ? CODEX : CLAUDE).map(([name, about]) => ({ name, about }));
  if (kind !== "claude") return list;
  const seen = new Set(list.map((c) => c.name));
  return [...list, ...mine.filter((c) => !seen.has(c.name) && seen.add(c.name))];
}

// 正在输入的 "/word",前提是整条消息目前就是一个命令。
export function typing(text) {
  const m = /^\/([\w:.-]*)$/.exec(text);
  return m ? m[1] : null;
}

// 针对输入内容的建议:以其开头的名字在前,然后是包含它的名字。
export function match(list, word) {
  const w = word.toLowerCase();
  const starts = list.filter((c) => c.name.toLowerCase().startsWith(w));
  const has = list.filter((c) => !c.name.toLowerCase().startsWith(w) && c.name.toLowerCase().includes(w));
  return [...starts, ...has].slice(0, 8);
}

export function opensMenu(kind, text) {
  const m = /^\/([\w:-]+)\s*$/.exec(text.trim());
  if (!m) return null;
  if (MENU[kind]?.has(m[1])) return m[1];
  // CLI 会把前缀补全到首个匹配("/mo" 即运行 /model)。
  const all = (kind === "codex" ? CODEX : CLAUDE).map(([n]) => n).filter((n) => n.startsWith(m[1]));
  return all.length && MENU[kind]?.has(all[0]) ? all[0] : null;
}
