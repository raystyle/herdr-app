// agent 按名称请求的 secret(herdr-secret ask):其终端上的 label,以及用户
// 用户保留或拒绝时(绝不涉及值)。窗口的掩码卡片(lib/secrets.js)和 web app 的都说
// 一致。共享 core:源文件是 core/secrets.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的 mods 里。

import { PY } from "./paths.js";
export const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
export const ASK = "herdr.secret.ask.";

// 终端的 label 请求的内容:[{ name, why }]。
export function asksIn(labels) {
  const l = labels ?? {};
  return Object.keys(l).filter((k) => k.startsWith(ASK) && NAME.test(k.slice(ASK.length)) && l[k])
    .sort().map((k) => ({ name: k.slice(ASK.length), why: l[k] === "-" ? "" : String(l[k]) }));
}

// agent 只会得知该 secret 已保存,且仅按名称:绝不涉及值本身。
export const keptLine = (name, at) => `<hc from="person" secret="${name}">Kept: ${name} (for ${at}). Use it by name: herdr-secret run ${name} -- <command>, or herdr-secret env ${name} --file .env in a git-ignored file. Never print it or put it in a chat, brief, artifact or commit.</hc>`;

export const declinedLine = (name) => `<hc from="person" secret="${name}">Declined: ${name}. The person won't give it now: go on without it, or say plainly what you can't do without it. Don't ask for its value in the chat.</hc>`;

// 哪台机器保管 secrets(Settings › Secrets › Kept on):herdr-core document "herdr-winapp.secrets" = { id, at, by,
// auto? },每台机器都有(id:该机器的 herdr-core id),正如 "herdr-winapp.host" 之于 Serve from(core/host.js):
// 最新记录胜出,各 service 把它转发给与其相连的机器,机器相信自己的记录或
// 来自当前保管 secrets 的机器的新记录(自己还没有:拿到的是最新转交的那份)。
// 默认跟随 Serve from(auto: true,设置里为 "Same as Serve from"):无人指定机器,因此
// service 会提名当前所在的机器(autoKeeper),而提供 web app 服务的机器把密钥移到自己身上,这是安全的
// 方式(followTo:`herdr-winapp secrets move-to`,带备份与回滚);之后更改 Serve from 会把密钥一并带走
// 同样方式处理。用户在 Kept on 中另选机器会覆盖它(写入不带 auto 的记录);选 Serve
// from machine 重新跟随。尚无任何记录:没有 ~/.local/share/herdr-winapp/secrets/remote 的机器自行保管
// (bin/herdr-secret remote())。 `herdr-winapp secrets move-to <machine>` 移动它们(service/secrets-move.ts)。
export const SECRETS_DOC = "herdr-winapp.secrets";

/* 一个可采信的记录:{ id, at, by?, auto? },时间合理,否则 null。 */
export function secretsRecord(v, now = Date.now()) {
  return v && typeof v.id === "string" && v.id && Number.isFinite(v.at) && v.at <= now + 60_000
    ? { id: v.id, at: v.at, ...(typeof v.by === "string" ? { by: v.by } : {}), ...(v.auto === true ? { auto: true } : {}) } : null;
}

/* 机器保留哪份记录:自己的,或其记录所指机器的更新版本(那台机器会转交迁移);自己没有:它读取的机器中最新的那份。`there`:{ [机器 id]: record }。 */
export function believeRecord(mine, there) {
  const own = secretsRecord(mine);
  if (!own) {
    let best = null;
    for (const v of Object.values(there ?? {})) { const r = secretsRecord(v); if (r && (!best || r.at > best.at)) best = r; }
    return best;
  }
  const fromMain = secretsRecord(there?.[own.id]);
  return fromMain && fromMain.at > own.at ? fromMain : own;
}

/*
 * 当前由哪台机器保管 secrets,当没人指定时(每台看到相同事实的机器给出相同答案):取它们已在的位置,这样运行中的 agent 之下不会有任何东西移动(followTo 随后把它们移到 Serve 来源):
 * 1. vault(~/.local/share/herdr-winapp/secrets/vault.json)里有 secrets 且未标为 remote 的机器;
 * 2. 有多台:secrets 最多且不在服务 web app 的那台(移过去能保住另一台的条目:`move-to` 会合并),否则 id 最小的;
 * 3. 都没有:正在服务 web app 的机器;
 * 4. 都没有、无人服务 web app,且每台机器都标为 remote(各自装了对方的副本):取 id 最小的,否则永远没有机器能保管 secret(#800)。有未标记的:各自保管自己的,和以前一样。
 * machines: [{ id, count, remote }](count:其 vault 中的 secrets 数,无 vault 为 0;null:未知,现在问不了)。
 * host:服务 web app 的机器 id(herdr-winapp.host),或 null。
 * 返回 { id } 或 null:尚无需决定(未见 vault 且仍有机器未知,或没有 host 可退)。
 */
export function autoKeeper(machines, host) {
  const ms = (machines ?? []).filter((m) => m && typeof m.id === "string" && m.id);
  const holders = ms.filter((m) => Number.isFinite(m.count) && m.count > 0 && !m.remote);
  if (holders.length) {
    const pick = [...holders].sort((a, b) => (a.id === host) - (b.id === host) || b.count - a.count || (a.id < b.id ? -1 : 1))[0];
    return { id: pick.id };
  }
  // 任何地方都没见到 vault:仅当每台机器都应答后(休眠的笔记本可能保管着它们)
  if (ms.some((m) => m.count == null)) return null;
  if (host) return { id: host };
  return ms.length && ms.every((m) => m.remote) ? { id: [...ms].map((m) => m.id).sort()[0] } : null;
}

/* 跟随 Serve 来源但存放在别处的 secrets:要把它们移去的服务 web app 的机器 id,由那台机器执行(me:其自身 id),否则 null。 */
export function followTo(record, host, me) {
  const r = secretsRecord(record);
  return r?.auto && host && me === host && r.id !== host ? host : null;
}

// 在某机器上用 python3 运行:其 vault 里有多少条 secret(绝不返回值),以及是否标记为远程。
export const COUNT_SCRIPT = `
import json, os
${PY}
n = 0
try:
    with open(SHEP(".herdr/vault.json")) as f:
        n = len(json.load(f).get("secrets") or [])
except Exception:
    n = 0
print(json.dumps({"count": n, "remote": os.path.exists(SHEP(".herdr/secret-remote"))}))
`;

/* 描述 secrets 存放处的文字:“本机”、机器名,或未连接时的其 id。 */
export const keptWhere = (m) => (!m ? "" : m.here ? "本机" : m.name || "另一台机器(未从此处连接)");
