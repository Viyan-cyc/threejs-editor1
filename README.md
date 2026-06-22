# Three.js Editor

自然语言驱动的 3D 场景编辑器。技术栈：**Vue 3 + TypeScript + Vite + Three.js**。

> 当前为第 11 阶段：接入真实 LLM（OpenAI 兼容）。左栏输入 → LLM 按 05 协议返回结构化 JSON（核心为 createScene 代码）→ 校验（JSON + 静态黑名单 + 丢弃 nextDSL）→ sandbox iframe 运行 → 右侧 HTML / 3D 预览 / DSL 联动；运行失败保留上一版。未配置 LLM 时发送指令直接报错。
>
> **配置 LLM**：浏览器不能直连 LLM（CORS + key 暴露），用代理。复制 `.env.example` 为 `.env.local`：
> - `LLM_BASE_URL`（服务端，不带 VITE_）：OpenAI 兼容 baseURL，如 `https://api.openai.com/v1`
> - `LLM_API_KEY`（服务端，不带 VITE_）：仅 dev 代理/后端使用，不进浏览器
> - `VITE_LLM_MODEL`（客户端，非敏感，必须带 VITE_ 前缀）：模型名
>
> dev：`vite.config.ts` 把 `/api/llm/*` 转发到 `LLM_BASE_URL` 并服务端注入 key（无跨域、key 不暴露）。改完 `.env.local` 需重启 dev。prod：用真实后端接管 `/api/llm`。3D 预览需联网（iframe 从 unpkg 加载 three）。

## 启动

```bash
npm install
npm run dev      # 开发服务器（默认 http://localhost:5173，端口占用时换端口）
npm run build    # 类型检查 + 生产构建
npm run type-check   # 仅类型检查
npm run preview  # 预览生产构建
```

## 页面结构

- **左侧 对话区**：消息列表 + 输入框 + 发送按钮；系统消息展示「思考摘要 / 执行计划 / 生成说明」（不展示原始思考）。
- **右侧 结果区**（三页签）：
  - **3D 预览**：Three.js 立方体场景（旋转 / 缩放 / 平移）。
  - **HTML 代码**：可独立运行的 Three.js 场景示例。
  - **DSL**：当前场景对应的 JSON 快照（mock）。

## 代码结构（与实现相关的部分）

```
src/
├─ main.ts                     应用入口
├─ App.vue                     左右分栏外壳
├─ types/                      类型定义层（message / scene）
├─ utils/                      工具（uid）
├─ mock/                       mock 回复 + HTML/DSL 示例
├─ three/SimpleScene.ts        Three.js 场景封装（mount / dispose）
├─ components/
│  ├─ chat/                    对话区组件
│  └─ result/                  结果区组件（页签 + 3D/HTML/DSL）
└─ styles/global.css           全局样式与 CSS 变量
```

需求与设计文档见 [docs/](./docs/)。
