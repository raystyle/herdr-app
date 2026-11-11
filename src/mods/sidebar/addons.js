// Add-ons(herdr-winapp 3.0.0,一切皆插件):每个功能都可在 herdr-winapp
// settings > Window。lib/addons.json 记录每个 add-on 的名称、组成和依赖;
// 没有 “switch” 的 add-on 始终开启。关闭列表存于两处,内容一致:
// 共享 “addons.off”(窗口 mod 读取,flip 立即生效)和 “everywhere.off”
// 位于 ~/.config/herdr-winapp/settings.json(由 settings 窗口写入,随 Everywhere 其余部分推送至其他机器;
// herdr-task 读取它用于后台工作:autopilot、browsers、同步
// (推送至其他机器)。
// 共享文件:源为 lib/addons.js;bin/sync-shared 会把它复制到 lib/COPIES 里的每个 mod。
// 请编辑 lib/addons.js,不要改 mod 里的副本,然后运行 bin/sync-shared。
// on("voice")                  仅当用户手动关闭时为 false
// await manifest()             lib/addons.json,按已安装状态(appHome()/lib)
// flip("voice", false)         新的关闭列表,已在 shared state 中:保存为 “off”

import { shared, setShared, appHome, readTextFile } from "herdr";

export const off = () => (Array.isArray(shared("addons.off")) ? shared("addons.off") : []);

export const on = (id) => !off().includes(id);

let cached = null;
export function manifest() {
  cached ??= readTextFile(`${appHome()}/lib/addons.json`).then((s) => JSON.parse(s ?? "null")).catch(() => null);
  return cached;
}

// 阻止 flip 的情况:开启 `id` 需先开启其依赖;关闭则要等到依赖它的
// 依赖它的 add-on 全部关闭。碍事的 id 列表,无则 []。
export function blockers(m, id, next) {
  const all = m?.addons ?? [];
  if (next) return (all.find((a) => a.id === id)?.needs ?? []).filter((n) => !on(n));
  return all.filter((a) => on(a.id) && (a.needs ?? []).includes(id)).map((a) => a.id);
}

export function flip(id, next) {
  const list = next ? off().filter((x) => x !== id) : [...new Set([...off(), id])];
  setShared("addons.off", list);
  return list;
}
