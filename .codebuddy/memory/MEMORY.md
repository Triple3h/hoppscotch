# 项目长期记忆（Hoppscotch 本地化 fork）

## 用户偏好
- **记忆文件随代码一起提交**：`.codebuddy/memory/` 下的工作日志改动要顺带包含在功能提交里（2026-09-03 用户要求）。旧日志内容无需保留/恢复，简洁的当日记录即可。

## 环境与工具
- `@hoppscotch/common` 的 `vue-tsc` CLI（1.8.8 + TS 5.9.3）在此环境会崩（"Search string not found"），类型检查用 `node type-check.mjs`（包内 `do-typecheck`）。
- `search_content`(ripgrep) 会跳过 gitignore 文件（如生成的 `helpers/backend/graphql.ts`），查生成物需用 execute_command grep。
- 提交遵循 conventional commits；husky 钩子已删除（2026-09-03 之前的会话）。

## 本 fork 已完成的重构（跨会话事实）
- 仓库是 Hoppscotch 桌面本地化 fork：无云端/团队/登录，数据全本地（详见根目录 AGENTS.md）。
- 2026-09-03：已分 5 个提交移除团队层、云同步、登录入口、孤儿 GraphQL 订阅文档和 husky 钩子（0e7b5f907…c86810968）。
- 2026-09-03：响应区新增“实际请求”Tab（3d4f5f74f），参考 Apifox，组件 `components/lenses/ActualRequestRenderer.vue`，数据源为 `response.req`（EffectiveHoppRESTRequest，含脚本添加的头）。
