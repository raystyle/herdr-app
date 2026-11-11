// 用户从窗口输入到终端的文字,如同 hc send 粘贴,但没有 caller。hc send
// 标明其 caller(HC_TERMINAL_ID,否则为其父进程:窗口),另一台机器的 core 会把消息包装成
// 来自 <hc from="<machine>/ppid:…"> 中的:agent 和两个 chat 都把用户的话当成了其他 agent 所发。
// herdr-core 的 terminal.send 无 caller 时,在本机及任何机器上都以用户普通输入落地;
// service 通过自己的链接做同样的事(service/hub.ts send())。从窗口出发则经过 `hc connect`
// (一行 JSON-RPC 进,其应答出),文档规定的方式,其中不指名任何人。
// 共享 core:源文件是 core/person.js;bin/sync-shared 会把它复制到 lib/COPIES 列出的 mods 里。

// 唯一的请求行:对 addr 执行 terminal.send 发送 text,无 caller。
export const personRequest = (addr, text) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "terminal.send", params: { terminal: addr, text } });

// hc connect 的应答,采用 hc send 自己的结果格式:code 0 附结果,否则为其错误
// ({ error: { kind, message } })输出到 stderr,供 core/send.js 的 refusal() 使用;毫无应答时为 null。
export function personResult(r) {
  const line = String(r?.stdout ?? "").split("\n").map((l) => l.trim()).find((l) => l.startsWith("{"));
  let m = null;
  try { m = line ? JSON.parse(line) : null; } catch {}
  if (!m || m.id !== 1 || !("result" in m || "error" in m)) return null;
  if (m.error) return { code: 1, stdout: "", stderr: JSON.stringify({ error: { kind: m.error.data?.kind ?? null, message: m.error.message ?? "没有成功。" } }) };
  return { code: 0, stdout: JSON.stringify(m.result ?? {}), stderr: "" };
}

// 以用户身份向 addr 发送文本。exec:herdr 的 exec(command, args)。当 hc connect 无应答时(无 sh,hc
// 没有它时),改用 hc send:文字照发,署名照旧。
export async function sendAsPerson({ hc, exec }, addr, text) {
  const r = await exec("sh", ["-c", 'printf "%s\\n" "$1" | hc connect', "hc-send", personRequest(addr, text)]).catch(() => null);
  return personResult(r) ?? hc(["send", addr, text]);
}

// 用于发送用户文字的 hc:其普通 send(`hc send <t> <text>`)以用户身份发出,其余原样执行。
export const asPerson = (io) => (args) => args[0] === "send" && args.length === 3 ? sendAsPerson(io, args[1], args[2]) : io.hc(args);
