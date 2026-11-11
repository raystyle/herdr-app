// herdr-winapp 的常驻 service(3.1,service/main.ts):运行期间承担不依赖窗口的后台工作
// 本窗口所显示的内容(任务 tick、向其他机器提供 secrets),因此窗口把这些交给它:同一时刻只有一个在跑
// 一次处理一个。服务消失(停止或未安装)时,窗口像 3.0 那样重新安装,并每
// 分钟最多一次。service 的健康状况表明它是否接手了这些工作(jobs)。
// 共享文件:源文件是 lib/service.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的每个 mod 里。
// 编辑 lib/service.js(不要编辑 mod 里的副本),然后运行 bin/sync-shared。

import { exec } from "herdr";
import { localService } from "./local.js";

let runs = false, started = false, startedAt = 0;

// 后台工作现在由 service 承担。
export const serviceRuns = () => runs;

async function check(cx) {
  // 只有 herdr-winapp 自己的 service 算数(local.js):占用其端口的其他程序视为 "not answering"
  const r = (await localService(cx).catch(() => null))?.health ?? null;
  runs = r?.jobs === true;
  // 无响应:启动它(其 systemd user unit 或 launchd agent),每分钟最多一次。
  if (!r && Date.now() - startedAt > 60000) {
    startedAt = Date.now();
    exec("sh", ["-c", 'systemctl --user start herdr-winapp.service 2>/dev/null || launchctl kickstart "gui/$(id -u)/dev.herdr-winapp.service" 2>/dev/null; true']).catch(() => {});
  }
}

// 来自常驻加载的 tab bar 的 init:立即检查一次,之后每 10 秒一次。
export function watchService(cx) {
  if (started) return;
  started = true;
  cx.spawn(async (cx) => check(cx));
  cx.timer.every(10000, (cx) => cx.spawn(async (cx) => check(cx)));
}
