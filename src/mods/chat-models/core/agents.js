// agent 的运行配置(agent、model、effort、speed、context)以及换选重启的方式:
// 窗口的模型菜单(lib/agent.js、mods/chat-models)和 web app 共用的规则。读取 agent 自己的
// 设置与重启分别在各自运行命令的地方执行(lib/agent.js、service/agents.ts)。
// 共享 core:源文件是 core/agents.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的 mods 里。
export const NAMES = { claude: "Claude Code", codex: "Codex" };

// Claude Code 当前的模型,与其 /model 菜单一致。`id` 即 --model 接收的值;
// `match` 是运行中的 agent 可能为它上报的名称。
const CLAUDE_MODELS = [
  { id: "opus", name: "Opus 5.5", match: ["opus", "claude-opus-5-5"] },
  { id: "opus[1m]", name: "Opus 5.5 · 1M", match: ["opus[1m]", "claude-opus-5-5[1m]"] },
  { id: "claude-fable-5-1", name: "Fable 5.1", match: ["fable", "claude-fable-5-1"] },
  { id: "sonnet", name: "Sonnet 5.5", match: ["sonnet", "claude-sonnet-5-5"] },
  { id: "haiku", name: "Haiku 5.5", match: ["haiku", "claude-haiku-5-5"] },
];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
// 各 CLI 自身的 permission 模式(Claude:--permission-mode,或
// --dangerously-skip-permissions 获得完全访问;Codex:其 sandbox 和审批)。
const PERMS = {
  claude: [{ id: "manual", label: "Ask" }, { id: "auto", label: "Auto" }, { id: "acceptEdits", label: "接受编辑" },
    { id: "plan", label: "Plan" }, { id: "bypassPermissions", label: "完全权限" }],
  codex: [{ id: "read-only", label: "只读" }, { id: "auto", label: "Auto" }, { id: "full", label: "完全权限" }],
};
// 切换 agent 时随之携带的权限模式:取另一 agent 那边最接近的模式(auto 保持 auto,
// full access 对应 full access,Claude 的 accept edits 对应 Codex 的 auto,plan 和 read only 互换),否则用该 agent 的
// 默认值(Claude 的 ask 在 Codex 中没有对应项)。往返转换时绝不把 auto 悄悄降级为 ask(#758)。
const PERM_ACROSS = {
  claude: { "read-only": "plan", auto: "auto", full: "bypassPermissions" },
  codex: { plan: "read-only", auto: "auto", acceptEdits: "auto", bypassPermissions: "full" },
};
export function permAcross(perm, agent, permDefault) {
  return PERM_ACROSS[agent]?.[perm] ?? (PERMS[agent]?.some((p) => p.id === perm) ? perm : null) ?? permDefault?.[agent] ?? null;
}

// 模型 id 对应的文字描述:"claude-opus-5-5" → "Opus 5.5","opus[1m]" → "Opus 1M"。
export function modelName(id) {
  if (!id) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(id);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  const a = /^([a-z]+)(\[1m\])?$/.exec(id);
  if (a) return `${a[1][0].toUpperCase()}${a[1].slice(1)}${a[2] ? " 1M" : ""}`;
  return id;
}

// argv 中 flag 的值:--model x、--model=x 或 -m x。
function flag(argv, ...names) {
  for (let i = argv.length - 1; i >= 0; i--) {
    for (const n of names) {
      if (argv[i] === n && i + 1 < argv.length) return argv[i + 1];
      if (argv[i].startsWith(n + "=")) return argv[i].slice(n.length + 1);
    }
  }
  return null;
}
// Codex 的 -c key=value 覆盖项。
function overrides(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] !== "-c" && argv[i] !== "--config") continue;
    const m = /^([\w.]+)=(.*)$/.exec(argv[i + 1]);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// The agent's own settings on its machine: Claude's settings.json, Codex's config.toml and
