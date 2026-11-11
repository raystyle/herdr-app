// 窗口里最后持有键盘的一方(shared "keyboard.holder" = { who, at }):chat 的输入框(其 areaKey():其
// pane,或 Tasks panel 中任务 chat 的 "thread"),或 Tasks panel 的列表与搜索("tasks")。Tasks
// panel 是 layout block 而非 pane,因此用户操作 Tasks panel 时 Herdr 仍把 Assistant chat 的 pane 算作聚焦,
// 那里的 chat 只在自己持有键盘时才把键盘还给自己的输入框(#633)。
import { shared, setShared } from "herdr";

export const KEY_HOLDER = "keyboard.holder";

// `who` 中的按下或聚焦:它现在持有键盘(仅在该状态变化时写入)。
export function holdKeys(who) {
  if (!who || shared(KEY_HOLDER)?.who === who) return;
  setShared(KEY_HOLDER, { who, at: Date.now() });
}

// 上一次持有键盘的是否不是 `mine`。
export const keysElsewhere = (holder, mine) => Boolean(holder?.who && holder.who !== mine);

// 带文本框的对话框(New space,#752)打开期间持有键盘:“dialog:<name>”,其 `at` 不断刷新
// 每隔几秒续期(keepKeys()),悄然消失的一方很快便不再持有。其后的 chat 不收回任何东西
// 期间不会重置,即使 agent 重启或其 pane 重新聚焦也一样。
export const DIALOG_FRESH = 6000;
const isDialog = (holder) => String(holder?.who ?? "").startsWith("dialog:");

export function keepKeys(who, now = Date.now()) {
  const h = shared(KEY_HOLDER);
  if (h?.who === who && now - (h.at ?? 0) < DIALOG_FRESH / 3) return;
  setShared(KEY_HOLDER, { who, at: now });
}

// 对话框关闭:无人持有键盘,背后的 chat 因此把键盘还给自己的输入框。
export function dropKeys(who) {
  if (shared(KEY_HOLDER)?.who === who) setShared(KEY_HOLDER, { who: null, at: Date.now() });
}

// 对话框现在持有键盘。
export const dialogHolds = (holder, now = Date.now()) => isDialog(holder) && now - (holder.at ?? 0) < DIALOG_FRESH;

// 当前生效的持有者:未被续期的对话框持有权视为无人持有。
export const liveHolder = (holder, now = Date.now()) => (isDialog(holder) && !dialogHolds(holder, now) ? null : holder);
