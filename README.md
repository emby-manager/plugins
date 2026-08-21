# Emby Manager Plugins

这里是 Emby Manager Plugin System V2 的官方插件合集，也是第三方插件开发所需的 SDK、CLI、Schema、模板和公开规范仓库。

插件与 EM 核心代码完全解耦。服务端代码运行在独立 Runner 中，不能导入 EM 源码、Prisma、Express、Node 内置模块或环境变量；需要数据、通知、网络、调度、登录设备或播放会话时，只能调用经过声明、签名上限约束和管理员逐项批准的宿主能力。插件还可以声明 Agent Tool、领域事件订阅、Provider operation、Workflow Activity 和官方工作流模板；宿主负责 Schema 校验、幂等、审计、策略、审批、重试及流程状态。插件页面使用声明式 JSON，由 EM 自己渲染，因此会自动继承站点主题、移动端布局和交互样式。

## 快速开始

需要 Node.js 24.10.0 和 npm。第一次开发建议从模板复制一个新目录：

```bash
git clone --branch develop-from-here --single-branch https://github.com/emby-manager/plugins.git
cd plugins
npm ci
cp -R templates/basic plugins/my-plugin
```

然后至少修改以下内容：

- `plugins/my-plugin/plugin.json`：唯一 ID、名称、版本、作者、能力、Action 和页面。
- `plugins/my-plugin/src/server.ts`：服务端 Action 或 Event 实现。
- `plugins/my-plugin/ui/*.json`：由 EM 渲染的页面。
- `plugins/my-plugin/README.md`：用途、配置、权限理由、使用方式和限制。

验证并构建：

```bash
npm run typecheck
npm run plugin:build -- plugins/my-plugin
npm run plugin:verify -- dist/<plugin-id>-<version>.emp
npm test
```

生成的 `.emp` 可以由站点管理员本地导入。EM 不会在服务器上替插件安装依赖或编译 TypeScript，所以包必须在提交或分发前完成构建。

不想完整检出插件合集，可以使用 partial clone 和 sparse checkout，见 [贡献指南](CONTRIBUTING.md)。

## 一个最小插件

`plugin.json` 只申请真正会调用的能力：

```json
{
  "schemaVersion": 2,
  "id": "dev.example.my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "apiVersion": "2",
  "description": "A safe Emby Manager V2 plugin.",
  "author": "Your name",
  "license": "MIT",
  "engines": { "embyManager": ">=0.1.9.4 <0.2.0", "node": ">=24" },
  "entrypoints": { "server": "src/server.ts" },
  "capabilities": ["user.profile.self.read"],
  "actions": [{ "name": "hello", "title": "Say hello", "access": "user" }],
  "pages": [{
    "id": "dashboard",
    "path": "/plugins/my-plugin",
    "title": "My Plugin",
    "location": "user",
    "schema": "ui/dashboard.json"
  }]
}
```

服务端通过 SDK 上下文调用宿主，不直接访问数据库：

```ts
import { definePlugin } from '@emby-manager/plugin-sdk'

export default definePlugin({
  actions: {
    async hello(_input, ctx) {
      const profile = await ctx.users.getMyProfile()
      return { message: `Hello, ${String((profile as any).userName || 'friend')}` }
    },
  },
})
```

完整起点在 [`templates/basic`](templates/basic)，可运行示例在 [`plugins/hello-world`](plugins/hello-world)，用户线路示例在 [`plugins/quick-import`](plugins/quick-import)。

## 权限模型

每次能力调用必须同时满足：

1. 当前包的 `plugin.json` 明确声明精确能力；
2. 发布者公钥允许签发该能力，未签名包还受更低的固定上限约束；
3. 站点管理员已对当前插件版本逐项批准；
4. Broker 在每次调用时再次核对用户、管理员身份、Provider 和资源范围。

未声明能力绝不会因为旧授权、管理员身份或兼容逻辑而生效。`self` 与 `any`、读取与写入、列出与撤销、读取播放会话与停止播放均是不同能力。

例如，读取当前用户的三个会话域需要分别声明：

```json
{
  "capabilities": [
    "session.site.self.read",
    "device.ea.self.read",
    "playback.session.self.read"
  ]
}
```

```ts
const siteLogins = await ctx.sessions.listMySiteSessions()
const eaDevices = await ctx.sessions.listMyEADevices()
const playing = await ctx.sessions.listMyPlaybackSessions()
```

这些读取只返回 EM 维护的本地快照；站点会话会用 `current` 标识发起当前 Action 的登录设备，但不返回 JWT、EA Webhook Key、Emby API Key、媒体路径或流地址，也不会因为插件调用而临时请求 EA。撤销登录设备或停止播放必须额外申请对应的 `*.revoke` / `*.stop` 能力；`any` 版本还要求管理员 Action 上下文。

所有能力及其限制见 [能力清单](docs/capabilities.md)，威胁模型见 [安全模型](docs/security.md)。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `plugins/` | 官方与社区插件源码；每个目录是一个独立插件 |
| `templates/basic/` | 新插件模板 |
| `packages/sdk/` | 插件可见的类型和 `definePlugin` API |
| `packages/cli/` | manifest 校验、打包、摘要和签名验证工具 |
| `packages/provider-conformance/` | 隔离沙箱中的 Download Provider 语义兼容矩阵 |
| `schemas/plugin.schema.json` | Plugin V2 manifest 的机器可读 Schema |
| `docs/` | 能力和安全规范 |
| `catalog/` | 官方签名目录与吊销清单 |
| `keys/` | 可公开核对的官方公钥 |
| `dist/` | 本地或 CI 构建的 `.emp` 包 |

## 页面、配置与后台功能