// 模型列表。每个 agent 进程只读一次。
export const DEFAULTS = `
if [ "$1" = claude ]; then
  f="$HOME/.claude/settings.json"
  command -v jq >/dev/null && [ -f "$f" ] && jq -r '"model\\t\\(.model // "")", "effort\\t\\(.effortLevel // "")", "fast\\t\\(if .fastMode == true then "on" else "" end)", "per\\t\\(.modelSettings // {} | with_entries(.value |= (.effortLevel // null)) | tojson)", "mode\\t\\(.permissions.defaultMode // "")"' "$f" 2>/dev/null
else
  f="$HOME/.codex/config.toml"
  for k in model model_reasoning_effort service_tier sandbox_mode approval_policy; do
    printf '%s\\t%s\\n' "$k" "$(sed -n "s/^$k[[:space:]]*=[[:space:]]*\\"\\{0,1\\}\\([^\\"]*\\)\\"\\{0,1\\}.*/\\1/p" "$f" 2>/dev/null | head -1)"
  done
  c="$HOME/.codex/models_cache.json"
  [ -f "$c" ] && { printf 'models\\t'; tr -d '\\n' < "$c"; echo; }
fi
true`;

function parsePer(text) {
  try { return JSON.parse(text || "{}") ?? {}; } catch { return {}; }
}

// agent 自身的设置,来自其机器上 DEFAULTS 的输出。
export function parseDefaults(kind, stdout) {
  const out = {};
  for (const line of (stdout ?? "").split("\n")) {
    const t = line.indexOf("\t");
    if (t > 0) out[line.slice(0, t)] = line.slice(t + 1);
  }
  let models = null;
  if (out.models) {
    try {
      models = (JSON.parse(out.models).models ?? []).filter((m) => m.visibility !== "hide").map((m) => ({
        id: m.slug, label: m.display_name || m.slug,
        efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter(Boolean),
        fast: (m.service_tiers ?? []).length > 0,
        defaultEffort: m.default_reasoning_level ?? null,
      }));
    } catch {}
  }
  return kind === "claude"
    ? { model: out.model || null, effort: out.effort || null, fast: Boolean(out.fast), per: parsePer(out.per), mode: out.mode || null }
    : { model: out.model || null, effort: out.model_reasoning_effort || null, fast: ["fast", "priority"].includes(out.service_tier),
      sandbox: out.sandbox_mode || null, approval: out.approval_policy || null, models };
}

// agent 当前的运行配置:{ agent, model, effort, fast, used, window, alias }。
export function current(kind, argv, meta, dflt) {
  argv = argv ?? [];
  meta = meta ?? {};
  dflt = dflt ?? {};
  if (kind === "claude") {
    const alias = flag(argv, "--model") ?? dflt.model;
    let fast = dflt.fast;
    const s = flag(argv, "--settings");
    if (s && /"fastMode"\s*:\s*(true|false)/.test(s)) fast = /"fastMode"\s*:\s*true/.test(s);
    if (meta.speed) fast = meta.speed === "fast";
    const big = /\[1m\]/.test(alias ?? "") || (meta.used ?? 0) > 200000;
    // Claude 为每个模型保存一个 effort(modelSettings),日志里出现模型名后即可得知。
    const per = meta.model ? dflt.per?.[meta.model] ?? dflt.per?.[meta.model.replace(/-\d+$/, "")] : null;
    const perm = argv.includes("--dangerously-skip-permissions") ? "bypassPermissions" : flag(argv, "--permission-mode") ?? dflt.mode ?? "manual";
    return { agent: "claude", model: meta.model ?? alias, alias, effort: meta.effort ?? flag(argv, "--effort") ?? per ?? dflt.effort,
      fast: Boolean(fast), perm: perm === "default" ? "manual" : perm, used: meta.used ?? null, window: meta.window ?? (big ? 1000000 : 200000) };
  }
  const o = overrides(argv);
  const tier = o.service_tier;
  const model = meta.model ?? flag(argv, "-m", "--model") ?? o.model ?? dflt.model;
  const sandbox = flag(argv, "-s", "--sandbox") ?? o.sandbox_mode ?? dflt.sandbox;
  const perm = argv.includes("--dangerously-bypass-approvals-and-sandbox") || sandbox === "danger-full-access" ? "full"
    : sandbox === "read-only" ? "read-only" : "auto";
  return { agent: "codex", model, label: dflt.models?.find((m) => m.id === model)?.label ?? null, perm,
    effort: meta.effort ?? o.model_reasoning_effort ?? dflt.effort,
    fast: tier ? ["fast", "priority"].includes(tier) : Boolean(dflt.fast), used: meta.used ?? null, window: meta.window ?? null };
}

