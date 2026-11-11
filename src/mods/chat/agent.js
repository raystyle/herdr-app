// agent 的运行配置(agent、model、effort、speed、context),用于
// 消息框,以及用其他选项重启它。日志注明其实际运行于
// (log.js `meta`);其参数与设置补充日志未记录的部分。
// 重启复用 Herdr 自己的途径:task 的 agent 用 `herdr-task switch`,否则用
// coordinator 的 restart.sh。同一 agent 续接其会话;换成别的则做交接。
// 无论哪种方式,新 agent 都以停驻在聊天之后的方式启动(core 标签 herdr.chat)。
// Shared:源文件为 lib/agent.js;bin/sync-shared 复制进 lib/COPIES 中的每个 mod。
// 请编辑 lib/agent.js,不要改 mod 里的副本,然后运行 bin/sync-shared。

import { exec, hc, appHome } from "herdr";
// 规则(名称、菜单、argv)在 core/agents.js,与 web 应用共享。
import { DEFAULTS, parseDefaults } from "./core/agents.js";
import { chatLabel } from "./core/spaces.js";
export * from "./core/agents.js";

export async function defaults(kind, machine) {
  const r = await exec("sh", ["-c", DEFAULTS, "defaults", kind], { on: machine }).catch(() => null);
  return parseDefaults(kind, r?.stdout ?? "");
}

// 用 `argv` 重启 agent `t`(hc get 的 record),停驻在 chat pane `pane` 之后。
// 以新 agent 的地址 resolve。
export async function restart(t, built, pane) {
  const task = t.labels?.["herdr.task"];
  if (task) {
    // agent 不变时 herdr-task 恢复自己的 session。
    const r = await exec("herdr-task.cmd", ["switch", task, "--folder", t.foreground?.cwd ?? t.cwd, "--argv", JSON.stringify(built.base), "--json"]);
    let out = {};
    try { out = JSON.parse(r.stdout || "{}"); } catch {}
    if (r.code !== 0 || !out.terminal) throw new Error((r.stderr || r.stdout).trim() || "herdr-task switch failed");
    const origin = t.labels?.["herdr.chat.origin"] || t.address;
    await hc(["label", out.terminal, `herdr.chat=${chatLabel(pane)}`, `herdr.chat.origin=${origin}`]);
    // 它由 tab 启动:停驻在此聊天之后,与 Chat 开关的做法一致。
    await exec("herdr-app", ["do", "terminal.park", "--terminal", out.terminal]);
    return out.terminal;
  }
  const env = `HERDR_RESTART_CHAT="$1"${built.resume ? " HERDR_RESTART_RESUME=1" : ""}`;
  const r = await exec("sh", ["-c", `${env} bash "$2" "$3" "$4"`, "x", chatLabel(pane), `${appHome()}/mods/coordinator/restart.sh`, t.address, JSON.stringify(built.argv)]);
  const addr = r.stdout.trim().split("\n").pop();
  if (r.code !== 0 || !addr) throw new Error(r.stderr.trim() || "The agent didn't restart.");
  return addr;
}

