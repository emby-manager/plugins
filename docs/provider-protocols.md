# Provider 协议与兼容性

Provider 是宿主可发现的外部能力，不是一个可以自行推进业务状态的迷你工作流。
EM 持有 Durable Workflow、Policy、审批、重试、补偿和人工接管；插件只把外部
Provider 的命令或事实转换成有界协议结果。

## 兼容性等级

| 状态 | 含义 | 可进入官方供应链 |
| --- | --- | --- |
| `VERIFIED` | 使用 EM 保留协议 ID，版本、kind、operation、执行模式和线 Schema 全部匹配 | 可以继续接受宿主配置与生产验收 |
| `DECLARED_UNVERIFIED` | 使用第三方协议 ID，CLI 只能确认声明完整 | 不会被当作 EM 标准 Provider |
| `CUSTOM_UNVERIFIED` | 没有协议声明的旧版自定义 Provider | 仅保留兼容，不进入标准供应链 |

`emby-manager.*` 是保留命名空间。插件不能用未知版本冒充官方兼容；官方协议
升级会增加新版本，不会静默改变已发布版本的语义。

## Download Provider 1.0

清单使用：

```json
{
  "kind": "DOWNLOAD",
  "protocol": { "id": "emby-manager.download", "version": "1.0" }
}
```

规范源文件是 [`schemas/providers/download-v1.json`](../schemas/providers/download-v1.json)。
CLI 会逐字义比较规范化后的线 Schema，避免同名 operation 实际返回另一种结构。

| Operation | 模式 | 语义 |
| --- | --- | --- |
| `submit` | `SUPERVISED_WRITE` | 使用宿主稳定 `commandId` 创建或复用外部作业；含糊结果必须返回 `RECONCILIATION_REQUIRED` |
| `status` | `READ_ONLY` | 按稳定 `commandId`（可附已知作业 ID）读取 Provider 事实；`UNKNOWN` 不能被解释为成功或失败 |
| `cancel` | `SUPERVISED_WRITE` | 使用新的稳定命令取消作业；不能删除 EM 的请求、目录或审计事实 |

`submit` 与 `cancel` 即使已声明能力，也只能由宿主持有的 Workflow 在通过 Policy、
必要审批和执行前再次鉴权后调用。普通 Action、Agent Tool 或管理员页面不能直接
把 `supervised=true` 传给 Runner。`status` 只报告事实，不推进 Workflow。

Provider 必须把 `commandId` 作为上游幂等身份，并支持在作业 ID 尚未知时按该命令
查询。宿主没收到 HTTP 响应时不会盲目重发写入，而是先用 `status` 对账；无法
证明结果时保持人工可见的待对账状态。`ACCEPTED` 及任何已知进度必须带真实
`providerJobRef`，只有 `RECONCILIATION_REQUIRED` / `UNKNOWN` 可以暂时为 `null`。

## Secret 与不可信输出

- URL、Token、Cookie、Passkey 和下载器凭据只放在宿主 Secret Broker；
- 插件用精确 `secretScopes` 与主机白名单请求，Runner 不取得明文 Secret；
- `secrets.fetch()` 的 GET 需要 `network.secret.use`；POST/PUT/PATCH/DELETE 还必须由清单、发布者上限和管理员授权分别允许 `network.write`；
- 标题、候选、外部消息和 Provider 响应均是不可信内容，不能成为系统提示、权限、
  审批或状态跳转指令；
- 结果必须通过插件清单 Schema、宿主协议 Schema、Secret 泄漏检查和 1 MB 总量上限；
- 签名只证明来源和包完整性，不代表站点已经批准网络或写入能力。

完整起点见 [`templates/download-provider`](../templates/download-provider)。该模板只演示
协议边界，不能在填入生产凭据前跳过隔离环境、失败演练和真实 Provider 黑盒验收。

## 隔离沙箱语义兼容矩阵

清单 Schema 一致只能证明“线格式相同”，不能证明 Provider 真正遵守幂等和恢复
语义。插件开发者可使用
[`@emby-manager/provider-conformance`](../packages/provider-conformance) 在可清理的隔离
沙箱运行以下矩阵：

| 用例 | 必须证明 |
| --- | --- |
| 响应丢失恢复 | 丢弃首次 `submit` 响应后，只用稳定 `commandId` 的 `status` 仍能找到同一作业 |
| 重复提交 | 相同 `commandId` 的重复 `submit` 不创建第二个上游作业 |
| 状态单调 | 只读状态不倒退，终态不会变成另一种状态 |
| 重复取消 | 相同取消命令不会改变作业引用，也不会发散为两次取消语义 |
| 取消事实 | `cancel` 的写回执最终能由只读 `status=CANCELLED` 复核 |

测试会发出真实的沙箱提交与取消，未提供精确确认短语时零调用失败关闭；单次调用
超时后立即停止后续步骤，避免在写入结果不确定时继续制造副作用。报告只保留状态、
错误码和作业引用摘要，不保存业务标题、外部 ID、作业 ID、URL、Cookie、Token 或
其他凭据。

该报告是开发反馈，不是信任证据：插件签名、管理员能力审批、Secret scope、宿主
隔离、EM 持有的真实第三方黑盒验收、24 小时连续运行证据和目标 EA 可播放事实仍
必须分别通过。插件不能把自测结果上传后自行获得生产资格。
