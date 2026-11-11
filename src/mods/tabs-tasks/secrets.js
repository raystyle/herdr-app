// 供 agent 使用的 secrets(bin/herdr-secret):存放它们的机器上的 vault(Settings ›
// Secrets › Kept on,`herdr-secret where`),那边 ~/.local/share/herdr-winapp/secrets/vault.json(仅所有者可读写),按名称取值
// 作用于 Everywhere、机器或 space,最具体的优先。在另一台机器上每次读取
// 写入也经 herdr-secret 到达那边(names、set、rm:通过 hc 转发)。
// 用户的掩码输入框(chat 里 agent 的请求卡片、Settings > Secrets)把值写到这里
// 直达:值绝不经过 hc send、chat、log 或 artifact。mods 展示的
// 它展示的只有名称和作用域,绝无值本身。
// agent 在自己的终端上以 label 请求:herdr.secret.ask.<NAME>=<why>(herdr-secret
// ask);应答后移除,且仅按名称告知 agent。
// 共享文件:源文件是 lib/secrets.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的每个 mod 里。
// 编辑 lib/secrets.js(不要编辑 mod 里的副本),然后运行 bin/sync-shared。

import { appHome, home, exec, hc, readTextFile, writeTextFile } from "herdr";
import { terminals, spaces, panes } from "./live.js";
import { chatPane } from "./core/spaces.js";
import { serviceRuns } from "./service.js";

// 请求的 label 和 agent 听到的措辞:core/secrets.js,与 web app 共享。
import { NAME, ASK, asksIn, keptLine, declinedLine } from "./core/secrets.js";
import { sendAsPerson } from "./core/person.js";
import { dirs, dirsReady } from "./dirs.js";
export { NAME };
const WANT = "herdr.secret.want";
const SPACE_LABELS = ["herdr.space", "herdr.task.space", "herdr.coordinator.space"];
const bin = () => `${appHome()}/bin/herdr-secret.cmd`;
const vault = () => dirs().vault;

// // ---- 作用域 ---------------------------------------------------------------------------------
// 作用域:{ scope: "everywhere" | "machine" | "space", machine, space }(machine 为 null 表示本机;
// Herdr 命名的 space id,其他机器的带其名称前缀)。

export const scopeKey = (s) => `${s.scope}:${s.machine ?? ""}:${s.space ?? ""}`;
const same = (e, s) => e.scope === s.scope && (e.machine ?? null) === (s.machine ?? null) && (e.space ?? null) === (s.space ?? null);
const qualify = (machine, id) => (machine && id && !id.includes("/") ? `${machine}/${id}` : id);

// 终端的工作位置:其 machine 和 space(子 agent 没有则用父级的)。
export function placeOf(address) {
  const machine = String(address ?? "").includes("/") ? address.split("/")[0] : null;
  let t = terminals().find((x) => x.address === address);
  for (let i = 0; i < 5 && t; i++) {
    const l = t.labels ?? {};
    // 驻留在 chat 之后的 agent 只有 herdr.chat=<chat pane>:即该 chat 的 space。
    const chat = l["herdr.chat"] && panes().find((p) => p.pane === chatPane(t));
    const sp = SPACE_LABELS.map((k) => l[k]).find(Boolean) ?? (chat && spaces().find((s) => s.tabs?.some((x) => x.id === chat.tab))?.id);
    if (sp) return { machine, space: qualify(machine, sp) };
    if (!t.parent) break;
    const p = qualify(machine, t.parent);
    t = terminals().find((x) => x.address === p);
  }
  return { machine, space: null };
}

const spaceName = (id) => spaces().find((s) => s.id === id)?.name || "This space";
export const machineName = (m) => m || "本机";

// 终端 agent 可触达的作用域,从最具体到最宽泛,各自附带描述文字。
export function levels(address) {
  const { machine, space } = placeOf(address);
  const out = [];
  if (space) out.push({ scope: "space", machine: null, space, label: spaceName(space) });
  out.push({ scope: "machine", machine, space: null, label: machineName(machine) });
  out.push({ scope: "everywhere", machine: null, space: null, label: "Everywhere" });
  return out;
}

// 作用域的文字形式,用于列表:"Everywhere"、"laptop"、"Space ~"。
export function where(s) {
  if (s.scope === "space") return `Space ${spaces().find((x) => x.id === s.space)?.name || s.space}`;
  if (s.scope === "machine") return machineName(s.machine);
  return "Everywhere";
}

// // ---- 询问 -----------------------------------------------------------------------------------

// 终端请求的内容:[{ name, why }]。ts:terminals(),供调用方已有终端列表时传入。
export function asksOf(address, ts = terminals()) {
  return asksIn(ts.find((x) => x.address === address)?.labels);
}

// 所有等待中的请求:[{ address, name, why }]。
export function allAsks() {
  return terminals().filter((t) => t.state === "live" || t.state == null)
    .flatMap((t) => asksOf(t.address).map((a) => ({ address: t.address, ...a })));
}

async function answer(address, name, text) {
  await hc(["label", address, `${ASK}${name}=`]).catch(() => {});
  // 用户的应答:来自本人的普通输入,在其他机器上绝不算 "Another agent"(core/person.js)
  await sendAsPerson({ hc, exec }, address, text).catch(() => {});
}

export async function decline(address, name) {
  await answer(address, name, declinedLine(name));
}

