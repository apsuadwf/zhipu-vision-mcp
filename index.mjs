#!/usr/bin/env node
/**
 * 智谱视觉 MCP Server — 为 DeepSeek 等纯文本模型提供视觉能力
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync, statSync } from "fs";
import { extname } from "path";

// ═══════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════

const API_KEY = process.env.ZHIPU_API_KEY || "";
const API_BASE = "https://open.bigmodel.cn/api/paas/v4";
const CHAT_ENDPOINT = `${API_BASE}/chat/completions`;
const TIMEOUT_MS = 120_000;

const MODELS = {
  "glm-4.6v-flash":          { label: "GLM-4.6V-Flash",          base64: true,  maxImg: 50, maxTok: 4096, temp: 0.7, desc: "最新免费视觉模型 ⭐推荐" },
  "glm-4.1v-thinking-flash": { label: "GLM-4.1V-Thinking-Flash", base64: true,  maxImg: 50, maxTok: 4096, temp: 0.7, desc: "带深度思考，分析更深入" },
  "glm-4v-flash":            { label: "GLM-4V-Flash",            base64: false, maxImg: 1,  maxTok: 1024, temp: 0.7, desc: "首个免费视觉模型，仅支持URL" },
};

const MODEL_KEYS = Object.keys(MODELS);
const DEFAULT_MODEL = "glm-4.6v-flash";
const MAX_SIZE_MB = 5;

// ═══════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════

const isURL = (s) => /^https?:\/\//.test(s);

const MIME_MAP = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
};

function validateImage(filePath) {
  // 用 statSync 一步完成存在性+大小检查，避免 TOCTOU 竞态
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { ok: false, msg: `文件不存在或无法访问: ${filePath}` };
  }
  const ext = extname(filePath).toLowerCase();
  if (!MIME_MAP[ext]) {
    return { ok: false, msg: `不支持的格式: ${ext}，仅支持 ${Object.keys(MIME_MAP).join("/")}` };
  }
  const sizeMB = stat.size / (1024 * 1024);
  if (sizeMB > MAX_SIZE_MB) {
    return { ok: false, msg: `图片过大: ${sizeMB.toFixed(1)}MB，限制 ${MAX_SIZE_MB}MB` };
  }
  return { ok: true };
}

function toBase64Url(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext] || "image/jpeg";
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

/** 规范化模型输出文本（处理 content 可能是数组/对象的情况） */
function normalizeContent(message) {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message.map(p => (typeof p === "string" ? p : p?.text || "")).join("");
  }
  if (message && typeof message === "object" && "text" in message) return message.text;
  return String(message ?? "");
}

// ═══════════════════════════════════════════════
// 核心：调用 GLM 视觉 API
// ═══════════════════════════════════════════════

