# 贡献插件

感谢你为 Emby Manager 插件生态贡献代码。本仓库接受“新增一个插件”或“改进一个现有插件”的社区 PR；仓库基础设施、SDK、Schema、目录、签名和工作流由维护者通过单独的 `maintenance/*` 分支管理。

## 开发前准备

- Node.js 24.10.0；
- npm；
- 一个 GitHub fork；
- 对计划使用的 [能力](docs/capabilities.md) 和 [安全边界](docs/security.md) 有基本了解。

仓库同时提供 Codex 项目 Skill：`.codex/skills/develop-emby-manager-plugin/`。在仓库中使用 Codex 开发或审核插件时，可直接调用 `$develop-emby-manager-plugin`；它会先核对能力声明、安全边界和单插件 PR 范围，再执行构建与验证。

插件不能通过依赖 EM 内部源码、数据库表或构建产物来实现功能。若现有 SDK 缺少必要能力，请先开 Issue 描述用例、所需数据、期望写操作和最小权限边界；不要在插件中绕过宿主接口。

## 轻量拉取

`develop-from-here` 是与 `main` 自动快进同步的干净开发起点。它不用来直接提交代码，每个插件应从它创建独立分支。

下面只展开开发单个插件所需的 SDK、CLI、规范、模板和参考代码：

```bash
git clone --branch develop-from-here --single-branch --filter=blob:none --no-checkout \
  https://github.com/<your-account>/plugins.git
cd plugins
git sparse-checkout init --no-cone
git sparse-checkout set \
  '/package.json' '/package-lock.json' '/tsconfig.json' \
  '/packages/' '/schemas/' '/templates/' '/docs/' \
  '/plugins/hello-world/'
git checkout
git switch -c plugin/my-plugin
npm ci
cp -R templates/basic plugins/my-plugin
```

如果 fork 里还没有 `develop-from-here`，先从上游同步该分支，或把 `upstream/develop-from-here` 推到自己的 fork。

## 目录与命名

一个插件的全部源码、测试、页面和说明必须位于同一个目录：

```text
plugins/my-plugin/
├── README.md
├── plugin.json
├── src/
│   ├── server.ts
│   └── server.test.ts
└── ui/
    └── dashboard.json
```

约定：

- 插件目录使用小写 kebab-case；
- `plugin.json` 的 `id` 必须全局唯一且使用反向域名形式，例如 `io.example.my-plugin`；
- 不要使用 `io.emby-manager.*`、`dev.emby-manager.*` 或其他会让人误以为官方维护的 ID；
- `version` 使用 SemVer；已经发布的版本不能覆盖，修改包内容必须升版本；
- `author`、`repository`、`license` 和 `description` 应真实、可核对；
- 用户页位于 `/plugins/<slug>`，后台页位于 `/admin/plugins/<slug>`，路径不得冒充核心页面。

## Manifest 与权限

只声明代码当前确实调用的能力。不要为了“以后可能用到”提前申请权限。

提交前逐项确认：

- `capabilities` 中每一项都能在代码中找到调用理由；
- 当前用户使用 `self` 能力，跨用户操作才申请 `any`，且对应 Action 必须是 `admin`；
- 读取和写入分别申请，不因为已经能读就假设可以修改；
- 会话读取、撤销设备、播放会话读取、停止播放分别申请；
- 外部网络只列出必要的精确主机，并区分 `network.read` 与 `network.write`；
- 敏感值写入 `ctx.secrets`，普通状态写入 `ctx.storage`；
- 外部 API Secret 使用 `secretScopes + ctx.secrets.fetch()`，不要调用已废弃的 `secrets.get()`；
- Agent Tool 名称使用插件 ID 命名空间，读写模式必须准确；
- 事件订阅使用 [公开合同](schemas/events/plugin-events-v1.json) 中的精确 `contractVersion`，只申请必要 `dataFields`，并按 `event.id` 实现幂等；
- Workflow Activity 只返回步骤结果，不自行保存流程状态或决定重试；
- Provider operation 和 Activity 的每项能力都必须在顶层逐项声明；
- 插件不保存、记录或返回用户 JWT、密码、API Key、Webhook Key；
- 插件不尝试访问其他插件的数据文件或 EM 主数据库。

权限说明应写进插件自己的 `README.md`，告诉管理员每项权限为何必要、会读取什么、会修改什么。

## 编写代码

服务端入口默认导出 `definePlugin({...})`。可用接口由 `PluginContext` 类型给出，不要假设存在未公开字段。

