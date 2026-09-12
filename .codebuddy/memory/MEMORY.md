# 项目长期记忆（Hoppscotch 本地化 fork）

## 用户偏好
- **记忆文件随代码一起提交**：`.codebuddy/memory/` 下的工作日志改动要顺带包含在功能提交里（2026-09-03 用户要求）。旧日志内容无需保留/恢复，简洁的当日记录即可。

## 环境与工具
- `@hoppscotch/common` 的 `vue-tsc` CLI（1.8.8 + TS 5.9.3）在此环境会崩（"Search string not found"），类型检查用 `node type-check.mjs`（包内 `do-typecheck`）。
- `search_content`(ripgrep) 会跳过 gitignore 文件（如生成的 `helpers/backend/graphql.ts`），查生成物需用 execute_command grep。
- 提交遵循 conventional commits；husky 钩子已删除（2026-09-03 之前的会话）。

## 脚本沙箱（hoppscotch-js-sandbox）事实
- 沙箱里**没有 CryptoJS/crypto-js**，哈希只能用 WebCrypto：`crypto.subtle.digest("SHA-256", 数字数组)`，返回数字数组（带 byteLength），需自己转 hex。
- experimental 沙箱（默认开）把脚本包成 `await (async function(){...})()`，支持顶层 await；`pm.*`（含 `pm.request.headers.add/upsert`）Postman 兼容层只在 experimental 路径存在，legacy worker 里没有 `pm`。
- 坑：faraday-cage 的 `TextEncoder` polyfill `encode()` 返回无 `length`/迭代器的纯对象 → `Array.from(...)` 为空，必须手写 UTF-8 编码（`encodeURIComponent` + 解析 `%XX`）。

## 本 fork 已完成的重构（跨会话事实）
- 仓库是 Hoppscotch 桌面本地化 fork：无云端/团队/登录，数据全本地（详见根目录 AGENTS.md）。
- 2026-09-03：已分 5 个提交移除团队层、云同步、登录入口、孤儿 GraphQL 订阅文档和 husky 钩子（0e7b5f907…c86810968）。
- 2026-09-03：响应区新增“实际请求”Tab（3d4f5f74f），参考 Apifox，组件 `components/lenses/ActualRequestRenderer.vue`，数据源为 `response.req`（EffectiveHoppRESTRequest，含脚本添加的头）。

## SSE 实时流式（2026-09-12 完成）
- REST 页识别 `text/event-stream`（含 body 嗅探）显示「事件」时间线 Tab：分条展示/自动合并（delta 拼接）+ 思考过程开关 + 六个消息格式预设（OpenAI/Gemini/Claude/Ollama×2/自定义 JSONPath），格式配置全局持久化（`newstore/SSEMessageFormat.ts`，localStorage key `sse-message-format-preference`）。
- 链路：Rust relay（curl write_function，仅 SSE content-type 推 chunk，base64）→ tauri-plugin-relay（Tauri Channel）→ kernel desktop impl（emitter 真实化，`RelayRequestEvents.headersReceived/chunk`）→ `ExecutionResult.emitter?` → native interceptor → `network.ts`（50ms 节流发 `loading+streaming` 中间态）→ `SSELensRenderer.vue`。
- **依赖已切本地**：`tauri-plugin-relay`（src-tauri Cargo.toml）与 `relay` crate（plugin Cargo.toml）均为 path 依赖；JS 侧 kernel desktop impl 直接 `invoke("plugin:relay|execute", { request, onEvent: Channel })`，不再依赖 `@hoppscotch/plugin-relay` 运行时（仍用其类型）。上游 GitHub rev 摘要在注释里。
- 坑：Tauri command 的 `Channel<T>` 参数不能 `Option` 包裹（Option 走 Deserialize blanket，编译失败）；curl transfer 的 write/header 两闭包共享状态须 `Arc<AtomicBool>`；`@hoppscotch/plugin-relay` 是 npm GitHub 依赖（plugin-workspace/ 下只是本地副本，切换 path 前构建不使用它们）。
- 已知边界：SSE 长流仍受请求 timeout 总时长约束（用户配置了 timeout 且流超时会被掐断）。
- 2026-09-12 UI 对齐项目风格：分条展示/自动合并用原生 `HoppSmartTabs`（`#actions` 插槽放格式下拉/思考过程开关/筛选/复制），格式下拉为 `HoppSmartSelectWrapper` + pill 按钮；检测到 SSE 时自动切「事件」Tab（`ResponseBodyRenderer` 里 sse lens 出现跃迁时切一次，不干扰用户后续手动切换）；思考过程区块可折叠（`reasoningCollapsed`，默认展开）。
- **坑（2026-09-12 修复）**：`ExecutionResult.emitter` 必须是**同步存在**的对象。native interceptor 原先用懒 getter（`relayExecution?.emitter`），而 `helpers/network.ts` 在 `execute()` 返回后立即读取它——那时 relay execution 还没建立，恒为 undefined，流事件全部丢失（表现为"只在完成后一次性展示"）。现改为 interceptor 内同步建 hub + 转发 relay 事件。另：`components/http/Response.vue` 的 lens 渲染门槛必须放行 `loading && response.streaming`（否则流式中间态根本不渲染）。
- 诊断桌面端流式问题看 `~/Library/Logs/io.hoppscotch.desktop/io.hoppscotch.desktop.log`（DEBUG 级，含 curl debug 数据、response headers、relay 执行结果）；判断"运行的 webapp 是不是最新构建"可 diff `$TMPDIR/hopp_bundle.zip` 与 `packages/hoppscotch-desktop/bundle.zip`，或用 bundle 内 sourcemap 的 sourcesContent 复核。
- **Tauri Channel 协议错配（2026-09-12 修复）**：本仓库 JS SDK 钉在 `@tauri-apps/api@2.1.1`，其 `Channel` 读回调参数里的 `{ id }`；而 Rust 端 tauri 2.10.3 发的是 `{ message, index }` —— 消息被塞进 `pendingMessages["undefined"]` 后静默丢弃，流式侧信道完全失效。修法（kernel `relay/impl/desktop/v/1.ts`）：用 `transformCallback` 自注册回调 + 直接传 `__CHANNEL__:<id>` 字符串给 `invoke`，并按 index 有序投递。升级 JS SDK 到与 Rust 匹配的版本后可回退为直接用 `Channel`。
