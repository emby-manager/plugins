import {
  definePlugin,
  type DownloadProviderCancelInput,
  type DownloadProviderCancelOutput,
  type DownloadProviderStatusInput,
  type DownloadProviderStatusOutput,
  type DownloadProviderSubmitInput,
  type DownloadProviderSubmitOutput,
  type PluginContext,
} from '@emby-manager/plugin-sdk'

function baseUrl(context: PluginContext): string {
  const value = typeof context.config.baseUrl === 'string' ? context.config.baseUrl.trim() : ''
  if (!value) throw new Error('Provider baseUrl is not configured')
  return value.replace(/\/+$/, '')
}

async function call(context: PluginContext, path: string, method: 'GET' | 'POST', body?: unknown): Promise<Record<string, unknown>> {
  const response = await context.secrets.fetch({
    scope: 'provider-api',
    url: `${baseUrl(context)}${path}`,
    method,
    body,
  })
  if (!response.ok) throw new Error(`Provider request failed with HTTP ${response.status}`)
  const parsed: unknown = JSON.parse(response.body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Provider returned invalid JSON')
  return parsed as Record<string, unknown>
}

export default definePlugin({
  providers: {
    download: {
      operations: {
        async submit(input: DownloadProviderSubmitInput, context: PluginContext): Promise<DownloadProviderSubmitOutput> {
          return await call(context, '/jobs', 'POST', input) as unknown as DownloadProviderSubmitOutput
        },
        async status(input: DownloadProviderStatusInput, context: PluginContext): Promise<DownloadProviderStatusOutput> {
          const reference = encodeURIComponent(input.providerJobRef)
          const request = encodeURIComponent(input.contentRequestId)
          return await call(context, `/jobs/${reference}?contentRequestId=${request}`, 'GET') as unknown as DownloadProviderStatusOutput
        },
        async cancel(input: DownloadProviderCancelInput, context: PluginContext): Promise<DownloadProviderCancelOutput> {
          const reference = encodeURIComponent(input.providerJobRef)
          return await call(context, `/jobs/${reference}/cancel`, 'POST', input) as unknown as DownloadProviderCancelOutput
        },
      },
    },
  },
})
