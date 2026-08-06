// ═══════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════

import { readFileSync, statSync } from "fs";
import { extname } from "path";
import { MIME_MAP, MIME_LIST, MAX_SIZE_MB } from "./config.mjs";

export const isURL = (s) => /^https?:\/\//i.test(s);

export function validateImage(filePath) {
  let stat;
  try { stat = statSync(filePath); } catch {
    return { ok: false, msg: `文件不存在或无法访问: ${filePath}` };
  }
  const ext = extname(filePath).toLowerCase();
  if (!MIME_MAP[ext]) {
    return { ok: false, msg: `不支持的格式: ${ext}，仅支持 ${MIME_LIST}` };
  }
  const sizeMB = stat.size / (1024 * 1024);
  if (sizeMB > MAX_SIZE_MB) {
    return { ok: false, msg: `图片过大: ${sizeMB.toFixed(1)}MB，限制 ${MAX_SIZE_MB}MB` };
  }
  return { ok: true, size: stat.size };
}

export function toBase64Url(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext];
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

/**
 * 规范化模型输出文本。
 * GLM API 可能返回 string、[{type:"text", text:"..."}]、或 {text:"..."}
 */
export function normalizeContent(message) {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message.map(p => {
      if (typeof p === "string") return p;
      if (p?.text != null) return p.text;       // {type:"text", text:"..."}
      if (p?.content != null) return normalizeContent(p.content); // 嵌套
      return "";
    }).join("");
  }
  if (message && typeof message === "object") {
    if (message.text != null) return message.text;
    if (message.content != null) return normalizeContent(message.content);
  }
  return "";
}
