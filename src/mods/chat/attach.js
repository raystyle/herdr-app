// 消息框的文件:粘贴的(剪贴板图片或复制的文件)或拖入的。它们
// 按其 CLI 能识别的方式发给 agent:作为消息中的文件路径(Claude Code 会把
// 将图片路径转为图片)。另一台 machine 上的 agent 会先在那边拿到副本(`hc put`)。
// 粘贴的图片保存在 data/chat-attach,直到用户发送或移除。

import { exec, hc, appHome, window } from "herdr";
import * as fs from "fs/promises";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;
const base = (p) => String(p).split("/").filter(Boolean).pop() ?? p;
export const isImage = (p) => IMAGE.test(p);

// macOS 剪贴板(JXA,osascript):复制的文件各占一行 "file\t<path>";否则为其图片(截图
// PNG 或 TIFF)以 PNG 写入 argv[0],即 "image";否则无输出。
export const MAC_CLIPBOARD = `ObjC.import("AppKit");
function run(argv) {
  const pb = $.NSPasteboard.generalPasteboard;
  const urls = pb.readObjectsForClassesOptions($([$.NSURL]), $({ NSPasteboardURLReadingFileURLsOnlyKey: true }));
  if (urls && !urls.isNil() && urls.count > 0) {
    const out = [];
    for (let i = 0; i < urls.count; i++) out.push("file\\t" + urls.objectAtIndex(i).path.js);
    return out.join("\\n");
  }
  let png = pb.dataForType($.NSPasteboardTypePNG);
  if (!png || png.isNil()) {
    const tiff = pb.dataForType($.NSPasteboardTypeTIFF);
    if (tiff && !tiff.isNil()) png = $.NSBitmapImageRep.imageRepWithData(tiff).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  }
  if (png && !png.isNil() && png.writeToFileAtomically(argv[0], true)) return "image";
  return "";
}`;

const pastedName = (ext) => `pasted-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "")}.${ext}`;

// 此处剪贴板中的文件或图片:Wayland(wl-paste)或 macOS(osascript)。[{ path, name, image, temp }],
// 两者皆无时为 [];完全无法读取(无 wl-paste)时抛错,以便聊天如实提示。
export async function fromClipboard(os = window()?.platform) {
  const dir = `${appHome()}/data/chat-attach`;
  if (os === "macos") {
    const name = pastedName("png");
    const r = await exec("sh", ["-c", 'mkdir -p "$1" && exec osascript -l JavaScript -e "$2" "$1/$3"', "x", dir, MAC_CLIPBOARD, name]);
    if (r.code !== 0) throw new Error("Couldn't read the clipboard.");
    const out = r.stdout.trim();
    if (out === "image") return [{ path: `${dir}/${name}`, name, image: true, temp: true }];
    return paths(out.split("\n").filter((l) => l.startsWith("file\t")).map((l) => l.slice(5)));
  }
  const listed = await exec("sh", ["-c", "command -v wl-paste >/dev/null || exit 127; wl-paste --list-types 2>/dev/null; true"]);
  if (listed.code === 127) throw new Error("Couldn't read the clipboard: pasting files here needs wl-paste (wl-clipboard).");
  const types = listed.stdout.split("\n");
  if (types.includes("text/uri-list")) {
    const r = await exec("sh", ["-c", "wl-paste -n -t text/uri-list 2>/dev/null"]);
    return paths(r.stdout.split(/\r?\n/).filter((l) => l.startsWith("file://")).map((l) => decodeURIComponent(l.slice(7))));
  }
  const type = types.find((t) => /^image\/(png|jpeg|gif|webp|bmp)$/.test(t));
  if (!type) return [];
  const name = pastedName(type.split("/")[1].replace("jpeg", "jpg"));
  const r = await exec("sh", ["-c", 'mkdir -p "$1" && wl-paste -n -t "$2" > "$1/$3" && [ -s "$1/$3" ] && echo ok', "x", dir, type, name]);
  return r.stdout.trim() === "ok" ? [{ path: `${dir}/${name}`, name, image: true, temp: true }] : [];
}

// macOS 自带文件选择器,可多选(AppleScript 的 choose file,置于前台窗口之上):每个选中的
// 路径独占一行;取消时无输出。
export const MAC_PICK = [
  "运行参数上",
  "  try",
  "    tell application (path to frontmost application as text) to set fs to choose file with prompt (item 1 of argv) with multiple selections allowed",
  "  on error number -128",
  "    return \"\"",
  "  end try",
  "  set out to {}",
  "  repeat with f in fs",
  "    set end of out to POSIX path of f",
  "  end repeat",
  "  set AppleScript's text item delimiters to linefeed",
  "  return out as text",
  "结束运行",
];

