// 本机的 herdr-winapp service,在窗口与之通信前先发现并校验。service 会写入
// 监听位置和每次启动的新 id 写入 service.json(~/.local/state/herdr-winapp/service;service/main.ts);其 health 应答
// 该 id 提供给本机的调用方。因此端口绝不写死在这里(SHEPHERDR_PORT、`install --port` 可移动它),
// 而占用该端口的其他程序(service 未启动)永远拿不到 token 或 shared state。
// 共享文件:源文件是 lib/local.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的每个 mod 里。
// 编辑 lib/local.js(不要编辑 mod 里的副本),然后运行 bin/sync-shared。

import { readTextFile } from "herdr";
import { dirsReady } from "./dirs.js";

const DATA = async () => (await dirsReady()).service;

/* service 报告的监听位置及其 id:{ port, id },或 null(从未在本机启动)。 */
export async function serviceFile() {
  const f = JSON.parse((await readTextFile(`${await DATA()}/service.json`).catch(() => null)) ?? "null");
  return f && Number.isInteger(f.port) && f.port > 0 && typeof f.id === "string" && f.id ? f : null;
}

/* service 的健康状况和调用地址,仅在应答者确实是 herdr-winapp 的 service 时:{ base, health } 或 null。带 cx 时 1.5 秒后放弃。 */
export async function localService(cx) {
  const f = await serviceFile();
  if (!f) return null;
  const base = `http://127.0.0.1:${f.port}`;
  const ask = fetch(`${base}/api/health`).then((r) => (r.ok ? r.json() : null));
  const health = await (cx ? Promise.race([ask, cx.sleep(1500).then(() => null)]) : ask).catch(() => null);
  return health?.id === f.id ? { base, health } : null;
}

/* 本机调用方出示给 service 的 token(token 存于其文件夹),或 null。 */
export async function localToken() {
  return (await readTextFile(`${await DATA()}/token`).catch(() => null))?.trim() || null;
}
