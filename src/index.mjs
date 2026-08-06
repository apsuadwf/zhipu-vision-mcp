#!/usr/bin/env node
/**
 * 智谱视觉 MCP Server — 为 DeepSeek 等纯文本模型提供视觉能力
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getAPIKey } from "./config.mjs";
import { server } from "./server.mjs";

// ═══════════════════════════════════════════════
// 启动 & 优雅退出
// ═══════════════════════════════════════════════

if (!getAPIKey()) {
  console.error("⚠️  警告: 未设置 ZHIPU_API_KEY 环境变量");
  console.error("   请访问 https://bigmodel.cn/usercenter/proj-mgmt/apikeys 获取密钥");
}

const transport = new StdioServerTransport();

// 优雅退出：提前注册，覆盖信号 + stdin EOF + transport close
const shutdown = async () => {
  try { await server.close(); } catch { /* 关闭失败也退出 */ }
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
