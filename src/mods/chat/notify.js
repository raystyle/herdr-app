// 窗口中的 Notify:规则在 core/notify.js(与 service 和 web app 共享);设置
// 此处为共享 “notify”。space 行的菜单设置该 space 的(mods/spaces-chat),herdr-winapp settings 的 Notify
// 任何一处(mods/herdr-winapp-settings)。选择本就会得到的值则回到跟随模式。
// 共享文件:源为 lib/notify.js;bin/sync-shared 会把它复制到 lib/COPIES 里的每个 mod。
// 请编辑 lib/notify.js,不要改 mod 里的副本,然后运行 bin/sync-shared。

import { shared, setShared } from "herdr";
import { everywhereOf, machineLevel, machineOwn, spaceLevel, spaceOwn, withSpace, withMachine, withEverywhere, notifiesBy } from "./core/notify.js";

export { NOTIFY, NOTIFY_DEFAULT, NOTIFY_HINT, spaceOfTerminal } from "./core/notify.js";

const stored = () => shared("notify") ?? {};

export const notifyEverywhere = () => everywhereOf(stored());
export const notifyMachine = (m) => machineLevel(stored(), m);
export const notifyMachineOwn = (m) => machineOwn(stored(), m);
export const notifyOf = (space) => spaceLevel(stored(), space);
export const notifyOwn = (space) => spaceOwn(stored(), space);
export const muted = (space) => notifyOf(space) === "Off";

export const setNotify = (space, value) => setShared("notify", withSpace(stored(), space, value));
export const setNotifyMachine = (m, value) => setShared("notify", withMachine(stored(), m, value));
export const setNotifyEverywhere = (value) => setShared("notify", withEverywhere(stored(), value));

export const notifies = (k, kind) => notifiesBy(stored(), k, kind);
