// callGLM 单元测试：mock fetch，不联网、不需要真实 API Key
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.ZHIPU_API_KEY = "test-key";
const { callGLM } = await import("../src/glm.mjs");

const realFetch = globalThis.fetch;
const URL_A = "https://example.com/a.png";

function mockResponse(status, body, retryAfter = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k === "Retry-After" ? retryAfter : null) },
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const okBody = (content) => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

before(() => { globalThis.fetch = realFetch; });
after(() => { globalThis.fetch = realFetch; });

// ── 成功路径 ──

test("成功：content 为字符串，返回内容与模型 footer", async () => {
  globalThis.fetch = async () => mockResponse(200, okBody("图片内容是：一只猫"));
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, true);
  assert.match(text, /一只猫/);
  assert.match(text, /GLM-4\.6V-Flash/);
  assert.match(text, /输入 10 \| 输出 5 tokens/);
});

test("成功：content 为数组形态（[{type:text,text}]）", async () => {
  globalThis.fetch = async () => mockResponse(200, okBody([{ type: "text", text: "数组形态内容" }]));
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, true);
  assert.match(text, /数组形态内容/);
});

test("成功：content 为空但 reasoning_content 有值", async () => {
  globalThis.fetch = async () => mockResponse(200, {
    choices: [{ message: { content: "", reasoning_content: "思考过程" } }],
  });
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, true);
  assert.match(text, /思考过程/);
});

// ── 重试与降级 ──

test("429：同模型重试后成功（无降级标记）", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? mockResponse(429, {}, "0") : mockResponse(200, okBody("重试成功"));
  };
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, true);
  assert.equal(calls, 2);
  assert.doesNotMatch(text, /降级/);
});

test("429 耗尽：降级到下一个模型并标注", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls <= 3) return mockResponse(429, {}, "0"); // 首模型 3 次 429
    return mockResponse(200, okBody("降级成功"));
  };
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, true);
  assert.equal(calls, 4);
  assert.match(text, /GLM-4\.1V-Thinking-Flash/);
  assert.match(text, /由 GLM-4\.6V-Flash 降级/);
});

test("429 全链耗尽：返回 API 错误（共 3 模型 × 3 次）", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mockResponse(429, { error: { message: "限流" } }, "0");
  };
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, false);
  assert.equal(calls, 9);
  assert.match(text, /HTTP 429/);
  assert.match(text, /限流/);
});

test("5xx：重试耗尽后返回 API 错误", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mockResponse(500, { error: { message: "服务器繁忙" } });
  };
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, false);
  assert.equal(calls, 3);
  assert.match(text, /HTTP 500/);
  assert.match(text, /服务器繁忙/);
});

// ── 错误路径 ──

test("非 JSON 响应", async () => {
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => { throw new Error("Unexpected token"); },
    text: async () => "<html>",
  });
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, false);
  assert.match(text, /非 JSON/);
});

test("模型返回空内容", async () => {
  globalThis.fetch = async () => mockResponse(200, { choices: [{ message: { content: "" } }] });
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, false);
  assert.match(text, /空内容/);
});

test("模型未返回任何内容（无 choices）", async () => {
  globalThis.fetch = async () => mockResponse(200, { choices: [] });
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, false);
  assert.match(text, /未返回任何内容/);
});

test("请求超时：重试耗尽后提示超时", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  };
  const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
  assert.equal(ok, false);
  assert.equal(calls, 3);
  assert.match(text, /超时/);
});

test("不支持的模型", async () => {
  const { ok, text } = await callGLM("unknown-model", [URL_A], "描述");
  assert.equal(ok, false);
  assert.match(text, /不支持的模型/);
});

test("未设置 API Key", async () => {
  delete process.env.ZHIPU_API_KEY;
  try {
    const { ok, text } = await callGLM("glm-4.6v-flash", [URL_A], "描述");
    assert.equal(ok, false);
    assert.match(text, /ZHIPU_API_KEY/);
  } finally {
    process.env.ZHIPU_API_KEY = "test-key";
  }
});

// ── 图片参数校验 ──

test("图片数量超过模型上限", async () => {
  const { ok, text } = await callGLM("glm-4v-flash", [URL_A, "https://example.com/b.png"], "描述");
  assert.equal(ok, false);
  assert.match(text, /最多支持 1 张图片/);
});

test("本地图片被不支持 Base64 的模型拒绝", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zv-"));
  const file = join(dir, "a.png");
  writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));
  try {
    const { ok, text } = await callGLM("glm-4v-flash", [file], "描述");
    assert.equal(ok, false);
    assert.match(text, /不支持本地图片/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("读取图片失败", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zv-"));
  const fake = join(dir, "a.png");
  mkdirSync(fake); // 目录伪装成 .png，statSync 通过但 readFileSync 抛错
  try {
    const { ok, text } = await callGLM("glm-4.6v-flash", [fake], "描述");
    assert.equal(ok, false);
    assert.match(text, /读取图片失败/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
