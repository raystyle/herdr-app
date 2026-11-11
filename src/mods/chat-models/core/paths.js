// herdr-winapp 自身数据的存放位置:用它自己的 `herdr-winapp` 文件夹,绝不放在 Herdr 名下。唯一
// 源为 mods/tasks/bin/herdr_task/layout.py(迁移、修复、回滚);这里是它的表和 shell,供
// 窗口的 mod、service 和 web app 使用。test/test_layout.py 校验两者说法一致。
// config ~/.config/herdr-winapp        settings.json、model-picks.json
// data   ~/.local/share/herdr-winapp   tasks/、artifacts/、secrets/、worktrees/、tools.json、LAYOUT
// state  ~/.local/state/herdr-winapp   service/、browser/、secret-drop/、secret-served/、cli-check.json、machine-hold.json
// SHEPHERDR_HOME=<root> 会把它们放在 <root>/{config,data,state,cache} 下;否则遵循 XDG_*。在机器的
// 数据迁移前(data/LAYOUT 为 2)每种类型都是旧的 ~/.herdr 路径;之后旧路径指向新路径,因此
// 无论新旧机器,在哪一边读取都正确。
// 共享核心:源为 core/paths.js;bin/sync-shared 会把它复制到 lib/COPIES 里的各 mod。

export const LAYOUT = 2;
export const LEGACY = ".herdr";
export const ROLLBACK = ".layout-rollback";

// 类型: [home 下的旧路径, base, base 下的新路径]
export const KINDS = {
  "settings": [".herdr/herdr-winapp.json", "config", "settings.json"],
  "model-picks": [".herdr/model-picks.json", "config", "model-picks.json"],
  "tasks": [".herdr/tasks", "data", "tasks"],
  "artifacts": [".herdr/artifacts", "data", "artifacts"],
  "vault": [".herdr/vault.json", "data", "secrets/vault.json"],
  "secret-remote": [".herdr/secret-remote", "data", "secrets/remote"],
  "tools": [".herdr/tools.json", "data", "tools.json"],
  "service": [".herdr/herdr-winapp", "state", "service"],
  "browser": [".herdr/browser", "state", "browser"],
  "secret-drop": [".herdr/secret-drop", "state", "secret-drop"],
  "secret-served": [".herdr/secret-served", "state", "secret-served"],
  "cli-check": [".herdr/cli-check.json", "state", "cli-check.json"],
  "machine-hold": [".herdr/machine-hold.json", "state", "machine-hold.json"],
};

const abs = (p) => (typeof p === "string" && p.startsWith("/") ? p.replace(/\/+$/, "") : null);

/* 给定 home 及其环境(SHEPHERDR_HOME,其次 XDG_*,再默认值)的 { config, data, state, cache }。 */
export function roots(home, env = {}, mac = false) {
  const one = abs(env.SHEPHERDR_HOME);
  if (one) return { config: `${one}/config`, data: `${one}/data`, state: `${one}/state`, cache: `${one}/cache` };
  const x = (v, dflt) => `${abs(env[v]) ?? `${home}/${dflt}`}/herdr-winapp`;
  return { config: x("XDG_CONFIG_HOME", ".config"), data: x("XDG_DATA_HOME", ".local/share"), state: x("XDG_STATE_HOME", ".local/state"),
           cache: abs(env.XDG_CACHE_HOME) ? `${abs(env.XDG_CACHE_HOME)}/herdr-winapp` : `${home}/${mac ? "Library/Caches" : ".cache"}/herdr-winapp` };
}

/* 每种类型的路径:`migrated` 时为新路径,否则为旧路径。外加 worktrees(新 worktree 的去处)。@returns {ShepPaths} */
export function paths(home, env = {}, migrated = false, mac = false) {
  return pathsFrom(home, roots(home, env, mac), migrated);
}

/*
 * @typedef {{ roots: { config: string, data: string, state: string, cache?: string }, migrated: boolean, settings: string, "model-picks": string, tasks: string, artifacts: string, vault: string, "secret-remote": string, tools: string, service: string, browser: string, "secret-drop": string, "secret-served": string, "cli-check": string, "machine-hold": string, worktrees: string }} ShepPaths
 */

/*
 * 由已知 roots 得到的同样结果(即 SH_PRINT 在那台机器上打印的内容)。@param {string} home @param {{ config: string, data: string, state: string, cache?: string }} r @param {boolean} migrated @returns {ShepPaths}
 */
