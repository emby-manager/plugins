import { definePlugin } from '@emby-manager/plugin-sdk'

interface ConnectionLine {
  id: string
  name: string
  url: string
}

interface ConnectionServer {
  id: string
  name: string
  lines: ConnectionLine[]
}

function credential(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\0\r\n]/.test(value)) {
    throw new Error(`${label}不能为空，且不能超过 256 个字符`)
  }
  return value
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export default definePlugin({
  actions: {
    async 'build-senplayer-imports'(input, ctx) {
      const username = credential(input?.username, '用户名')
      const password = credential(input?.password, '密码')
      const rawServers = await ctx.emby.listMyConnections() as ConnectionServer[]
      const links = rawServers.slice(0, 50).flatMap((server) => {
        if (!server || typeof server.name !== 'string' || !Array.isArray(server.lines)) return []
        const lines = server.lines.slice(0, 30).flatMap((line) => {
          const url = httpUrl(line?.url)
          return url ? [{ name: String(line.name || '备用线路').slice(0, 120), url }] : []
        })
        if (!lines.length) return []

        const params = new URLSearchParams({
          type: 'emby',
          name: server.name.slice(0, 120),
          note: '',
          address: lines[0].url,
          username,
          password,
        })
        lines.slice(1).forEach((line, index) => {
          const suffix = index + 1
          params.append(`address${suffix}name`, line.name)
          params.append(`address${suffix}`, line.url)
        })

        return [{
          title: server.name.slice(0, 120),
          description: `${lines.length} 条可用线路`,
          url: `senplayer://importserver?${params.toString()}`,
        }]
      })

      if (!links.length) {
        return { message: '当前账号没有可导入的 Emby 线路。', links: [] }
      }
      return {
        message: `已为 ${links.length} 台服务器生成导入入口。凭据只用于本次深链接，不会保存。`,
        links,
      }
    },
  },
})
