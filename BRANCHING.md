# 团队开发规范（分支管理与发布流程）

本规范约定团队的分支模型、合并流程与版本发布规则，全体成员须遵照执行。

## 1. 分支模型

| 分支 | 定位 | 生命周期 |
| --- | --- | --- |
| `main` | 稳定发布分支。仅记录已发布的正式版本，任一提交均为可发布状态 | 长期 |
| `develop` | 日常开发主分支。集成全部已完成的开发改动 | 长期 |
| `feature/*`、`fix/*` | 大改动临时分支。自 `develop` 拉出，完成后合回 `develop` 并删除 | 临时 |

1.1 一般改动直接在 `develop` 上开发；大改动须使用临时分支（见第 3 章）。

1.2 `main` 仅接受来自 `develop`（或紧急修复分支）的合并，禁止任何直接提交。

1.3 不得对 `main`、`develop` 等共享分支强制推送或改写历史。

## 2. 分支命名约定

2.1 临时分支命名格式为 `<类型>/<简述>`：

- `feature/`：新功能、较大重构等大改动，如 `feature/sse-stream-lens`；
- `fix/`：缺陷修复类大改动，如 `fix/response-tab-preference`。

2.2 `<简述>` 使用小写英文、连字符分词（kebab-case），不超过 5 个词，须能概括改动内容。

2.3 有对应任务或 Issue 编号时，建议置于简述之前，如 `feature/123-sse-stream-lens`。

2.4 分支合并（或废弃）后须及时删除远端与本地分支。

## 3. 合并流程

### 3.1 一般改动

- 直接基于最新 `develop` 开发并提交；
- 提交信息遵循 Conventional Commits（仓库已配置 commitlint）；
- 推送前执行 `git pull --rebase origin develop`，保持提交历史线性。

### 3.2 大改动

1. 拉分支——始终从最新 `develop` 拉出：

   ```bash
   git switch develop && git pull --rebase && git switch -c feature/<name>
   ```

2. 开发期间定期将 `develop` 的最新改动变基进当前分支（`git rebase develop`），冲突在分支内解决；
3. 完成后通过 Pull Request 合回 `develop`：须经至少一名成员评审，且 CI（lint / typecheck / test）通过；
4. 合并方式建议 Squash，保持 `develop` 历史整洁；
5. 合并后删除该临时分支。

### 3.3 通用要求

- 任何分支在合并前必须与 `develop` 同步并解决全部冲突；
- 禁止将未经评审的临时分支直接合入 `main`。

## 4. 版本发布与 TAG 规则

4.1 发布时机：`develop` 上的改动经测试验证、具备发布条件后，由团队决定启动发布。

4.2 发布流程：

1. 将 `develop` 合并至 `main`，保留发布合并节点（`--no-ff`）：

   ```bash
   git switch main && git pull --rebase && git merge --no-ff develop
   ```

2. 确认版本号与本次发布一致（本仓库由 CI 依据 TAG 自动同步版本清单，本地无需手动修改）；
3. 在 `main` 最新提交上创建附注 TAG 并推送：

   ```bash
   git tag -a v<major>.<minor>.<patch> -m "Release v<major>.<minor>.<patch>"
   git push origin main --follow-tags
   ```

4. 将 `main` 同步回 `develop`，保证后续开发基于最新发布状态：

   ```bash
   git switch develop && git merge main
   ```

4.3 TAG 命名：采用语义化版本（SemVer）`v<major>.<minor>.<patch>`；预发布版本追加标识，如 `v1.2.0-beta.1`、`v1.2.0-rc.1`。TAG 名称中的版本号必须与仓库内版本清单一致。

4.4 发布 TAG 必须指向 `main` 上的正式发布提交；禁止在 `develop` 或临时分支上创建发布 TAG。

4.5 已推送的 TAG 不可修改、不可删除后重建；如需修正，递增版本号后重新发布。

4.6 每个 TAG 对应一次正式发布；发布产物与发布说明由仓库既定流程（CI）依据 TAG 自动生成。

## 5. 紧急修复（hotfix）

5.1 线上缺陷需紧急发布时，从 `main` 拉出 `hotfix/<简述>` 分支进行修复。

5.2 修复经评审与验证后合并回 `main`，并按第 4 章规则打补丁版本 TAG（递增 `patch`）。

5.3 发布完成后再将 `main` 同步回 `develop`，确保修复成果不丢失。

## 6. 禁止事项

6.1 禁止直接向 `main` 提交或推送。

6.2 禁止强制推送（`--force`）或改写 `main`、`develop` 的历史。

6.3 禁止修改、删除已发布的 TAG。

6.4 禁止未经评审将临时分支合入 `main`。

6.5 禁止向 `develop` 提交无法通过 CI 的改动。
