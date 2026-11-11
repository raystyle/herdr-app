// herdr-winapp 在本机存放数据的位置,供窗口的 mod 使用(core/paths.js;迁移:
// mods/tasks/bin/herdr_task/layout.py):一旦迁移即为 ~/.local/share/herdr-winapp/tasks、~/.config/herdr-winapp/settings.json、...
// 本机数据已迁移过去则为该路径,否则为旧的 ~/.herdr 路径。mod 没有自己的环境,因此首次使用
// 会先向 shell 询问一次(SHEPHERDR_HOME、XDG_*、LAYOUT 文件);应答前 dirs() 返回旧路径,这些路径
// 迁移后指向新路径,因此无论何时读取都正确。
// dirs().tasks、dirs().settings、dirs().artifacts、...     当前值(同步)
// await dirsReady()                          拿到应答后,dirs() 即为准确
// 在其他机器上:把 SH(core/paths.js)放在脚本开头,使用 $SHEP_TASKS、$SHEP_SETTINGS、...
// 共享文件:源为 lib/dirs.js;bin/sync-shared 会把它复制到 lib/COPIES 里的每个 mod。

import { home, exec } from "herdr";
import { pathsFrom, SH_PRINT } from "./core/paths.js";

let known = null;
let asking = null;
let at = 0;

const fallback = () => {
  const h = home();
  return pathsFrom(h, { config: `${h}/.config/herdr-winapp`, data: `${h}/.local/share/herdr-winapp`, state: `${h}/.local/state/herdr-winapp` }, false);
};

/* 向本机 shell 询问一次(`again` 之后再次询问,例如数据迁移后)。 */
export function dirsReady(again = false) {
  if (again) asking = null;
  asking ??= exec("sh", ["-c", SH_PRINT]).then((r) => {
    const j = JSON.parse(String(r?.stdout ?? "").trim().split("\n").pop() || "null");
    at = Date.now();
    if (j?.home && j.data) known = pathsFrom(j.home, { config: j.config, data: j.data, state: j.state }, !!j.on);
    return dirs();
  }).catch(() => dirs());
  return asking;
}

dirsReady();   // 会立即询问一次,因此窗口的首次写入就已落到准确位置

/* 本机当前路径:dirsReady() 应答后即为准确,否则为旧路径(但仍指向同一处)。 */
export function dirs() {
  if (!known && !asking) dirsReady();
  // 之后每 10 秒重新询问一次,因此窗口运行期间的迁移(或回滚)会被跟进;在此之前旧路径
  // 指向同一份数据,且回滚后紧接着写在新路径的内容会被收回(layout.heal_back)
  else if (known && Date.now() - at > 10_000) { at = Date.now(); dirsReady(true); }
  return known ?? fallback();
}
