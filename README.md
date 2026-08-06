# 智谱视觉 MCP Server

> 🌐 为 DeepSeek 等纯文本模型提供视觉能力 —— 通过智谱免费视觉模型"看懂"图片。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/apsuadwf/zhipu-vision-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/apsuadwf/zhipu-vision-mcp/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/apsuadwf/zhipu-vision-mcp)](https://github.com/apsuadwf/zhipu-vision-mcp/releases)

## 特性

- 🆓 **完全免费**：全部使用智谱免费视觉模型，无需额外付费
- 🖼️ **本地文件 + 远程 URL**：直接传图片路径即可，自动转 Base64 上传
- 🔄 **429 自动降级链**：默认模型限流时自动切换下一个模型，同模型内自动重试
- 🛠️ **三个专用工具**：图片分析 / OCR 提取文字 / 双图对比
- 📦 **零配置依赖**：只需一个 `ZHIPU_API_KEY` 环境变量

## 原理

```
用户发图 → MCP 调用 GLM 视觉模型（免费）
        → 返回文字描述
        → DeepSeek / 任意文本模型基于描述推理
```

## 快速开始

### 1. 获取 API Key

访问 [智谱开放平台](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)，登录后创建 API Key。

### 2. 安装

#### 方式 A：本地安装（推荐，一条命令）

```bash
git clone https://github.com/apsuadwf/zhipu-vision-mcp.git
cd zhipu-vision-mcp
npm run setup
```

`setup` 脚本自动完成：`npm link`（链接到全局）+ 读取 `.env` 中的 `ZHIPU_API_KEY` 配置 Claude MCP。
没有 `.env` 时先创建（参照 `.env.example`），或运行后手动补上：

```bash
claude mcp add -s user zhipu-vision --env ZHIPU_API_KEY=你的密钥 -- zhipu-vision-mcp
```

本地安装后 Server 已全局可用（`zhipu-vision-mcp` 命令），Claude 每次启动零下载、零网络依赖。

#### 方式 B：npx 远程（备选）

```bash
claude mcp add -s user zhipu-vision \
  --env ZHIPU_API_KEY=你的密钥 \
  -- npx github:apsuadwf/zhipu-vision-mcp
```

> 注：npx 首次运行会从 GitHub 下载源码（有本地缓存），首次较慢；本地安装（方式 A）无此问题。

### 3. 使用

直接在对话中提及图片，Claude 会自动调用视觉工具分析。也可以手动指定：

> "帮我看看这张截图里的报错信息"  
> "分析这个 UI 设计有什么问题"  
> "提取这张表格图片里的数据"

## 其他客户端接入

| 客户端 | 配置方式 |
|--------|----------|
| **Claude Desktop / Claude Code** | 见上方 `claude mcp add` 命令 |
| **Cursor** | 项目根目录创建 `.cursor/mcp.json` |
| **Cherry Studio** | 设置 → MCP 服务 → 添加 → 选择「命令」类型 |
| **Continue** | `~/.continue/config.yaml` 的 `mcpServers` 字段 |

> 💡 本地安装（方式 A）后，各客户端配置里的 `command` 可直接填全局命令 `zhipu-vision-mcp`（无需 npx、无首次下载）。

```jsonc
// Cursor: .cursor/mcp.json
{
  "mcpServers": {
    "zhipu-vision": {
      "command": "npx",
      "args": ["github:apsuadwf/zhipu-vision-mcp"],
      "env": { "ZHIPU_API_KEY": "你的密钥" }
    }
  }
}
```

```yaml
# Continue: config.yaml
mcpServers:
  zhipu-vision:
    command: npx
    args: ["github:apsuadwf/zhipu-vision-mcp"]
    env:
      ZHIPU_API_KEY: 你的密钥
```

## 可用工具

| 工具 | 功能 |
|------|------|
| `analyze_image` | 分析图片，返回详细文字描述 |
| `extract_text_from_image` | OCR 提取图片中的文字 |
| `compare_images` | 对比两张图片的差异 |

## 可用模型

| 模型 | 特点 |
|------|------|
| `glm-4.6v-flash` ⭐ | 最新免费模型，支持本地文件（Base64）和多图 |
| `glm-4.1v-thinking-flash` | 带深度思考，分析更深入 |
| `glm-4v-flash` | 首个免费模型，仅支持 URL 单图 |

> 高峰期可能遇到 429 限流，Server 会自动降级到下一个模型，无需手动切换。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `ZHIPU_API_KEY` | ✅ | 智谱开放平台 API Key（[获取地址](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)） |

## 限制与行为

| 项 | 值 |
|----|----|
| 单张图片大小 | ≤ 5MB |
| 单次请求图片总量 | ≤ 20MB |
| 请求超时 | 120 秒 |
| 单模型重试 | 最多 2 次（429 / 5xx / 超时） |
| 429 降级链 | `glm-4.6v-flash` → `glm-4.1v-thinking-flash` → `glm-4v-flash` |
| 图片格式 | JPG / JPEG / PNG / WebP / GIF / BMP |

## 开发调试

用官方 Inspector 可视化调试工具（无需真实图片）：

```bash
# 本地安装后（推荐）
npx @modelcontextprotocol/inspector zhipu-vision-mcp

# 或 npx 远程
npx @modelcontextprotocol/inspector npx github:apsuadwf/zhipu-vision-mcp

# 或本地开发时直接指向源码
npx @modelcontextprotocol/inspector node src/index.mjs
```

运行测试与代码检查：

```bash
npm run check   # lint + test
```

## 故障排查

| 症状 | 原因与解决 |
|------|------------|
| 启动时出现 `未设置 ZHIPU_API_KEY 警告` | 未配置 API Key，检查环境变量或客户端配置 |
| `API 错误 (HTTP 429)` | 高峰期限流，Server 已自动重试/降级，稍后重试即可 |
| `请求超时（120秒）` | 网络不稳定或需代理，检查网络后重试 |
| `图片过大: X.XMB` | 单张图片超过 5MB，压缩后再试 |
| `不支持的格式` | 仅支持 JPG / PNG / WebP / GIF / BMP |
| `API 返回了非 JSON 响应` | 网络或代理干扰，检查代理设置 |

## FAQ

**Q：这个 Server 会收费吗？**
A：不会。所有模型均为智谱免费模型，只消耗你智谱账号的免费额度。

**Q：支持哪些图片格式？**
A：JPG / JPEG / PNG / WebP / GIF / BMP，单张不超过 5MB。

**Q：只能配合 Claude 使用吗？**
A：不是。任何支持 MCP 的客户端都可以接入，见上方「其他客户端接入」。

**Q：`glm-4v-flash` 为什么不支持本地图片？**
A：该模型仅接受图片 URL。本地图片请用默认的 `glm-4.6v-flash`（自动转 Base64）。

**Q：429 报错频繁怎么办？**
A：Server 会自动降级到备用模型。若仍频繁限流，建议错峰使用或稍后重试。

## 环境要求

- Node.js >= 18
- npm >= 9

## 项目结构

```
zhipu-vision-mcp/
├── src/                     # MCP Server 源码
│   ├── index.mjs            # 入口：连接 stdio、信号处理、优雅退出
│   ├── server.mjs           # 工具定义（analyze_image / extract_text_from_image / compare_images）
│   ├── glm.mjs              # GLM API 调用：请求、重试、429 降级链
│   ├── utils.mjs            # 工具函数：图片校验、Base64、响应规范化
│   └── config.mjs           # 配置：模型表、端点、限制常量
├── test/                    # 单元测试（node:test，mock fetch，无需联网）
│   ├── utils.test.mjs
│   └── glm.test.mjs
├── .github/workflows/       # CI（Node 18/20/22 × Ubuntu）
├── .env.example             # 环境变量示例
├── eslint.config.js         # ESLint 配置
└── CHANGELOG.md             # 变更日志
```

## License

[MIT](LICENSE)
