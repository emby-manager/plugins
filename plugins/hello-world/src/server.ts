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
      await ctx.storage.set('greetingCount', count)
      return { message: `${ctx.config.greeting || '你好'}，${profile?.nickName || profile?.userName || '用户'}！`, count }
    },
  },
})
