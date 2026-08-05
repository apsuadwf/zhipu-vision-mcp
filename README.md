# 智谱视觉 MCP Server

> 🌐 为 DeepSeek 等纯文本模型提供视觉能力 —— 通过智谱免费视觉模型"看懂"图片。

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

#### 方式 A：npx 一键（推荐）

```bash
claude mcp add -s user zhipu-vision \
  --env ZHIPU_API_KEY=你的密钥 \
  -- npx github:apsuadwf/zhipu-vision-mcp
```

#### 方式 B：本地安装

```bash
git clone https://github.com/apsuadwf/zhipu-vision-mcp.git
cd zhipu-vision-mcp
npm install
npm link
claude mcp add -s user zhipu-vision --env ZHIPU_API_KEY=你的密钥 -- zhipu-vision-mcp
```

### 4. 使用

直接在对话中提及图片，Claude 会自动调用视觉工具分析。也可以手动指定：

> "帮我看看这张截图里的报错信息"  
> "分析这个 UI 设计有什么问题"  
> "提取这张表格图片里的数据"

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

> 高峰期可能遇到 429 限流，换另一个模型即可。

## 环境要求

- Node.js >= 18
- npm >= 9

## 项目结构

```
zhipu-vision-mcp/
├── index.mjs       # MCP Server（单文件）
├── package.json    # 依赖配置
└── README.md       # 本文件
```

## License

MIT
