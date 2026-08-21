# Download Provider V1 template

这是 `emby-manager.download@1.0` 的完整线协议模板。修改插件 ID、Provider 名称、
允许主机和 API 映射，但不要修改三个标准 operation 的名称、`executionMode` 或
输入输出 Schema；否则 CLI 和 EM 会拒绝把它识别为兼容 Provider。

外部 API 必须以 `commandId` 幂等，并能在作业 ID 丢失时按 commandId 查询。`submit` / `cancel` 只能由 EM 的受控 Workflow
调用；`status` 只返回外部系统的当前事实。模板中的域名和响应字段都是占位符，
必须按真实 Provider 文档实现并完成隔离黑盒验收。

模板的 `src/server.test.ts` 已接入
`@emby-manager/provider-conformance`，演示如何把三个 operation 交给隔离沙箱兼容
矩阵。替换为真实 API 后应保留这项测试，并确保测试账号、下载目录与目标 EA 都是
可清理的非生产资源。兼容矩阵通过不代表生产准入；真实凭据黑盒验收与连续运行
证据仍由 EM 独立持有。