// effort 等级的用户可读形式:"xhigh" -> "Extra high"。CLI 仍接收原始值。
const LEVELS = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "特高", max: "Max", ultra: "Ultra", none: "None" };
export function levelName(e) {
  return e ? LEVELS[e] ?? e[0].toUpperCase() + e.slice(1) : null;
}

// “Claude Code · Opus 5.5 · High · Fast”
export function line(c) {
  if (!c) return "";
  return [NAMES[c.agent], c.label ?? modelName(c.model), levelName(c.effort), c.fast ? "Fast" : null].filter(Boolean).join(" · ");
}

// context window 的占用程度:"38% context",或 null。
export function contextWords(c) {
  if (!c?.used || !c.window) return null;
  return `${Math.min(100, Math.round((c.used / c.window) * 100))}% context`;
}

// model picker(mods/chat-models,web 端的 restart.tsx)针对单个 agent 展示的内容,以纯数据形式:
// { name, models: [{ id, name, efforts, defaultEffort, fast }], perms }:该 CLI 的每个模型
// 提供的模型(Codex:自己的 models_cache.json;Claude Code:/model 菜单),picker 对它们做搜索。
// `dflt` 是该 agent 的设置(defaults());`current` 是其运行中的模型,保留在列表里。
export function menuFor(agent, dflt, current = null) {
  if (agent === "claude") {
    const models = CLAUDE_MODELS.map((m) => ({ id: m.id, name: m.name, efforts: CLAUDE_EFFORTS,
      defaultEffort: dflt?.per?.[m.match[1].replace(/\[1m\]$/, "")] ?? dflt?.effort ?? null, fast: m.id.startsWith("opus") }));
    // 按 id 输入的模型(仍在使用的旧版本)在其运行期间保留在列表中
    if (current && !models.some((m) => m.id === current)) models.unshift({ id: current, name: modelName(current), efforts: CLAUDE_EFFORTS, defaultEffort: dflt?.effort ?? null, fast: false });
    return { name: NAMES.claude, perms: PERMS.claude, models };
  }
  const all = (dflt?.models ?? []).map((m) => ({ id: m.id, name: m.label, efforts: m.efforts?.length ? m.efforts : ["low", "medium", "high", "xhigh"],
    defaultEffort: m.defaultEffort ?? dflt?.effort ?? null, fast: m.fast }));
  if (current && !all.some((m) => m.id === current)) all.unshift({ id: current, name: current, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: dflt?.effort ?? null, fast: false });
  return { name: NAMES.codex, perms: PERMS.codex, models: all };
}

// 按 id 输入的模型可用的档位:其 agent 的常规档位。
export function typedModel(agent, id) {
  return { id, name: agent === "claude" ? modelName(id) : id, efforts: agent === "claude" ? CLAUDE_EFFORTS : ["low", "medium", "high", "xhigh"], defaultEffort: null, fast: false, typed: true };
}

// 用户在模型菜单中的选择(窗口端和 web 端一致),存于 PICKS_FILE,位于
// 菜单所在机器的主目录:{ pinned: ["codex:gpt-6-sol"], recent: [...] },recent 按最新在前。
export const PICKS_FILE = ".herdr/model-picks.json";
const RECENT = 5;
export const pickKey = (agent, id) => `${agent}:${id}`;
export function parsePicks(text) {
  let d = {};
  try { d = JSON.parse(text || "{}") ?? {}; } catch {}
  const list = (x) => (Array.isArray(x) ? x.filter((k) => typeof k === "string" && k.includes(":")) : []);
  return { pinned: list(d.pinned), recent: list(d.recent).slice(0, RECENT) };
}
// 在它上面重启过的:排在 recent 最前面。
export function withRecent(picks, key) {
  return { ...picks, recent: [key, ...picks.recent.filter((k) => k !== key)].slice(0, RECENT) };
}
// 星标:是否置顶于其 agent 的列表。
export function withPin(picks, key) {
  return { ...picks, pinned: picks.pinned.includes(key) ? picks.pinned.filter((k) => k !== key) : [...picks.pinned, key] };
}

