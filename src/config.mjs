// ═══════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════

export const getAPIKey = () => process.env.ZHIPU_API_KEY || "";
export const CHAT_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
export const TIMEOUT_MS = 120_000;
export const MAX_RETRIES = 2;
export const MAX_TOTAL_MB = 20; // 单次请求图片总大小上限
export const MAX_SIZE_MB = 5;   // 单张图片大小上限

export const MODELS = {
  "glm-4.6v-flash":          { label: "GLM-4.6V-Flash",          base64: true,  maxImg: 50, maxTok: 4096, temp: 0.7, free: true },
  "glm-4.1v-thinking-flash": { label: "GLM-4.1V-Thinking-Flash", base64: true,  maxImg: 50, maxTok: 4096, temp: 0.7, free: true },
  "glm-4v-flash":            { label: "GLM-4V-Flash",            base64: false, maxImg: 1,  maxTok: 1024, temp: 0.7, free: true },
};

export const MODEL_KEYS = Object.keys(MODELS);
export const DEFAULT_MODEL = "glm-4.6v-flash";

export const MIME_MAP = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
};
export const MIME_LIST = Object.keys(MIME_MAP).join("/");

export const DETAIL_PROMPTS = {
  concise:  "请用一两句话简要描述这张图片的内容。",
  standard: "请描述这张图片的主要内容，包括关键元素和文字信息。",
  detailed: "请详细描述这张图片的内容，涵盖：整体场景/主题、关键元素和细节、所有文字内容（原文输出）、颜色和构图特点、可能传达的信息或目的。请用中文回答。",
};
