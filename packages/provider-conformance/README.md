# @emby-manager/provider-conformance

Download Provider 的隔离沙箱语义兼容测试包。它会实际执行两次幂等提交、按
`commandId` 做响应丢失恢复、检查状态单调性，再执行两次幂等取消并确认最终
`CANCELLED`。

这个包只用于开发和 CI。调用方必须显式确认目标是可清理的隔离沙箱；测试报告
不包含标题、外部 ID、作业 ID、URL 或凭据，也不能替代 EM 的签名、权限审批、
Secret Broker、生产黑盒验收与连续运行证据。

```ts
import { runDownloadProviderConformance } from '@emby-manager/provider-conformance'

const report = await runDownloadProviderConformance({
  authorization: {
    isolatedSandbox: true,
    writesAndCancellationApproved: true,
    confirmation: 'RUN_ISOLATED_DOWNLOAD_PROVIDER_CONFORMANCE',
  },
  invoke: async (operation, input, { signal }) => {
    return myIsolatedProvider.invoke(operation, input, { signal })
  },
})

if (report.status !== 'PASSED') process.exitCode = 1
```

每次运行使用随机、不含业务含义的请求与命令 ID。适配器必须把 `AbortSignal`
继续传到外部 HTTP 调用；单次调用超时后，测试立即停止，避免在结果不确定时继续
发出后续写操作。