// 输入的每个词都出现在模型名称或 id 中,不区分大小写("op 1m" 能匹配 Opus 5.5 · 1M)。
export function modelMatches(m, q) {
  const hay = `${m.name ?? ""} ${m.id}`.toLowerCase().replace(/[^a-z0-9.\[\] ]+/g, " ");
  return String(q ?? "").toLowerCase().split(/[^a-z0-9.\[\]]+/).filter(Boolean).every((w) => hay.includes(w));
}

// picker 显示的模型列表:分组行,每组最多 CAP 行(`more` 计入剩余数量)。
// 无输入:显示的 agent(`agent`)、其 pinned 模型、其 recent 模型,然后是其余所有,按
// CLI 的顺序。Typed:各 agent 的匹配项,每个 agent 一个分组(其 pinned 和 recent 靠前),另外对某个
// 词没有哪个模型以其为 id,则每个这样的 agent 出现一行,可在该 id 上启动(`typed`)。
// 每行:{ agent, ...model, pinned };每个分组:{ key, title, agent, rows, more }。
export const CAP = 200;
export function modelSections(menus, agent, picks, q) {
  picks = picks ?? { pinned: [], recent: [] };
  const query = String(q ?? "").trim();
  const order = (k, models) => {
    const rank = (m) => {
      const key = pickKey(k, m.id), p = picks.pinned.indexOf(key), r = picks.recent.indexOf(key);
      return p >= 0 ? p : r >= 0 ? 1000 + r : 2000;
    };
    return models.map((m, i) => ({ m, i, r: rank(m) })).sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ m }) => ({ agent: k, ...m, pinned: picks.pinned.includes(pickKey(k, m.id)) }));
  };
  // 按 id 输入的 pinned 或 recent 模型(CLI 列表中没有)仍保留为可选项
  const saved = (k) => {
    const models = menus?.[k]?.models ?? [], known = new Set(models.map((m) => m.id));
    const ids = [...new Set([...picks.pinned, ...picks.recent].filter((x) => x.startsWith(`${k}:`)).map((x) => x.slice(k.length + 1)))];
    return [...models, ...ids.filter((id) => !known.has(id)).map((id) => ({ ...typedModel(k, id), typed: false }))];
  };
  const capped = (key, title, k, rows) => ({ key, title, agent: k, rows: rows.slice(0, CAP), more: Math.max(0, rows.length - CAP) });
  if (!query) {
    const rows = order(agent, saved(agent));
    const pinned = rows.filter((r) => r.pinned);
    const recent = rows.filter((r) => !r.pinned && picks.recent.includes(pickKey(agent, r.id)));
    const rest = rows.filter((r) => !r.pinned && !picks.recent.includes(pickKey(agent, r.id)));
    return [
      ...(pinned.length ? [capped("pinned", "Pinned", agent, pinned)] : []),
      ...(recent.length ? [capped("recent", "Recent", agent, recent)] : []),
      ...(rest.length ? [capped("all", pinned.length || recent.length ? "全部模型" : "Models", agent, rest)] : []),
    ];
  }
  const out = [];
  // 显示的 agent 排最前,其余按常规顺序
  for (const k of [agent, ...Object.keys(menus ?? {}).filter((x) => x !== agent)]) {
    const m = menus?.[k];
    if (!m) continue;
    const rows = order(k, saved(k).filter((x) => modelMatches(x, query)));
    if (rows.length) out.push(capped(k, m.name, k, rows));
  }
  // 可能是 id 的单个词且没有任何模型用它:按输入原样在该 id 上启动任意 agent
  if (/^[\w.\[\]-]{2,60}$/.test(query)) {
    const rows = [agent, ...Object.keys(menus ?? {}).filter((x) => x !== agent)]
      .filter((k) => menus?.[k] && !saved(k).some((m) => m.id === query)).map((k) => ({ agent: k, ...typedModel(k, query), pinned: false }));
    if (rows.length) out.push({ key: "typed", title: "使用输入的 id", agent, rows, more: 0 });
  }
  return out;
}