export function pathsFrom(home, r, migrated = false) {
  /* @type {any} */
  const out = { roots: r, migrated };
  for (const [k, [old, base, rel]] of Object.entries(KINDS)) out[k] = migrated ? `${r[base]}/${rel}` : `${home}/${old}`;
  out.worktrees = migrated ? `${r.data}/worktrees` : `${home}/.herdr/worktrees`;
  return out;
}

/* 判断 LAYOUT 文件的内容(且无回滚标记)是否表示新 layout。 */
export const isMigrated = (layoutText, rolledBack = false) => !rolledBack && Number(String(layoutText ?? "").trim().split(/\s+/)[0]) >= LAYOUT;

/* task worktree 的路径(任何机器上、由本版或旧版 herdr-winapp 在任何根目录下创建的):不列入用户工作文件夹的列表。 */
export const WORKTREE_RE = /\/(\.herdr|herdr-winapp)\/worktrees\//;
export const isWorktreePath = (p) => !!p && WORKTREE_RE.test(`${p}/`);

const shVar = (k) => "SHEP_" + k.toUpperCase().replace(/-/g, "_");

// Shell(任何机器,新旧皆可,经 herdr-core 运行):设置 SHEP_CONFIG、SHEP_DATA、SHEP_STATE,每种
// 类型一个变量(SHEP_TASKS、SHEP_SETTINGS、SHEP_ARTIFACTS、...),该机器数据迁移后即为新路径,否则为
// 旧路径。放在 `sh -c` 脚本的开头。
export const SH = [
  'if [ -n "${SHEPHERDR_HOME:-}" ]; then SHEP_CONFIG="$SHEPHERDR_HOME/config"; SHEP_DATA="$SHEPHERDR_HOME/data"; '
    + 'SHEP_STATE="$SHEPHERDR_HOME/state"; else SHEP_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/herdr-winapp"; '
    + 'SHEP_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/herdr-winapp"; SHEP_STATE="${XDG_STATE_HOME:-$HOME/.local/state}/herdr-winapp"; fi',
  `if [ "$(cat "$SHEP_DATA/LAYOUT" 2>/dev/null | cut -c1)" = "${LAYOUT}" ] && [ ! -e "$HOME/${LEGACY}/${ROLLBACK}" ]; then`,
  Object.entries(KINDS).map(([k, [, b, rel]]) => `${shVar(k)}="$SHEP_${b.toUpperCase()}/${rel}";`).join(" "),
  "else",
  Object.entries(KINDS).map(([k, [old]]) => `${shVar(k)}="$HOME/${old}";`).join(" "),
  "fi",
].join("\n") + "\n";

// Python(3.8+),用于在其他机器上运行的脚本(python3 -c):SHEP(".herdr/vault.json") 即该路径在那台
// 机器上,新旧以该机器为准。需要 `import os`。文本与 layout.py 的 PY 相同(test/test_layout.py 校验)。
const pyTable = "{" + Object.values(KINDS).map(([old, b, rel]) => `'${old}': ('${b}', '${rel}')`).join(", ") + "}";
export const PY = `
def SHEP(rel, _t=${pyTable}):
    H, E = os.path.expanduser("~"), os.environ
    a = lambda v: E.get(v) if (E.get(v) or "").startswith("/") else None
    one = a("SHEPHERDR_HOME")
    R = dict((k, os.path.join(one, k)) for k in ("config", "data", "state")) if one else {
        "config": os.path.join(a("XDG_CONFIG_HOME") or os.path.join(H, ".config"), "herdr-winapp"),
        "data": os.path.join(a("XDG_DATA_HOME") or os.path.join(H, ".local", "share"), "herdr-winapp"),
        "state": os.path.join(a("XDG_STATE_HOME") or os.path.join(H, ".local", "state"), "herdr-winapp")}
    try:
        with open(os.path.join(R["data"], "LAYOUT")) as f:
            on = int((f.read().split() or ["0"])[0]) >= ${LAYOUT} and not os.path.lexists(os.path.join(H, "${LEGACY}", "${ROLLBACK}"))
    except (OSError, ValueError):
        on = False
    if on:
        for old, (base, new) in _t.items():
            if rel == old or rel.startswith(old + "/"):
                return os.path.join(R[base], new + rel[len(old):])
    return os.path.join(H, rel)
`;

/* 一个把本机路径打印为 JSON 的脚本,供没有自己环境的调用方(窗口)使用。 */
export const SH_PRINT = SH + 'printf \'{"home":"%s","config":"%s","data":"%s","state":"%s","on":%s}\\n\' "$HOME" "$SHEP_CONFIG" "$SHEP_DATA" "$SHEP_STATE" '
  + `"$( [ "$SHEP_TASKS" = "$SHEP_DATA/tasks" ] && echo true || echo false )"`;
