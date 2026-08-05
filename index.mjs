#!/usr/bin/env node
/**
 * 智谱视觉 MCP Server — 为 DeepSeek 等纯文本模型提供视觉能力
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, statSync } from "fs";
import { extname } from "path";

// ═══════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════

const API_KEY = process.env.ZHIPU_API_KEY || "";
const CHAT_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;
const MAX_TOTAL_MB = 20; // 单次请求图片总大小上限

const MODELS = {
  "glm-4.6v-flash":          { label: "GLM-4.6V-Flash",          base64: true,  maxImg: 50, maxTok: 4096, temp: 0.7, free: true },
  "glm-4.1v-thinking-flash": { label: "GLM-4.1V-Thinking-Flash", base64: true,  maxImg: 50, maxTok: 4096, temp: 0.7, free: true },
  "glm-4v-flash":            { label: "GLM-4V-Flash",            base64: false, maxImg: 1,  maxTok: 1024, temp: 0.7, free: true },
};

const MODEL_KEYS = Object.keys(MODELS);
const DEFAULT_MODEL = "glm-4.6v-flash";
const MAX_SIZE_MB = 5;

// ═══════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════

const isURL = (s) => /^https?:\/\//i.test(s);

const MIME_MAP = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
};
const MIME_LIST = Object.keys(MIME_MAP).join("/");

const DETAIL_PROMPTS = {
  concise:  "请用一两句话简要描述这张图片的内容。",
  standard: "请描述这张图片的主要内容，包括关键元素和文字信息。",
  detailed: "请详细描述这张图片的内容，涵盖：整体场景/主题、关键元素和细节、所有文字内容（原文输出）、颜色和构图特点、可能传达的信息或目的。请用中文回答。",
};

function validateImage(filePath) {
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

function toBase64Url(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext];
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

/**
 * 规范化模型输出文本。
 * GLM API 可能返回 string、[{type:"text", text:"..."}]、或 {text:"..."}
 */