// picker 中代表当前运行配置的行(`c` 来自 current()),或模型本身。
export function rowFor(agent, c) {
  if (agent !== "claude") return c?.model ?? null;
  const has = (m, x) => (m.match ?? [m.id]).includes(x);
  // 以实际运行的(日志中的模型)为准;启动时的 alias 只用于指认
  // 那个模型(Opus 或 Opus 1M),因为日志对两者写法相同。
  const byAlias = c?.alias ? CLAUDE_MODELS.find((m) => has(m, c.alias)) : null;
  const byModel = c?.model ? CLAUDE_MODELS.find((m) => has(m, c.model)) : null;
  const same = byAlias && (!c?.model || (byAlias.match ?? [byAlias.id]).some((x) => x.replace(/\[1m\]$/, "") === c.model));
  return (same ? byAlias : byModel ?? byAlias)?.id ?? c?.model ?? null;
}

// 关于恢复什么、用哪个模型、effort 或速度的 flags:重启时重新设置。
const CLAUDE_DROP = new Set(["--model", "--effort", "--settings", "--session-id", "--resume", "-r", "--permission-mode"]);
const CLAUDE_BARE = new Set(["--continue", "-c", "--fork-session", "--dangerously-skip-permissions"]);
// 下一个词是其值的 flags(以免被误当作首条消息)。
const CLAUDE_VALUE = new Set(["--add-dir", "--mcp-config", "--append-system-prompt", "--system-prompt",
  "--allowedTools", "--allowed-tools", "--disallowedTools", "--disallowed-tools", "--agent", "--agents", "--plugin-dir",
  "--fallback-model", "--output-format", "--input-format", "--name", "--setting-sources", "--betas", "--debug-file"]);
const CODEX_VALUE = new Set(["-c", "--config", "-m", "--model", "-p", "--profile", "-s", "--sandbox", "-a", "--ask-for-approval",
  "-C", "--cd", "--add-dir", "-i", "--image", "--enable", "--disable", "--local-provider", "--oss"]);

// 旧 agent 值得保留的 flags(permissions、folders 等),不含会被重新选择的项
// 或首条消息。
function kept(kind, argv) {
  const out = [];
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (kind === "claude") {
      if (CLAUDE_BARE.has(a)) continue;
      if (CLAUDE_DROP.has(a)) { if (rest[i + 1] && !rest[i + 1].startsWith("-")) i++; continue; }
      if ([...CLAUDE_DROP].some((f) => a.startsWith(f + "="))) continue;
      if (CLAUDE_VALUE.has(a)) { out.push(a, rest[++i]); continue; }
      if (a.startsWith("-")) out.push(a);
    } else {
      if (i === 0 && (a === "resume" || a === "fork")) { if (rest[1] && !rest[1].startsWith("-")) i++; continue; }
      if (a === "--no-daemon" || a === "--dangerously-bypass-approvals-and-sandbox" || a === "--full-auto") continue;
      if (["-m", "--model", "-s", "--sandbox", "-a", "--ask-for-approval"].includes(a)) { i++; continue; }
      if ((a === "-c" || a === "--config") && /^(model|model_reasoning_effort|service_tier)=/.test(rest[i + 1] ?? "")) { i++; continue; }
      if (CODEX_VALUE.has(a)) { out.push(a, rest[++i]); continue; }
      if (a.startsWith("-")) out.push(a);
    }
  }
  return out.filter((x) => x !== undefined);
}

