// task 的 artifacts:其 agent(及其 helper)创建或更新的全部 artifact,供…的 Artifacts tab 使用
// 其视图,web 应用(service/compat.ts)与窗口(mods/task-artifacts、mods/chat/panel.js)皆同。
// 从 herdr-artifact 自身的记录中找到:artifact 会注明其 task(herdr-artifact publish 保留,来自
// 发布终端的 herdr.task 标签),否则其某一版本由该任务自己的某个 agent 发布
// 该 agent 运行期间的 terminal;两者皆无的旧记录按 id 在任务聊天日志中查找("Published <id>
// v<n>”,publish 的输出)。其证明(herdr-task ready --proof)始终有效且排最前;其余按最新在前。

const ID = "[a-z0-9][a-z0-9-]*-[0-9a-f]{4}";
// publish 的输出("Published <id> v2: ...")及其 --json 应答("mod": "art-<id>"),聊天日志按此保留
// (在 JSON 字符串内:引号已转义)。GREP 与 grep -E 的解读一致(窗口在日志所在处直接 grep)。
export const GREP = `Published ${ID} v[0-9]+|mod[\\\\"]*: ?[\\\\"]*art-${ID}`;
const SAID = new RegExp(`Published (${ID}) v\\d+|mod[\\\\"]*: ?[\\\\"]*art-(${ID})`, "g");

/* chat 日志文本中记录为已发布的 artifact id,按出现顺序,各一次。 */
export function publishedIds(text) {
 const out = new Set;
 for (const m of String(text ?? "").matchAll(SAID)) out.add(m[1] ?? m[2]);
 return [...out];
}

// 任务运行期间其某个 agent 发布的版本(前后各留一分钟的余量:时钟与结束
// 被记录晚了一拍);地址日后被另一程序复用时绝不计入
const byAgent = (agents, v) => agents.some((g) => g?.address && v?.publisher === g.address
 && (v.at ?? 0) >= (g.at ?? 0) - 60000 && (!g.ended || (v.at ?? 0) <= g.ended + 60000));

/*
 * 任务各 artifact 的 id,其 proof 在前,其余按最新在前。
 * arts:herdr-artifact 的记录({ id, task, folder, at, machine?, versions: [{ publisher, at }] })。
 * task:{ ref(其 id), folder(其列表的), machine(null 表示本机), agents: [{ address, at, ended }], proof(其 id) }。
 * logIds:其 chat 日志记录为已发布的 id(publishedIds)。
 */
export function taskArtifacts(arts, task, logIds = []) {
 const ref = String(task?.ref ?? "").toUpperCase, machine = task?.machine ?? null, proof = task?.proof ?? null;
 const agents = Array.isArray(task?.agents) ? task.agents : [], said = new Set(logIds);
 const mine = (Array.isArray(arts) ? arts : []).filter((a) => {
 if (!a?.id || (a.machine ?? null) !== machine) return false;
 if (a.id === proof) return true;
 // 留给另一文件夹:另一列表中同号任务
 if (task?.folder && a.folder && a.folder !== task.folder) return false;
 // 它指明了所属任务:只匹配那一个
 if (a.task) return String(a.task).toUpperCase === ref;
 return (a.versions ?? []).some((v) => byAgent(agents, v)) || said.has(a.id);
 });
 return mine.sort((x, y) => Number(y.id === proof) - Number(x.id === proof) || (y.at ?? 0) - (x.at ?? 0)).map((a) => a.id);
}

/*
 * 标题按任务 tab 的写法:去掉任务 id 前缀(" Coverage" -> "Coverage"),proof 的还要去掉
 * 结尾的 " · Proof"(其 Proof 标记已说明)。
 */
export function titleInTask(title, ref, proof = false) {
 let t = String(title ?? "");
 const r = String(ref ?? "");
 // SHOP-4 绝不截断 SHOP-40 的
 if (r && t.slice(0, r.length).toUpperCase === r.toUpperCase && !/\d/.test(t[r.length] ?? "")) t = t.slice(r.length).replace(/^[:\s·-]+/, "") || t;
 if (proof) t = t.replace(/\s*·\s*proof\s*$/i, "") || t;
 return t;
}
