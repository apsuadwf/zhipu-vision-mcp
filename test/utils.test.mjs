// 工具函数单元测试：node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isURL, validateImage, toBase64Url, normalizeContent } from "../src/utils.mjs";

test("isURL：识别 http/https", () => {
  assert.equal(isURL("https://example.com/a.png"), true);
  assert.equal(isURL("http://example.com/a.png"), true);
  assert.equal(isURL("ftp://example.com/a.png"), false);
  assert.equal(isURL("C:\\tmp\\a.png"), false);
  assert.equal(isURL("/tmp/a.png"), false);
});

test("validateImage：文件不存在", () => {
  const r = validateImage("Z:/no/such/file.png");
  assert.equal(r.ok, false);
  assert.match(r.msg, /文件不存在/);
});

test("validateImage：不支持的格式", () => {
  const dir = mkdtempSync(join(tmpdir(), "zv-"));
  const file = join(dir, "a.txt");
  writeFileSync(file, "hello");
  try {
    const r = validateImage(file);
    assert.equal(r.ok, false);
    assert.match(r.msg, /不支持的格式/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateImage：超过 5MB 限制", () => {
  const dir = mkdtempSync(join(tmpdir(), "zv-"));
  const file = join(dir, "big.png");
  writeFileSync(file, Buffer.alloc(6 * 1024 * 1024));
  try {
    const r = validateImage(file);
    assert.equal(r.ok, false);
    assert.match(r.msg, /图片过大/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateImage：合法文件", () => {
  const dir = mkdtempSync(join(tmpdir(), "zv-"));
  const file = join(dir, "a.png");
  writeFileSync(file, Buffer.alloc(1024));
  try {
    const r = validateImage(file);
    assert.equal(r.ok, true);
    assert.equal(r.size, 1024);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("toBase64Url：MIME 前缀与 base64 内容", () => {
  const dir = mkdtempSync(join(tmpdir(), "zv-"));
  const file = join(dir, "a.jpg");
  writeFileSync(file, Buffer.from("hello"));
  try {
    const url = toBase64Url(file);
    const prefix = "data:image/jpeg;base64,";
    assert.ok(url.startsWith(prefix));
    assert.equal(url.slice(prefix.length), Buffer.from("hello").toString("base64"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizeContent：字符串", () => {
  assert.equal(normalizeContent("你好"), "你好");
});

test("normalizeContent：数组（string 与 {text} 混合）", () => {
  const arr = ["前缀", { type: "text", text: "中段" }, { text: "后缀" }];
  assert.equal(normalizeContent(arr), "前缀中段后缀");
});

test("normalizeContent：{text} 对象", () => {
  assert.equal(normalizeContent({ text: "内容" }), "内容");
});

test("normalizeContent：{content} 嵌套对象", () => {
  assert.equal(normalizeContent({ content: { text: "嵌套" } }), "嵌套");
});

test("normalizeContent：未知结构返回空串", () => {
  assert.equal(normalizeContent({ foo: 1 }), "");
  assert.equal(normalizeContent(null), "");
  assert.equal(normalizeContent(undefined), "");
});
