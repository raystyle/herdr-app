// machine 健康与 plan 限额,同 herdr-winapp 的 health 与 limits 插件:每台
// machine 的 CPU、内存与磁盘,以及各 agent CLI 的剩余 plan,在
// machine 本身由 mods/tasks/bin/herdr_task/machine.py 处理(经 `hc exec --on` 发送,不
// 已安装)。健康状态每 45 秒,plan 限额每 10 分钟(或按需),绝不在每次 render 时。
// Shared:源文件为 lib/machines.js;bin/sync-shared 复制进 lib/COPIES 中的每个 mod。
// 请编辑 lib/machines.js,不要改 mod 里的副本,然后运行 bin/sync-shared。
// startPolling(cx)                 由 init(侧边栏)调用:保持每台机器的数据新鲜
// pollNow({ limitsOlder, only })   立即重新读取(打开详情视图时)
// statsOf(machine)                 { health, limits, agents, hold, at, limitsAt, error } 或 null
// healthMeters(stats) / healthLevel(stats)    CPU、Memory、Disk,取值 ok | busy | over
// planRows(stats) / planLevel(stats)          每个已安装 agent CLI 的 plan(或 "No usage info")
// bars(t, items, h)               细竖条,每个 meter 或 plan 一条
// machineDetails(t, machine)      完整块:先 health,再各 CLI 的 plan 用量
// Shared state 的 "machines.stats" = { [machine 名,本机为 ""]: stats },一次性写入
// 每轮。启动上限(Settings > Machines)存于 herdr-winapp 的设置文件:
// everywhere.machine 与 machines[name 或 "local"].machine,各为 { start_load (× cores),
// start_memory、start_disk }(herdr-task 的 tick 依据它们暂扣新任务)。

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, shared, setShared, appHome, home, machines, knownAgents, readTextFile } from "herdr";
import { heading } from "./ui.js";
import { dirs } from "./dirs.js";
// 计量条、其档位与起始阈值:core/machines.js,与 web 应用共享。
// 其文字(详情区文案、plan 行)亦然:web 端机器弹窗读同一份。
import { HOLD, ALERT, settingsKey, holdOf, nextRead, healthMeters, healthLevel, healthWords, planLevelOf, planRows, planLevel, span,
  meterSub, healthReadWords, noHealthWords, noPlanWords, cliTitle, readOld, windowWords, failedWords, whyWords, ago, NO_USAGE,
  READING_MACHINE } from "./core/machines.js";
export { HOLD, ALERT, settingsKey, holdOf, healthMeters, healthLevel, healthWords, planLevelOf, planRows, planLevel, span };

const KEY = "machines.stats";
const HEALTH_EVERY = 45000, LIMITS_EVERY = 10 * 60000, ROUND = 30000;

const SCRIPT = () => `${appHome()}/mods/tasks/bin/herdr_task/machine.py`;
const SETTINGS = () => dirs().settings;
const mkey = (m) => m ?? "";
let script = null;
let running = false;

export const allStats = () => { const v = shared(KEY); return v && typeof v === "object" ? v : {}; };
export const statsOf = (machine) => allStats()[mkey(machine)] ?? null;

// 在一台 machine 上运行 reader。无法执行时 reject。
async function read(machine, withLimits) {
  script ??= await readTextFile(SCRIPT());
  const args = withLimits ? ["--limits"] : [];
  const r = machine
    ? await exec("hc", ["exec", "--on", machine, "--", "python3", "-c", script, ...args])
    : await exec("python", [SCRIPT(), ...args]);
  const line = String(r.stdout ?? "").split("\n").find((l) => l.startsWith("{"));
  if (!line) throw new Error((r.stderr || "没有回答").trim().split("\n").pop().slice(0, 120));
  return JSON.parse(line);
}

// 对每台到期的 machine 跑一轮(或 `force` 全部),并行进行;只写一次。
// `only`:仅该机器(null:本机)。`limitsOlder`:读取更旧的 plan 限额
// 超过该毫秒数(打开详情视图:一分钟)。
export async function pollNow({ limits = false, force = false, only, limitsOlder } = {}) {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const old = allStats();
    let cfg = null;
    try { cfg = JSON.parse((await readTextFile(SETTINGS())) ?? "null"); } catch {}
    const list = [null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
    const next = { ...old };
    await Promise.all(list.filter((m) => only === undefined || m === only).map(async (m) => {
      const was = old[mkey(m)] ?? {};
      const wantLimits = limits || force || now - (was.limitsAt ?? 0) > (limitsOlder ?? LIMITS_EVERY);
      if (!force && !wantLimits && now - (was.at ?? 0) < HEALTH_EVERY) return;
      const out = { ...was, hold: holdOf(cfg, m) };
      try {
        const d = await read(m, wantLimits);
        out.health = d.health;
        out.at = Date.now();
        delete out.error;
        if (d.limits) {
          const lim = {};
          for (const [cli, fresh] of Object.entries(d.limits)) lim[cli] = nextRead(was.limits?.[cli], fresh);
          out.limits = lim;
          out.limitsAt = Date.now();
          // 用户可在该处启动的 agents,对没有用量来源的显示 "No usage info"。
          const known = await knownAgents({ on: m }).catch(() => null);
          // 连同各 agent 的启动方式(`run`),以及未安装的前两个("others"):web 端的 + 菜单与
          // Switch agent 提供与窗口相同的选项(knownAgents 是窗口自己的;service 无法询问 Herdr)。
          if (known) {
            out.agents = known.filter((a) => a.installed).map((a) => ({ key: a.key, name: a.name, run: a.run }));
            out.others = known.filter((a) => !a.installed).slice(0, 2).map((a) => ({ key: a.key, name: a.name }));
          }
        }
      } catch (e) {
        out.error = String(e?.message ?? e).slice(0, 120);
        out.at = Date.now(); // 已试过:等一轮再重试
      }
      next[mkey(m)] = out;
    }));
    // 不再认识的 machine 会被移除。
    const known = new Set(list.map(mkey));
    for (const k of Object.keys(next)) if (!known.has(k) && !machines().some((m) => m.name === k)) delete next[k];
    setShared(KEY, next);
  } finally {
    running = false;
  }
}