- 用户页面只能使用 `/plugins/<slug>`，管理员页面只能使用 `/admin/plugins/<slug>`。
- 页面只能调用 manifest 中已经声明的 Action，不能执行任意 HTML、React 或浏览器脚本。
- 配置使用受限 JSON Schema，不支持会在宿主进程执行正则或加载外部引用的关键字。
- 插件自己的后台管理页、配置和业务逻辑也应放在插件目录中；不要向 EM 核心添加插件专用页面或数据库表。
- 每个插件拥有物理隔离的 SQLite 数据库。普通数据使用 `ctx.storage`，敏感配置使用 `ctx.secrets`，不得依赖 EM 主库结构。

## Agent-ready 扩展

- `agentTools`：向 EM 的 AI 运维注册具名工具。只读工具可以直接执行；`SUPERVISED_WRITE` 工具必须声明签名的风险上限，并只能经 Policy、审批和 Tool Executor 执行。
- `eventSubscriptions`：按 [公开事件合同](schemas/events/plugin-events-v1.json) 声明精确类型、`contractVersion` 和可见 `dataFields`。事件至少投递一次，插件必须用 `event.id` 去重；未签名插件不能订阅平台事件。
- `providers`：提供元数据、字幕、下载、求片、线路、支付、通知或质量能力；输入输出都受签名包内的 Schema 约束。标准供应链 Provider 还必须匹配版本化线协议；当前规范与模板见 [Provider 协议](docs/provider-protocols.md)。
- `workflowActivities`：只返回步骤数据，不能持有或修改工作流状态；超时、重试、暂停、恢复和补偿由宿主持有。
- `workflowTemplates`：只在官方签名包中进入官方模板目录。模板不会绕过任何 Activity 权限或写入审批。

官方 Action 发布插件时，会从已经验签的包 Manifest 自动生成模板目录摘要，包含步骤数量、读写步骤、所需能力和写步骤风险上限。开发者不能单独编辑或上传这份摘要。目录元数据只用于发现与安装；EM 真正创建运行时仍以已安装包的摘要和 Manifest 为准，并重新经过能力批准、灰度、Policy 与审批。
- `secretScopes`：管理员把 Secret 配置给宿主，插件只能通过 `ctx.secrets.fetch()` 请求指定主机。明文不会进入 Runner。

这些声明不是权限通配符。每个扩展引用的能力必须同时出现在顶层 `capabilities`，运行时仍会核对当前包摘要、发布者信任、能力上限和管理员授权。完整示例见 [`plugins/hello-world`](plugins/hello-world)。

Download Provider 还可以在可清理的隔离环境运行
[`@emby-manager/provider-conformance`](packages/provider-conformance)，提前发现重复提交、
响应丢失恢复、状态倒退和取消不可复核等语义问题。自测报告只用于开发反馈，不会
自动换取官方签名、能力授权或生产资格。

## 发布方式

### 提交到官方合集

从 `develop-from-here` 创建分支，一个 PR 只能修改一个 `plugins/<plugin>/` 目录。CI 会检查 PR 边界、类型、Schema、可复现构建、包内容、测试和依赖风险。合并后，只有受保护的官方 GitHub Action 能读取签名 Secret 并发布目录条目。

详细流程、目录约束和审核标准见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 自行分发

开发者也可以用自己的 Ed25519 密钥签名 `.emp`。站点管理员需要先核对并导入发布者公钥，再逐项批准能力。第三方发布者不能声明自己是官方发布者，也不能获得超过其公钥上限的权限。

### 本地开发

未签名包可用于本地调试，但默认停用，且只能申请固定的低风险能力集合。需要设备、通知、网络、调度、外部账号或播放控制的插件，应使用可核验的第三方签名，或向官方合集提交 PR。

外部账号适配器同样是开放的插件能力，不是 EmbyBoss 或 Fabric 专属。声明
`externalAccountAdapters` 后，插件卡片会按清单中的名称自动显示“外部账号”标签；
`kind` 是插件自定义的受约束标识，EM 不维护品牌白名单。适配器仍须提供真实的
有界路由和服务端处理器，并逐项申请账号生命周期能力，空声明不会获得接入权限。

## 官方信任锚

EM 默认信任本仓库目录使用的 Ed25519 公钥；官方发布者不可由后台替换或吊销。私钥只存在于 GitHub `plugin-signing` Environment 中，PR、普通 CI、仓库文件和 EM 实例都无法读取。

- Key ID：`emby-manager-official-2026-01`
- SHA-256 指纹：`da64af36e0a6bc398196ad59fa210a6c071cadaccc389fbc1e345173d59c8b02`
- 公钥：[`keys/emby-manager-official-2026-01.pub.pem`](keys/emby-manager-official-2026-01.pub.pem)

官方签名只确认来源和完整性，不代表自动授权；管理员仍然要对每个插件版本逐项批准能力。

若某个已经发布的官方包被确认存在安全问题，维护者通过受保护的 `Revoke official plugin package` Action 按精确 SHA-256 吊销。Action 会把 `catalog/index.json` 与 `catalog/revoked.json` 一起纳入新版目录签名；EM 周期同步后会隐藏该版本、立即停止摘要命中的 Runner、禁用其调度与事件投递，并要求人工解除隔离和重新审批。站点后台始终不能吊销或替换官方发布者公钥。

## 参与前请阅读

- [贡献指南](CONTRIBUTING.md)
- [能力清单](docs/capabilities.md)
- [SDK API 参考](docs/sdk-api.md)
- [安全模型](docs/security.md)
- [Manifest Schema](schemas/plugin.schema.json)

如果发现能绕过能力声明、签名校验、Runner 隔离、Provider 绑定或数据隔离的安全问题，请不要提交公开利用代码；先通过 GitHub Security Advisory 私下报告。