```ts
import { definePlugin } from '@emby-manager/plugin-sdk'

export default definePlugin({
  actions: {
    async status(_input, ctx) {
      return {
        siteSessions: await ctx.sessions.listMySiteSessions({ limit: 20 }),
        eaDevices: await ctx.sessions.listMyEADevices({ limit: 20 }),
        playback: await ctx.sessions.listMyPlaybackSessions({ limit: 20 }),
      }
    },
  },
})
```

插件 Runner 不提供 Node 内置模块、文件系统、子进程、环境变量、直接 `fetch` 或 WebSocket。需要的外部效果必须使用 SDK 能力；这样宿主才能执行范围校验、SSRF 防护、超时、大小限制和审计。

插件前端只提交声明式 `ui/*.json`，不要提交打包后的 React、HTML 或可执行浏览器脚本。Action 输入和输出都应保持有界、可序列化，并对外部协议字段做长度、类型和枚举校验。

## 测试与构建

插件至少应测试：

- 正常输入；
- 缺失或错误输入；
- 能力被拒绝时的行为；
- 普通用户不能触发管理员操作；
- 外部账号适配器不能跨 Provider、不能泄露内部 ID 或凭据；
- 输出不包含路径、Token、Secret 或未声明数据。
- 事件重复投递不会重复产生副作用；
- 扩展输入输出不符合 Schema 时会被拒绝；
- Runner 超时、停用或包更新后能安全恢复。

外部账号适配器不是官方插件专属能力。插件可以在 `externalAccountAdapters`
中声明自己的 `id`、显示名称、`kind`、基础路径和逐条路由；其中 `kind` 是插件
拥有的 1-24 位大写不透明标识（如 `MY_PANEL`），宿主没有品牌白名单。插件卡片
会自动显示“外部账号 · {适配器名称}”，但只有同时提供服务端处理器、声明并获批
细分能力后才能实际创建接入。不得为了展示标签声明空适配器。

运行：

```bash
npm run typecheck
npm run plugin:build -- plugins/my-plugin
npm run plugin:verify -- dist/<plugin-id>-<version>.emp
npm test
```

提交 PR 前建议再运行与 CI 相同的完整检查：

```bash
npm run validate
npm audit --omit=dev --audit-level=high
```

不要提交临时文件、私钥、`.env`、真实用户数据、媒体路径、真实 API 响应或包含凭据的测试夹具。构建出的 `.emp` 由 CI 重新生成，一般不需要在插件 PR 中提交 `dist/`。

## PR 边界

每个社区 PR 必须：

- 只修改一个 `plugins/<plugin>/` 目录；
- 不修改第二个插件；
- 不修改 SDK、CLI、workflow、catalog、schema、文档、模板或其他仓库级文件；
- 不通过重命名把仓库外文件移入插件目录；
- 保持提交历史清楚，并在 PR 中说明功能、权限、测试和人工验证结果。

机器门禁会同时检查新增路径和 `previous_filename`。只要修改多个 `plugins/` 目录，或混入插件目录外的文件，`Single plugin scope` 就会失败。

完成后只暂存你的插件目录：

```bash
git add plugins/my-plugin
git status --short
git commit -m "add my plugin"
git push -u origin plugin/my-plugin
```

PR 目标分支使用 `main`。不要直接向 `develop-from-here` 提交；它只作为同步后的开发起点。

## PR 描述建议

请包含：

- 这个插件解决什么问题；
- 用户页或后台页从哪里进入；
- 每项能力的必要性；
- 是否联网，以及允许的主机和请求方向；
- 数据保存在哪里，哪些字段属于 Secret；
- 本地运行过的命令和结果；
- 涉及协议适配时使用的公开文档或脱敏样例；
- 已知限制、失败后的恢复方式和卸载影响。

## 审核标准

维护者会重点检查最小权限、用户/管理员边界、输入上限、错误信息是否泄密、网络目标、Secret 使用、数据隔离、移动端页面、测试质量和升级兼容性。能够运行不等于一定合并；无法在宿主侧可靠约束的设计会要求调整。

官方签名不会自动授予权限。插件合并并发布后，站点管理员仍要对该版本逐项审批。

## 安全问题

如果你发现可以绕过能力声明、管理员批准、签名、Runner 隔离、Provider 绑定、插件数据库隔离或目录门禁的问题，请不要在公开 Issue/PR 中提供可直接利用的细节。请使用 GitHub Security Advisory 私下报告，并说明受影响版本、前置条件、影响和最小复现。
