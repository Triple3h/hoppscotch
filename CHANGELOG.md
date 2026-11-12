# 更新日志

本项目的所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，且本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [1.2.1] - 2026-11-12

### 变更

- 应用内增量更新改为优先从 npm 获取（registry 解析版本、jsDelivr 下载），不可用时回退 GitHub Releases

## [1.2.0] - 2026-11-12

### 新增

- 请求地址栏内联展示查询参数
- 环境列表以环境色标识选中状态

### 变更

- 环境侧栏：Global 固定在搜索框下方，与其他环境行风格统一
- 环境切换器迁移至全局顶栏
- 变量悬浮卡片重排，区分值与描述
- 侧栏搜索行统一为共享组件
- 全局字号、主题色与默认外观调整；统一组件字重、圆角与弹层视觉
- 设置页改为居中单列布局
- 移除 Material Symbols 字体，统一圆角尺度
- 精简界面文案与语言包
- 桌面端更新改为手动确认，重启时机由用户决定

### 移除

- 移除页脚帮助菜单与开发选项入口
- 移除顶栏帮助入口

### 修复

- 修复响应区空白，规范加载态与默认页签
- 修复桌面端更新卡在「正在安装」的问题

## [1.1.8] - 2026-09-23

### 修复

- 响应区滚动归位，固定代码生成下拉宽度
- 实时流式响应中途不再丢失事件页签

## [1.1.7] - 2026-09-23

### 变更

- 标签页架构重构：拆分 tab-bar 门面，合并 REST / GraphQL 组件树，移除死后端 GraphQL 与多实例逻辑
- 移除头部个人工作区徽章；实例下拉改为「个人工作区」并显示壳版本
- 头部用户按钮改为主题色圆角样式

### 修复

- 请求行字号放大，修复粘性头部遮挡内容
- 修复继承脚本站高异常与保存菜单下拉留白
- 标签页内容区改为撑满，修复分栏空白与无法拖动
- 桌面端更新后重启改走 LaunchServices，修复 macOS 白屏

## [1.1.6] - 2026-09-23

### 新增

- 标签栏新增「全部标签」菜单，REST 与 GraphQL 页共用入口
- 环境编辑器改为工作区标签页，标签页头部统一
- 环境支持自定义颜色标记，环境选择器改为下拉面板
- 变量悬浮提示改显单一有效值与来源

### 变更

- 去掉协议下拉，改为静态标签；面包屑字体调大
- 工作区外壳视觉统一：默认蓝色主题与左侧栏布局
- 桌面端 web 包改为增量更新，只下载变化的文件

### 修复

- 继承脚本只读区去掉文字模糊，改用实底与黄色竖条
- 脚本编辑器补上 CryptoJS 全局类型声明

## [1.1.5] - 2026-09-22

### 新增

- 继承脚本改为内联只读展示
- 集合与文件夹改用标签页打开编辑
- 设置页显示当前 / 最新版本与更新内容
- JS 沙箱注入 CryptoJS 全局，兼容 Postman 脚本

### 变更

- 环境选择器精简为分组标题，去掉多余的单一标签页
- 工作区标识改用强调色徽章，圆角与外框对齐
- 启动不再等待更新检查，更新只从设置页手动触发

## [1.1.4] - 2026-09-12

### 新增

- 事件详情改为行内展开，可同时打开多个
- 事件详情改用 CodeMirror JSON 查看器（行号 / 高亮 / 可折叠）

### 修复

- 事件列表固定滚动条槽位，避免打开详情时行宽跳动
- 流式响应的 meta 行改为实时状态，去掉多余的大块「正在加载」
- 右上角工作区标识改用应用配色，去掉硬编码蓝色
- 桌面端更新说明按 Markdown 渲染行内格式

## [1.1.3] - 2026-09-12

### 新增

- web 包增量更新通道（宿主侧，含自愈回滚）
- 启动时静默检查并安装 web 包更新（下次启动生效）

### 变更

- web 包清单加入逐文件字节偏移与壳版本下限，并签名发布

## [1.1.2] - 2026-09-12

### 新增

- 更新页展示版本跃迁与本次更新内容

### 变更

- 应用内更新说明由两个版本标签之间的提交自动生成
- 生产 web 构建不再输出 sourcemap，bundle 体积减少约 60%

## [1.1.1] - 2026-09-12

### 变更

- macOS 安装包启用 ad-hoc 签名，发布说明补充安装位置提醒

## [1.1.0] - 2026-09-12

### 新增

- REST 支持 SSE 流式响应，以实时事件时间线展示

### 修复

- 流式响应期间保留事件页签状态

## [1.0.1] - 2026-09-04

### 变更

- 自动更新切换到本仓库的 GitHub Releases

## [1.0.0] - 2026-09-04

首个发布：本地优先的桌面客户端。

### 新增

- Tauri 桌面应用：数据全部保存在本机，无需账号与云端
- REST 与 GraphQL 客户端，WebSocket / SSE / Socket.IO / MQTT 实时协议
- 集合、环境变量、历史记录、Cookie 与设置的本地持久化
- Pre-request Scripts 与 Post-request Tests，本地沙箱执行
- 「实际请求」页签，展示最终发出的请求

### 移除

- 登录、云同步、团队工作区、分享短链、发布文档、Mock Server、Admin 面板等云端能力
- 后端、CLI 与 Docker / Firebase 部署文件，仅保留桌面形态

[未发布]: https://github.com/Triple3h/hoppscotch/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/Triple3h/hoppscotch/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Triple3h/hoppscotch/compare/v1.1.8...v1.2.0
[1.1.8]: https://github.com/Triple3h/hoppscotch/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/Triple3h/hoppscotch/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/Triple3h/hoppscotch/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/Triple3h/hoppscotch/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/Triple3h/hoppscotch/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/Triple3h/hoppscotch/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/Triple3h/hoppscotch/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/Triple3h/hoppscotch/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Triple3h/hoppscotch/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/Triple3h/hoppscotch/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Triple3h/hoppscotch/releases/tag/v1.0.0
