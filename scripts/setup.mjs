#!/usr/bin/env node
/**
 * 本地一键安装：npm link + 配置 Claude MCP
 *
 * 用法: npm run setup
 * - 读取 .env 或环境变量中的 ZHIPU_API_KEY 自动传入
 * - 未找到密钥时仍完成 link，稍后手动配置
 */

import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  return r.status ?? 1;
};

// 1. 链接到全局（MCP 配置指向全局 bin，启动零下载）
console.log("🔗 执行 npm link ...");
if (run("npm", ["link"]) !== 0) {
  console.error("❌ npm link 失败");
  process.exit(1);
}

// 2. 读取 API Key（优先 .env，其次环境变量）
let apiKey = process.env.ZHIPU_API_KEY;
if (!apiKey && existsSync(resolve(".env"))) {
  const env = readFileSync(resolve(".env"), "utf8");
  const m = env.match(/^\s*ZHIPU_API_KEY\s*=\s*(.+)\s*$/m);
  if (m) apiKey = m[1].trim();
}

// 3. 配置 Claude MCP
const args = ["mcp", "add", "-s", "user", "zhipu-vision"];
if (apiKey) args.push("--env", `ZHIPU_API_KEY=${apiKey}`);
args.push("--", "zhipu-vision-mcp");

console.log("🔧 配置 Claude MCP ...");
if (run("claude", args) === 0) {
  console.log(apiKey
    ? "✅ 安装完成！zhipu-vision 已配置到 Claude（含 API Key）"
    : "✅ 安装完成！zhipu-vision 已配置到 Claude\n   ⚠️ 未找到 ZHIPU_API_KEY，请执行: claude mcp add zhipu-vision --env ZHIPU_API_KEY=你的密钥");
} else {
  console.error("❌ claude mcp add 失败，请手动执行上方的 claude mcp add 命令");
  process.exit(1);
}