// attach 按钮使用的系统自带文件选择器:Linux 上为 xdg-desktop-portal(pick-files.py),macOS 用自带 picker。
// resolve 出 { code, paths }。
export async function pick(title = "附加文件", os = window()?.platform) {
  const r = os === "macos"
    ? await exec("osascript", [...MAC_PICK.flatMap((l) => ["-e", l]), title]).catch(() => null)
    : await exec("sh", ["-c", 'P=/usr/bin/python3; [ -x "$P" ] || P=python3; exec "$P" -I "$1" "$2"', "x", `${appHome()}/mods/chat/pick-files.py`, title]).catch(() => null);
  return { code: r ? r.code : 1, paths: (r?.stdout ?? "").split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean) };
}

// 拖入或粘贴的文件路径作为附件。
export const paths = (list) => list.filter(Boolean).map((p) => ({ path: p, name: base(p), image: isImage(p), temp: false }));

// 消息的文件行:每条为 agent 所在机器上的文件路径。对另一台机器,会有一份副本
// 落在 agent 的 terminal 旁边。
export async function deliver(files, addr, machine) {
  const out = [];
  for (const f of files) {
    if (!machine) { out.push(f.path); continue; }
    const r = await hc(["put", addr, f.path, "--json"]);
    let landed = null;
    try { landed = JSON.parse(r.stdout || "{}").path ?? null; } catch { landed = r.stdout.trim() || null; }
    if (r.code !== 0 || !landed) throw new Error(`${f.name} didn't reach ${machine}: ${(r.stderr || r.stdout).trim()}`);
    out.push(landed);
  }
  return out;
}

// 发送前被移除的粘贴图片即被清掉。已发送的保留一天(agent 可能还要读取
// 稍后),然后执行。
export function drop(f) {
  if (f.temp && f.path.startsWith(`${appHome()}/data/chat-attach/`)) exec("rm", ["-f", f.path]);
}
export function prune() {
  exec("sh", ["-c", 'find "$1" -name "pasted-*" -mmin +1440 -delete 2>/dev/null; true', "x", `${appHome()}/data/chat-attach`]);
}

// 聊天中显示的图片(缩略图、查看器):`image()` 从应用文件夹加载,因此
// 每个都被链接(或复制)到 data/chat-attach/view,并带像素尺寸以便适配。
// 对存在于本机且为图片的文件,resolve 出 { <path>: { rel, w, h } }。
const VIEW = `
d="$1"; shift; mkdir -p "$d"
for p in "$@"; do
  [ -f "$p" ] || continue
  s=$(magick identify -format '%w %h' "$p[0]" 2>/dev/null) || s=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=' ' "$p" 2>/dev/null)
  [ -n "$s" ] || continue
  n=$(printf '%s' "$p" | cksum | cut -d' ' -f1)-$(printf '%s' "\${p##*/}" | tr -c 'A-Za-z0-9._-' '_')
  [ -f "$d/$n" ] || ln -f "$p" "$d/$n" 2>/dev/null || cp "$p" "$d/$n" 2>/dev/null || continue
  printf '%s\\t%s\\t%s\\n' "$p" "$n" "$s"
done
true`;
export async function viewable(list) {
  const dir = `${appHome()}/data/chat-attach/view`;
  const r = await exec("sh", ["-c", VIEW, "view", dir, ...list]).catch(() => null);
  const out = {};
  for (const line of (r?.stdout ?? "").split("\n")) {
    const [p, n, size] = line.split("\t");
    const [w, h] = (size ?? "").split(" ").map(Number);
    if (p && n && w && h) out[p] = { rel: `data/chat-attach/view/${n}`, w, h };
  }
  return out;
}

// w×h 的图像覆盖 size×size 的正方形:其绘制尺寸与偏移(显示中间部分)。
export function cover(w, h, size) {
  const k = size / Math.min(w, h);
  const dw = Math.round(w * k), dh = Math.round(h * k);
  return { w: dw, h: dh, left: Math.round((size - dw) / 2), top: Math.round((size - dh) / 2) };
}

// 大段粘贴保存为文本文件(与其他文件一样按路径发送):data/chat-attach,命名为
// 在其首行之后。
export async function textFile(text) {
  const first = String(text).split("\n").find((l) => l.trim())?.trim() ?? "粘贴的文本";
  const slug = first.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "pasted-text";
  const name = `pasted-${Date.now().toString(36)}-${slug}.txt`;
  const path = `${appHome()}/data/chat-attach/${name}`;
  try {
    await exec("mkdir", ["-p", `${appHome()}/data/chat-attach`]);
    await fs.writeFile(path, text);
  } catch { return null; }
  return { path, name: first.length > 40 ? first.slice(0, 39) + "…" : first, image: false, text: true, temp: true };
}