/** @returns {{ ok: true, text: string } | { ok: false, text: string }} */
async function callGLM(model, images, prompt, opts = {}) {
  // 1. 检查 API Key
  if (!API_KEY) {
    return { ok: false, text:
      "未设置 ZHIPU_API_KEY 环境变量。\n\n"
      + "📋 获取步骤：\n"
      + "  1. 访问 https://bigmodel.cn/usercenter/proj-mgmt/apikeys\n"
      + "  2. 登录后创建 API Key\n"
      + "  3. 设置环境变量: export ZHIPU_API_KEY='你的密钥'" };
  }

  // 2. 验证模型
  const info = MODELS[model];
  if (!info) {
    return { ok: false, text: `不支持的模型: ${model}。可选: ${MODEL_KEYS.join(", ")}` };
  }

  // 3. 图片数量校验（maxImg 不再死配置）
  if (images.length > info.maxImg) {
    return { ok: false, text: `模型 ${info.label} 最多支持 ${info.maxImg} 张图片，当前传入 ${images.length} 张` };
  }

  // 4. 构建 content 数组
  const content = [];
  for (const img of images) {
    if (isURL(img)) {
      content.push({ type: "image_url", image_url: { url: img } });
    } else {
      if (!info.base64) {
        return { ok: false, text:
          `模型 ${info.label} 不支持本地图片（Base64）。\n`
          + "解决方案：改用 glm-4.6v-flash 或 glm-4.1v-thinking-flash" };
      }
      const valid = validateImage(img);
      if (!valid.ok) return { ok: false, text: valid.msg };
      try {
        content.push({ type: "image_url", image_url: { url: toBase64Url(img) } });
      } catch (e) {
        return { ok: false, text: `读取图片失败: ${e.message}` };
      }
    }
  }
  content.push({ type: "text", text: prompt });

  // 5. 发起请求
  try {
    const resp = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        stream: false,
        temperature: opts.temperature ?? info.temp,
        max_tokens: info.maxTok,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      let detail = await resp.text().catch(() => "无法读取响应");
      try { detail = JSON.parse(detail)?.error?.message || detail; } catch {}
      return { ok: false, text: `API 错误 (HTTP ${resp.status}): ${detail}` };
    }

    // 安全解析 JSON（防御 2xx 空 body / HTML）
    let result;
    try {
      result = await resp.json();
    } catch {
      return { ok: false, text: "API 返回了非 JSON 响应，请检查网络或代理" };
    }

    const choice = result.choices?.[0];
    if (!choice) {
      return { ok: false, text: "模型未返回任何内容" };
    }

    const msg = choice.message ?? {};
    // 优先 content，回退到 reasoning_content（thinking 模型安全/拒绝类响应）
    let text = normalizeContent(msg.content);
    if (!text && msg.reasoning_content) {
      text = normalizeContent(msg.reasoning_content);
    }
    if (!text) text = "(空)";

    // usage footer（防御字段缺失）
    const usage = result.usage ?? {};
    const pTok = usage.prompt_tokens ?? "-";
    const cTok = usage.completion_tokens ?? "-";
    const footer = `\n\n---\n📊 ${info.label}（免费）| 输入 ${pTok} | 输出 ${cTok} tokens`;

    return { ok: true, text: text + footer };
  } catch (e) {
    // Node 18 早期版本 fetch 超时抛 AbortError 而非 TimeoutError
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      return { ok: false, text: `请求超时（${TIMEOUT_MS / 1000}秒），请重试` };
    }
    return { ok: false, text: `调用失败: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════════════

const server = new McpServer({ name: "zhipu-vision", version: "1.0.0" });

const MODEL_ENUM = z.enum(MODEL_KEYS);

// ── 工具 1: 分析图片 ──

server.tool(
  "analyze_image",
  "【视觉核心工具】使用智谱免费视觉模型分析图片，返回文字描述。支持本地文件和远程URL。",
  {
    image: z.string().describe("图片的本地绝对路径 或 远程 HTTP/HTTPS URL"),
    prompt: z.string().optional().describe(
      "分析提示词。默认全面描述；可定制：代码截图/UI设计/图表数据/错误日志等场景"
    ),
    model: MODEL_ENUM.optional().default(DEFAULT_MODEL).describe(
      "视觉模型，默认 glm-4.6v-flash（支持本地文件）。glm-4v-flash 仅支持 URL"
    ),
    detail: z.enum(["concise", "standard", "detailed"]).optional().default("detailed").describe(
      "详细程度（仅 prompt 为空时生效）"
    ),
  },
  async ({ image, prompt, model, detail }) => {
    const defaults = {
      concise:  "请用一两句话简要描述这张图片的内容。",
      standard: "请描述这张图片的主要内容，包括关键元素和文字信息。",
      detailed: "请详细描述这张图片的内容，涵盖：整体场景/主题、关键元素和细节、所有文字内容（原文输出）、颜色和构图特点、可能传达的信息或目的。请用中文回答。",
    };
    const finalPrompt = prompt
      ? prompt                              // 用户显式传入优先
      : defaults[detail] ?? defaults.detailed;
    const { ok, text } = await callGLM(model, [image], finalPrompt);
    return { content: [{ type: "text", text }], isError: !ok };
  }
);

// ── 工具 2: OCR 提取文字 ──

server.tool(
  "extract_text_from_image",
  "【OCR工具】从图片中精准提取文字内容。适用于截图（代码/日志/文档）、表格图片等。",
  {
    image: z.string().describe("图片路径或URL"),
    model: MODEL_ENUM.optional().default(DEFAULT_MODEL),
  },
  async ({ image, model }) => {
    const prompt = "请精准提取这张图片中的所有文字内容。保持原有格式、排版结构和层级关系。表格用Markdown表格格式，代码保持缩进。只输出文字，不加解释。";
    // OCR 使用低温度避免幻觉字符
    const { ok, text } = await callGLM(model, [image], prompt, { temperature: 0.1 });
    return { content: [{ type: "text", text }], isError: !ok };
  }
);

// ── 工具 3: 对比图片 ──

server.tool(
  "compare_images",
  "【对比工具】对比两张图片的差异。适用于 UI 还原度检查、版本差异对比。",
  {
    image1: z.string().describe("第一张图片的路径或URL"),
    image2: z.string().describe("第二张图片的路径或URL"),
    focus: z.string().optional().describe("对比重点: UI布局差异、文字内容变化、颜色差异等"),
    model: MODEL_ENUM.optional().default(DEFAULT_MODEL),
  },
  async ({ image1, image2, focus, model }) => {
    const prompt = `请对比以下两张图片。\n对比重点：${focus || "所有显著差异"}\n\n## 相同点\n...\n\n## 差异点\n...\n\n## 总结\n...\n请用中文。`;
    const { ok, text } = await callGLM(model, [image1, image2], prompt);
    return { content: [{ type: "text", text }], isError: !ok };
  }
);

// ═══════════════════════════════════════════════
// 启动 & 优雅退出
// ═══════════════════════════════════════════════

if (!API_KEY) {
  console.error("⚠️  警告: 未设置 ZHIPU_API_KEY 环境变量");
  console.error("   请访问 https://bigmodel.cn/usercenter/proj-mgmt/apikeys 获取密钥");
}

const transport = new StdioServerTransport();
await server.connect(transport);

// 优雅退出：收到 SIGINT/SIGTERM 时关闭 transport，避免孤儿进程
const shutdown = async () => {
  try { await server.close(); } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