function normalizeContent(message) {
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

// ═══════════════════════════════════════════════
// 核心：调用 GLM 视觉 API
// ═══════════════════════════════════════════════

/**
 * 预构建图片 content 数组（与模型无关，只做文件级校验）
 * @returns {{ ok: true, parts: Array } | { ok: false, text: string }}
 */
function buildContent(images, prompt) {
  const parts = [];
  let totalBytes = 0;
  for (const img of images) {
    if (isURL(img)) {
      parts.push({ type: "image_url", image_url: { url: img } });
    } else {
      const valid = validateImage(img);
      if (!valid.ok) return { ok: false, text: valid.msg };
      totalBytes += valid.size;
      if (totalBytes > MAX_TOTAL_MB * 1024 * 1024) {
        return { ok: false, text: `图片总大小超过 ${MAX_TOTAL_MB}MB 上限` };
      }
      try {
        parts.push({ type: "image_url", image_url: { url: toBase64Url(img) } });
      } catch (e) {
        return { ok: false, text: `读取图片失败: ${e.message}` };
      }
    }
  }
  parts.push({ type: "text", text: prompt });
  return { ok: true, parts };
}

/**
 * 调用 GLM 视觉模型，支持 429 降级链。
 *
 * 从请求的模型开始，按 MODELS 声明顺序降级：
 * glm-4.6v-flash → glm-4.1v-thinking-flash → glm-4v-flash
 *
 * @param {string} model - 首选模型
 * @param {string[]} images - 图片路径或 URL
 * @param {string} prompt - 提示词
 * @param {{ temperature?: number }} [opts] - 可选参数
 * @returns {Promise<{ok: boolean, text: string}>}
 */
async function callGLM(model, images, prompt, opts = {}) {
  if (!API_KEY) {
    return { ok: false, text:
      "未设置 ZHIPU_API_KEY 环境变量。\n\n"
      + "📋 获取步骤：\n"
      + "  1. 访问 https://bigmodel.cn/usercenter/proj-mgmt/apikeys\n"
      + "  2. 登录后创建 API Key\n"
      + "  3. 设置环境变量: export ZHIPU_API_KEY='你的密钥'" };
  }

  if (!MODELS[model]) {
    return { ok: false, text: `不支持的模型: ${model}。可选: ${MODEL_KEYS.join(", ")}` };
  }

  // 预构建 content（模型无关）
  const built = buildContent(images, prompt);
  if (!built.ok) return { ok: false, text: built.text };
  const contentParts = built.parts;

  // 构建降级链：[首选, 后续模型...]
  const startIdx = MODEL_KEYS.indexOf(model);
  const chain = MODEL_KEYS.slice(startIdx);

  let chainExhausted429 = false;

  for (const m of chain) {
    const info = MODELS[m];
    const isLast = m === chain[chain.length - 1];

    // 检查此模型是否支持当前请求
    if (images.length > info.maxImg) {
      if (isLast) return { ok: false, text: `模型 ${info.label} 最多支持 ${info.maxImg} 张图片，当前传入 ${images.length} 张` };
      continue; // 跳过，试下一个
    }
    const hasLocal = images.some(img => !isURL(img));
    if (hasLocal && !info.base64) {
      if (isLast) return { ok: false, text: `模型 ${info.label} 不支持本地图片（Base64）` };
      continue;
    }

    // 发起请求（同模型内重试）
    const body = JSON.stringify({
      model: m,
      messages: [{ role: "user", content: contentParts }],
      stream: false,
      temperature: opts.temperature ?? info.temp,
      max_tokens: info.maxTok,
    });

    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (resp.ok) {
          let result;
          try { result = await resp.json(); } catch {
            return { ok: false, text: "API 返回了非 JSON 响应，请检查网络或代理" };
          }
          const choice = result.choices?.[0];
          if (!choice) return { ok: false, text: "模型未返回任何内容" };

          const msg = choice.message ?? {};
          let text = normalizeContent(msg.content);
          if (!text.trim() && msg.reasoning_content) {
            text = normalizeContent(msg.reasoning_content);
          }
          if (!text.trim()) return { ok: false, text: "模型返回了空内容" };

          const usage = result.usage ?? {};
          const freeLabel = info.free ? "（免费）" : "";
          const switched = m !== model ? ` (由 ${MODELS[model].label} 降级)` : "";
          const footer = `\n\n---\n📊 ${info.label}${freeLabel}${switched} | 输入 ${usage.prompt_tokens ?? "-"} | 输出 ${usage.completion_tokens ?? "-"} tokens`;
          return { ok: true, text: text + footer };
        }

        // 429 → 同模型重试
        if (resp.status === 429 && attempt < MAX_RETRIES) {
          const retryAfter = parseInt(resp.headers.get("Retry-After") || "1", 10);
          await new Promise(r => setTimeout(r, Math.min(retryAfter * 1000, 3000)));
          continue;
        }

        // 429 耗尽 → 非最后一个模型则降级
        if (resp.status === 429 && !isLast) {
          chainExhausted429 = true;
          break; // 退出内层重试循环，外层 for 会尝试下一个模型
        }

        // 5xx → 同模型重试
        if (resp.status >= 500 && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }

        // 不可重试的错误（包括最后模型的 429）
        let detail = await resp.text().catch(() => "无法读取响应");
        try { detail = JSON.parse(detail)?.error?.message || detail; } catch {}
        return { ok: false, text: `API 错误 (HTTP ${resp.status}): ${detail}` };

      } catch (e) {
        lastError = e;
        if (attempt < MAX_RETRIES && (e.name === "TimeoutError" || e.name === "AbortError" || e.name === "TypeError")) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        break;
      }
    }

    // 内层循环退出但 429 已耗尽 → 已在上面处理（break 到外层 for 的下一轮）
    if (chainExhausted429) { chainExhausted429 = false; continue; }

    // 非 429 的重试耗尽 → 直接返回
    if (lastError) {
      if (lastError.name === "TimeoutError" || lastError.name === "AbortError") {
        return { ok: false, text: `请求超时（${TIMEOUT_MS / 1000}秒），请重试` };
      }
      return { ok: false, text: `调用失败: ${lastError.message}` };
    }
  }

  return { ok: false, text: "所有模型均不可用，请稍后重试" };
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
    const finalPrompt = prompt || DETAIL_PROMPTS[detail];
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

// 优雅退出：提前注册，覆盖信号 + stdin EOF + transport close
const shutdown = async () => {
  try { await server.close(); } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("end", shutdown);
transport.onclose = shutdown;

try {
  await server.connect(transport);
} catch (e) {
  console.error("❌ MCP Server 启动失败:", e.message);
  process.exit(1);
}
