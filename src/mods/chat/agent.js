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
  // 重启:以相同 argv 新开 tab 启动 agent,标上 herdr.chat 停驻到本聊天之后,
  // 原 terminal 随之结束。会话续接交给 agent CLI 自己的 resume 参数。
  const cwd = t.foreground?.cwd ?? t.cwd ?? null;
  const origin = t.labels?.["herdr.chat.origin"] || t.address;
  const argv = built.argv ?? t.argv ?? [];
  const made = await exec("herdr-app", [
    "do", "tab.new",
    "--argv", JSON.stringify(argv),
    ...(cwd ? ["--folder", cwd] : []),
    "--json",
  ]).catch(() => null);
  let addr = "";
  try { addr = JSON.parse(made?.stdout || "{}").terminal ?? ""; } catch {}
  if (!addr) throw new Error((made?.stderr || made?.stdout || "").trim() || "agent 没有重启。");
  await hc(["label", addr, `herdr.chat=${chatLabel(pane)}`, `herdr.chat.origin=${origin}`]);
  await exec("herdr-app", ["do", "terminal.park", "--terminal", addr]);
  await hc(["kill", t.address]).catch(() => {});
  return addr;
}

