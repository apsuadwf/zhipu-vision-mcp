// ═══════════════════════════════════════════════
// 核心：调用 GLM 视觉 API
// ═══════════════════════════════════════════════

import {
  getAPIKey, CHAT_ENDPOINT, TIMEOUT_MS, MAX_RETRIES,
  MAX_TOTAL_MB, MODELS, MODEL_KEYS,
} from "./config.mjs";
import { isURL, validateImage, toBase64Url, normalizeContent } from "./utils.mjs";

/**
 * 预构建图片 content 数组（与模型无关，只做文件级校验）
 * @returns {{ ok: true, parts: Array } | { ok: false, text: string }}
 */
export function buildContent(images, prompt) {
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
export async function callGLM(model, images, prompt, opts = {}) {
  const API_KEY = getAPIKey();
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
        try { detail = JSON.parse(detail)?.error?.message || detail; } catch { /* 保留原文 */ }
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