// 从单个副本的 init 起:每 30 秒一次轻量检查,每台 machine 只在到期时读取。
export function startPolling(cx) {
  cx.spawn(async () => pollNow());
  cx.timer.every(ROUND, (cx) => cx.spawn(async () => pollNow()));
}

// // ---- 数字代表什么 ------------------------------------------------------------------

// 档位、plan 行与文案:core/machines.js(已在上方导入)。

export const colorOf = (t, level) => (level === "over" ? t.blocked : level === "busy" ? t.working : t.dim);

// // ---- 绘制 ---------------------------------------------------------------------------------

// 细竖条,按各条目的占比填充:items = [{ pct, level }](pct:填充程度)。
export function bars(t, items, h = 12, id = "bars") {
  return h_flex().id(id).h(h).flex_none().items_end().gap(2)
    .children(items.map((m, i) => div().id(`${id}-${i}`).relative().w(3).h(h).rounded(2).bg(t.border).overflow_hidden()
      .child(div().absolute().left(0).bottom(0).w(3).h(Math.max(2, Math.round(h * Math.min(100, Math.max(0, m.pct)) / 100))).rounded(2)
        .bg(m.level === "ok" ? t.muted : colorOf(t, m.level)))));
}

// 横向 meter,带标签和数值:详情中的一行。
function meterRow(t, id, name, pct, fill, level, words, sub) {
  return v_flex().id(id).gap(4)
    .child(h_flex().gap(10).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_none().text_size(12.5).text_color(level === "ok" ? t.muted : colorOf(t, level)).child(words)))
    .child(div().relative().h(5).w_full().rounded(3).bg(t.border).overflow_hidden()
      .child(div().absolute().left(0).top(0).h(5).rounded(3).w(`${Math.max(2, Math.min(100, fill))}%`).bg(level === "ok" ? t.muted : colorOf(t, level))))
    .when(Boolean(sub), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(sub)));
}

function cliBlock(t, mid, r, now) {
  const head = (extra) => h_flex().gap(8).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground)
      .child(cliTitle(r)))
    .child(div().flex_none().text_size(11.5).text_color(extra?.old ? t.working : t.dim).child(extra?.text ?? ""));
  if (r.none) return v_flex().id(`${mid}-${r.cli}`).gap(4).child(head()).child(div().text_size(12).text_color(t.dim).child(NO_USAGE));
  const read = r.read;
  const old = readOld(read, now);
  const box = v_flex().id(`${mid}-${r.cli}`).gap(8).child(v_flex().gap(2).child(head({ text: `Read ${ago(read.at, now)}`, old }))
    .when(Boolean(read.account), (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).child(read.account))));
  if (read.state === "ok") {
    return box.children(read.windows.map((w, i) => {
      const x = windowWords(w, now);
      if (x.dead) return div().id(`${mid}-${r.cli}-${i}`).text_size(12).text_color(t.dim).child(x.dead);
      return meterRow(t, `${mid}-${r.cli}-${i}`, x.name, x.pct, x.pct, x.level, x.words, x.refill);
    })).when(Boolean(read.failed), (el) => el.child(div().text_size(11.5).text_color(t.working).child(failedWords(read))));
  }
  return box.child(div().text_size(12).text_color(t.muted).child(whyWords(read)));
}

// 一台机器的完整区块:先是健康计量条,然后是各 agent CLI 的 plan。
export function machineDetails(t, machine, opts = {}) {
  const s = statsOf(machine), now = Date.now();
  const mid = `md-${mkey(machine) || "local"}`;
  const out = v_flex().id(mid).gap(12);
  if (!s) return out.child(div().text_size(12.5).text_color(t.dim).child(READING_MACHINE));
  const hm = healthMeters(s);
  const healthBox = v_flex().gap(10)
    // 标题用句首大写(ui.js 的 heading),绝不全大写。
    .when(opts.titles !== false, (el) => el.child(heading("Health",
      div().font_normal().text_color(s.error ? t.working : t.dim).child(healthReadWords(s, now)))))
    .children(hm.map((m) => meterRow(t, `${mid}-h-${m.name}`, m.name, m.pct, m.pct, m.level, `${m.pct}%`, meterSub(m))));
  if (!hm.length) healthBox.child(div().text_size(12).text_color(t.dim).child(noHealthWords(s)));
  const rows = planRows(s, now);
  const planBox = v_flex().gap(14)
    .when(opts.titles !== false, (el) => el.child(heading("Plan usage")))
    .children(rows.map((r) => cliBlock(t, mid, r, now)))
    .when(!rows.length, (el) => el.child(div().text_size(12).text_color(t.dim).child(noPlanWords(s))));
  return out.when(opts.health !== false, (el) => el.child(healthBox))
    .when(opts.health !== false && opts.plan !== false, (el) => el.child(div().h(1).bg(t.border)))
    .when(opts.plan !== false, (el) => el.child(planBox));
}
