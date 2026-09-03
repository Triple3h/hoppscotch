<div align="center">
  <h3>
    <b>
      Hoppscotch (Desktop · Local-First)
    </b>
  </h3>
  <b>
    Open Source API Development Client — 纯本地桌面包
  </b>
</div>

<br />

这是 Hoppscotch 的一个**私有化改造 fork**：只保留 **Tauri 桌面应用**形态，移除了一切需要联网/后端/账号的能力（登录、云同步、团队工作区、分享短链、发布文档、Mock Server、Admin 面板、后端与 CLI 等）。数据**全部保存在本机**（localStorage / Tauri store），打开即用、无账号。

---

### 特性

- 🚀 **REST**：`GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `HEAD` / `OPTIONS` 及自定义方法；导入 `cURL`、标签管理、生成多语言代码片段。
- 🔮 **GraphQL**：Endpoint + Schema 获取、多列文档、自定义请求头、查询 Schema 与响应。
- 🔌 **WebSocket**、📡 **Server-Sent Events (SSE)**、🌩 **Socket.IO**、🦟 **MQTT**：完整的实时协议客户端。
- 🔐 **Authorization**：None / Basic / Bearer / OAuth 2.0 / OIDC Access Token · PKCE。
- 📃 **Request Body**：`Content-Type` 选择、FormData / JSON / 原始 / 二进制等。
- 📮 **Response**：状态、头、JSON/XML/HTML/Image/PDF/Audio/Video 预览；复制、下载、保存为示例。
- 📁 **Collections**：集合与嵌套文件夹、导入导出（文件）、环境变量管理。
- 🌱 **Environments**：个人与全局环境变量，请求与脚本中复用。
- 📜 **Pre-Request Scripts** 与 ✅ **Post-Request Tests**：脚本/测试断言（JavaScript sandbox 本地执行）。
- 🧾 **History**：REST / GraphQL / 实时协议历史，随时回放。
- ⏰ **本地持久化**：集合、历史、环境、标签、Cookie、设置全部保存在本机，无任何云同步。
- 🌈 **主题**：系统 / 浅色 / 深色 / 黑色 + 强调色，专注模式。
- ⌨️ **快捷键**：为效率优化；支持自定义键盘布局策略（含 AZERTY 等）。
- 🌎 **i18n**：多语言界面（非英语翻译需与 `en.json` 保持子集一致）。

> 已移除（不再可用）：登录 / 云账号同步、团队与多工作区、分享短链、发布文档、Mock Server、Access Tokens、导出为 GitHub Gist、Admin dashboard、PWA/浏览器扩展形态。

---

## 开发

`pnpm` monorepo（强制 `pnpm install`，勿用 npm/yarn）。先装依赖：

```bash
pnpm install
```

> 仓库根目录 `.env` 主要用于满足 GraphQL codegen 的 dotenv 加载；本地无后端，绝大多数变量为遗留项，缺省也能构建。

### 常用命令（仓库根目录）

| 用途 | 命令 |
| --- | --- |
| Lint | `pnpm lint` |
| Lint fix | `pnpm lintfix` |
| Typecheck | `pnpm typecheck` |
| Test | `pnpm test` |
| 构建 web 产物 | `pnpm --filter @hoppscotch/selfhost-web run build` |
| 单测（common） | `pnpm --filter @hoppscotch/common exec vitest run src/<路径>` |

### 桌面应用开发与打包

构建链：`selfhost-web` 构建 → Rust `webapp-bundler` 打包 → Tauri build。

1. 一键流程（构建前端 + 打包 web bundle）：在 `packages/hoppscotch-desktop` 下执行 `pnpm prepare-web`。

   或分步执行：

   ```bash
   pnpm --filter @hoppscotch/selfhost-web run build   # 产出 packages/hoppscotch-selfhost-web/dist
   cd packages/hoppscotch-desktop/crates/webapp-bundler
   cargo build --release
   # 运行目录为 crates/webapp-bundler 时：
   ./target/release/webapp-bundler \
     --input ../../../hoppscotch-selfhost-web/dist \
     --output ../../bundle.zip \
     --manifest ../../manifest.json
   ```

   > `bundle.zip` 与 `manifest.json` 落在 `packages/hoppscotch-desktop/` 下，供 Tauri 内嵌。

2. 运行桌面应用（开发）：

   ```bash
   cd packages/hoppscotch-desktop
   pnpm tauri dev        # 或 pnpm dev:full
   ```

3. 构建安装包：

   ```bash
   pnpm tauri build      # 或 pnpm build:full
   ```

Tauri 平台依赖（Linux 需 `libwebkit2gtk-4.1` 等）详见 `packages/hoppscotch-desktop/README.md`。

---

## 文档

- 仓库结构 / 架构约束 / 开发约定：见 [`AGENTS.md`](AGENTS.md)。
- 桌面端细节与系统要求：见 [`packages/hoppscotch-desktop/README.md`](packages/hoppscotch-desktop/README.md)。

## License

MIT — 详见 [`LICENSE`](LICENSE)。
