# Changelog

本项目的所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- 开源化改造：源码按职责拆分到 `src/`，新增单元测试（node:test）、CI（GitHub Actions）、ESLint 代码规范
- 一键本地安装：`npm run setup`（自动 `npm link` + 配置 Claude MCP）

## [1.0.0] - 2026-08-05

### 新增

- 智谱视觉 MCP Server，为 DeepSeek 等纯文本模型提供视觉能力
- 三个工具：`analyze_image`（分析图片）、`extract_text_from_image`（OCR 提取文字）、`compare_images`（对比两张图片）
- 三种免费视觉模型：`glm-4.6v-flash`（默认，支持本地文件与多图）、`glm-4.1v-thinking-flash`（带深度思考）、`glm-4v-flash`（仅 URL 单图）
- 429 限流降级链：默认模型限流时自动切换下一个模型，同模型内自动重试

### 修复

- 修复第二轮 code review 发现的 15 项问题

### 文档

- README 安装命令与 `repository` 字段
