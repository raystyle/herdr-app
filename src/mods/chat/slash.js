// 消息框上方 "/" 列表的 slash 命令。用户输入的内容都会送往
// agent 按原样接收;这里只提供建议。会在 CLI 中打开菜单的命令(没有
// 带参数)需要终端,因此发送后聊天切到终端。

import { exec } from "herdr";

// 列表与扫描逻辑在 core/slash.js,与 web 应用共享。
import { SCAN, scanned, commandList } from "./core/slash.js";
export { opensMenu, typing, match } from "./core/slash.js";

const cache = new Map();
// 该 agent 认识的每个命令:[{ name, about }],内置的在前。按 machine 与文件夹缓存。
export async function commands(kind, machine, cwd) {
  if (kind !== "claude") return commandList(kind);
  const k = `${machine ?? ""}|${cwd ?? ""}`;
  if (!cache.has(k)) cache.set(k, exec("sh", ["-c", SCAN, "scan", cwd ?? ""], { on: machine }).then((r) => scanned(r.stdout)).catch(() => []));
  return commandList(kind, await cache.get(k));
}