// 与 `argv` 相同的 agent、模型和 flags,去掉恢复会话的参数(也去掉
// 首条消息),argv 未恢复会话时为 null:会话消失后用于全新开始。
export function freshArgv(kind, argv) {
  argv = argv ?? [];
  const at = argv.findIndex((a, i) => (i === 0 || !a.startsWith("-")) && /^(claude|codex)$/.test(String(a).split("/").pop()));
  if (at < 0) return null;
  const rest = argv.slice(at + 1), out = [argv[at]];
  let resumed = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (kind === "claude") {
      if (a === "--resume" || a === "-r" || a === "--session-id") { resumed ||= a !== "--session-id"; if (rest[i + 1] && !rest[i + 1].startsWith("-")) i++; continue; }
      if (/^--(resume|session-id)=/.test(a)) { resumed ||= a.startsWith("--resume"); continue; }
      if (a === "--continue" || a === "-c") { resumed = true; continue; }
      if (a === "--fork-session") continue;
      if (CLAUDE_VALUE.has(a) || ["--model", "--effort", "--settings", "--permission-mode"].includes(a)) { out.push(a, rest[++i]); continue; }
    } else {
      if (i === 0 && (a === "resume" || a === "fork")) { resumed = true; continue; }
      if (a === "--last") continue;
      if (CODEX_VALUE.has(a)) { out.push(a, rest[++i]); continue; }
    }
    // 既不是 flag 也不是 flag 值的词:会话 id 或首条消息。
    if (a.startsWith("-")) out.push(a);
  }
  return resumed ? out.filter((x) => x !== undefined) : null;
}

// 启动所选 agent 的方式:{ argv, resume }(resume:argv 已包含继续会话的参数)。
// `session`:可恢复时旧会话的 id(仅限同一 agent)。
export function argvFor(pick, old) {
  const same = pick.agent === old.agent;
  const flags = same ? kept(pick.agent, old.argv ?? []) : [];
  if (pick.agent === "claude") {
    const a = ["claude", ...flags];
    if (pick.model) a.push("--model", pick.model);
    if (pick.effort) a.push("--effort", pick.effort);
    a.push("--settings", JSON.stringify({ fastMode: Boolean(pick.fast) }));
    if (pick.perm === "bypassPermissions") a.push("--dangerously-skip-permissions");
    else if (pick.perm) a.push("--permission-mode", pick.perm === "manual" ? "default" : pick.perm);
    if (same && old.session) return { argv: [...a, "--resume", old.session], resume: true, base: a };
    return { argv: a, resume: false, base: a };
  }
  // Codex 在 hc 之外运行命令时不加 --no-daemon(herdr-task 和 restart.sh 会自动加上)。
  const a = [...flags, "--no-daemon"];
  if (pick.model) a.push("-m", pick.model);
  if (pick.effort) a.push("-c", `model_reasoning_effort="${pick.effort}"`);
  // 总是明确设置,因此 Fast off 优先于 config.toml 里的 service_tier(默认:标准档)
  a.push("-c", `service_tier="${pick.fast ? "fast" : "default"}"`);
  if (pick.perm === "full") a.push("--dangerously-bypass-approvals-and-sandbox");
  else if (pick.perm === "read-only") a.push("-s", "read-only", "-a", "on-request");
  else if (pick.perm) a.push("-s", "workspace-write", "-a", "on-request");
  if (same && old.session) return { argv: ["codex", "resume", ...a, old.session], resume: true, base: ["codex", ...a] };
  return { argv: ["codex", ...a], resume: false, base: ["codex", ...a] };
}

// 会话的 id,取自其日志的文件名。
export function sessionOf(kind, path) {
  const m = kind === "claude" ? /([0-9a-f-]{36})\.jsonl$/.exec(path ?? "") : /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(path ?? "");
  return m ? m[1] : null;
}

// 会话的副本,出现在本 tab 旁的新 tab 中,经 CLI 自身的 fork。
export function forkArgv(kind, argv, session) {
  argv = argv ?? [];
  // 与原来相同的模型、effort 和速度。
  const same = kind === "claude"
    ? ["--model", "--effort", "--settings"].flatMap((f) => { const v = flag(argv, f); return v ? [f, v] : []; })
    : (() => {
      const m = flag(argv, "-m", "--model"), o = overrides(argv);
      return [...(m ? ["-m", m] : []), "--no-daemon",
        ...["model_reasoning_effort", "service_tier"].flatMap((k) => (o[k] ? ["-c", `${k}="${o[k]}"`] : []))];
    })();
  const flags = [...kept(kind, argv), ...same];
  return kind === "claude" ? ["claude", ...flags, "--resume", session, "--fork-session"] : ["codex", "fork", ...flags, session];
}
