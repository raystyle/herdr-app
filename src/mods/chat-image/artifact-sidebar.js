// artifact 查看器的 “Open in the sidebar”,以及没有 chat pane 显示时的 Ctrl+K artifact
// (mods/jump):与 mods/artifacts/sidebar.js 相同的步骤(mod 之间不能互相导入文件;
// 保持两者同步)。共享文件:源文件是 lib/artifact-sidebar.js;编辑它,不要编辑 mod 的
// 副本,然后运行 bin/sync-shared。layout 的 "artifacts" stack
// 显示 "artifacts-view",其 body block("artifacts-view-body")获得 artifact 的 mod;
// shared "artifacts.view" 记录其标题所指的 artifact。

import { layout, run, shared, setShared, appHome, readTextFile, writeTextFile } from "herdr";
import { toast, plainError } from "./ui.js";

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

export const hasSidebarView = () => Boolean(find(layout(), "artifacts-view-body"));

// body block 得到 artifact 的 mod:对 layout 文件中那一个 block 的修改(不是
// layout.set:mod 的 run() 拒绝嵌套超过 16 层的参数,而这个 block 正是如此,且
// layout.set 会把用户点选的尺寸写进文件)。仅当文件未变时
// 自上次读取以来的变化;否则重新读取。
async function setBody(mod) {
  const path = `${appHome()}/layouts/${shared("layout")}.json`;
  for (let i = 0; ; i++) {
    const text = await readTextFile(path);
    const tree = JSON.parse(text ?? "null"), body = find(tree, "artifacts-view-body");
    if (!body) throw new Error("此布局没有工件视图。");
    body.content = { mod };
    try { await writeTextFile(path, JSON.stringify(tree, null, 2), text); return; }
    catch (e) { if (i >= 2) throw e; }
  }
}

export function showInSidebar(view) {
  const l = layout(), body = find(l, "artifacts-view-body");
  if (!body) return false;
  // base:最新版本的 mod(art-<id>);mod 可能是较旧的版本(art-<id>--v<n>)。
  setShared("artifacts.view", { mod: view.mod, base: view.base ?? view.mod, id: view.id, title: view.title, version: view.version, latest: view.latest ?? view.version, machine: view.machine ?? null, at: Date.now() });
  const show = () => {
    run("layout.select", { stack: "panel-body", child: "artifacts" });
    run("layout.select", { stack: "artifacts", child: "artifacts-view" });
    run("layout.show", { id: "panel" });
  };
  if (body.content?.mod === view.mod && !body.content?.props) { show(); return Promise.resolve(true); }
  return setBody(view.mod)
    .then(() => { show(); return true; })
    .catch((e) => { toast({ title: "工件没有打开", body: plainError(e), level: "error" }); return false; });
}
