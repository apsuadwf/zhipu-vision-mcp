// ═══════════════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════════════

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MODEL_KEYS, DEFAULT_MODEL, DETAIL_PROMPTS } from "./config.mjs";
import { callGLM } from "./glm.mjs";

export const server = new McpServer({ name: "zhipu-vision", version: "1.0.0" });
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
