import { definePlugin } from '@emby-manager/plugin-sdk'

export default definePlugin({
  async activate(ctx) {
    ctx.log.info('Hello World V2 activated')
  },
  actions: {
    async greet(_input, ctx) {
      const profile = await ctx.users.getMyProfile() as { nickName?: string; userName?: string } | null
      const countRecord = await ctx.storage.get('greetingCount')
      const count = Number(countRecord?.value || 0) + 1
      const greeting = typeof ctx.config.greeting === 'string' && ctx.config.greeting.trim()
        ? ctx.config.greeting.trim()
        : '你好'
      const displayName = profile?.nickName || profile?.userName || '用户'
      await ctx.notifications.sendToMe({
        title: 'Hello Plugin 向你问好',
        message: `${greeting}，${displayName}！`,
      })
      await ctx.storage.set('greetingCount', count)
      return { message: `问候已通过站内通知发送给 ${displayName}`, count }
    },
    async 'greet-everyone'(_input, ctx) {
      const greeting = typeof ctx.config.greeting === 'string' && ctx.config.greeting.trim()
        ? ctx.config.greeting.trim()
        : '你好'
      const result = await ctx.notifications.sendToAll({
        title: '来自 Hello Plugin 的问候',
        message: `${greeting}！这是一条由站点管理员发送的问候。`,
      })
      return { message: `已向 ${result.recipientCount} 位有效站内用户发送问候`, recipientCount: result.recipientCount }
    },
  },
})