// // ---- 哪台机器保管它们 ----------------------------------------------------------------
// `herdr-secret where --json`:{ here, set, id, name }(name:主机的 here;为 "" 表示
// 未建立链接)。最多每 15 秒重新询问;首次得知前为 null。
let main = null, mainAt = 0, asking = false;
export function keptOn() {
  if (!asking && Date.now() - mainAt > 15000) {
    asking = true;
    exec(bin(), ["where", "--json"]).then((r) => { if (r.code === 0) main = JSON.parse(r.stdout); })
      .catch(() => {}).finally(() => { asking = false; mainAt = Date.now(); });
  }
  return main;
}
export async function whereNow() {
  const r = await exec(bin(), ["where", "--json"]).catch(() => null);
  if (r?.code === 0) try { main = JSON.parse(r.stdout); mainAt = Date.now(); } catch {}
  return main ?? { here: true, set: false, id: null, name: null };
}
const fail = (r, fallback) => new Error(String(r?.stderr ?? "").trim().split("\n").pop()?.replace(/^herdr-secret: /, "") || fallback);
// 作用域,形如 herdr-secret 的 flags(在本机语境下:herdr-secret 会在那边重命名)。
const flags = (s) => (s.scope === "space" ? ["--space", s.space] : s.scope === "machine" ? (s.machine ? ["--machine", s.machine] : ["--machine"]) : []);

// // ---- 密钥库 ------------------------------------------------------------------------------

async function read() {
  const text = await readTextFile(vault()).catch(() => null);
  if (text == null) return { text: null, data: { version: 1, secrets: [] } };
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!data || !Array.isArray(data.secrets)) throw new Error(`The vault (${vault()}) isn't readable; fix or move it first.`);
  return { text, data };
}

// 修改 vault:fn(data) 原地编辑。文件先设为仅所有者可读(herdr-secret
// init),且仅在此期间无人改动时才替换(否则再读一次)。
async function change(fn) {
  const r = await exec(bin(), ["init"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't open the vault.");
  for (let i = 0; i < 3; i++) {
    const { text, data } = await read();
    fn(data);
    try { await writeTextFile(vault(), JSON.stringify(data, null, 1), text); return; } catch (e) { if (i === 2) throw e; }
  }
}

// 所有条目(不含值):[{ name, scope, machine, space, at }]。当机器
// 保管它们的机器当前无法应答。
export async function entries() {
  if (!(await whereNow()).here) {
    const r = await exec(bin(), ["names", "--json"]);
    if (r.code !== 0) throw fail(r, "Can't reach the machine that keeps your secrets.");
    return JSON.parse(r.stdout).filter((e) => NAME.test(String(e?.name ?? ""))).map((e) => ({ name: e.name, scope: e.scope, machine: e.machine ?? null, space: e.space ?? null, at: e.at ?? null }));
  }
  const { data } = await read();
  return data.secrets.filter((e) => NAME.test(String(e?.name ?? ""))).map((e) => ({ name: e.name, scope: e.scope, machine: e.machine ?? null, space: e.space ?? null, at: e.at ?? null }));
}

// 先保存一个值,然后应答当前能触达的所有等待中的请求(多个 agent 可能同时请求)。
export async function keep(name, scope, value) {
  if (!NAME.test(name)) throw new Error("Name it like an environment variable: GITHUB_TOKEN.");
  const v = String(value ?? "").replace(/[\r\n]+$/, "");
  if (!v) throw new Error("请先输入或粘贴值。");
  const s = { scope: scope.scope, machine: scope.machine ?? null, space: scope.space ?? null };
  if ((await whereNow()).here) {
    await change((data) => {
      data.secrets = data.secrets.filter((e) => !(e.name === name && same(e, s)));
      data.secrets.push({ name, ...s, value: v, at: Date.now() });
    });
  } else {
    // 传给保管它们的机器:mod 的 exec 没有 stdin,因此值先存放在仅所有者可读的文件里,位于
    // secret 投放文件夹(0700),herdr-secret 读后立即删除,再经 hc 链接转发
    const drop = (await dirsReady())["secret-drop"];
    await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "x", drop]);
    const file = `${drop}/set-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await writeTextFile(file, v, null);
    const r = await exec(bin(), ["set", name, ...flags(s), "--value-file", file]);
    await exec("rm", ["-f", file]).catch(() => {});
    if (r.code !== 0) throw fail(r, "It wasn't kept.");
  }
  const at = where(s);
  for (const a of allAsks().filter((a) => a.name === name && levels(a.address).some((l) => scopeKey(l) === scopeKey(s)))) {
    await answer(a.address, name, keptLine(name, at));
  }
}

export async function remove(name, scope) {
  if (!(await whereNow()).here) {
    const r = await exec(bin(), ["rm", name, ...flags(scope)]);
    if (r.code !== 0) throw fail(r, "It wasn't removed.");
    return;
  }
  await change((data) => { data.secrets = data.secrets.filter((e) => !(e.name === name && same(e, scope))); });
}

// // ---- 其他机器的 agent ---------------------------------------------------------------
// 远程的 herdr-secret run/env/list 把 herdr.secret.want 打到自己的终端上,并在 FIFO 上等待;
// herdr-secret serve 从这里通过 hc 应答。由 render 调用:每个请求只处理一次。
// ts:terminals(),供调用方已有终端列表时传入。
const served = new Set();
export function serveRemote(ts = terminals()) {
  // herdr-winapp 的 service 在运行期间应答(lib/service.js);只有保管
  // 由保管 secrets 的一方应答。
  if (serviceRuns() || !keptOn()?.here) return;
  for (const t of ts) {
    const w = t.labels?.[WANT];
    if (!w || !String(t.address).includes("/") || served.has(w)) continue;
    served.add(w);
    exec(bin(), ["serve", t.address]).catch(() => {});
  }
  if (served.size > 200) served.clear();
}
