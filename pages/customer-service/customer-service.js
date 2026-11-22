const { request, ensureLogin } = require('../../utils/request')
const api = require('../../utils/api')

Page({
  data: { ready: false, busy: false, active: false, siteId: null, siteName: '', routeLabel: '', contactSiteName: '', servicePhone: '', error: '' },
  onShow() { this.loadContext() },
  onUnload() { this.disposed = true },

  async loadContext() {
    if (this.data.busy) return
    this.setData({ busy: true, ready: false, servicePhone: '', error: '' })
    try {
      await ensureLogin()
      let context = await this.fetchContext()
      let recentName = ''
      if (!context.activeOrder) {
        const summary = await api.users.summary().catch(() => null)
        const recent = ((summary && summary.recentWashOrders) || [])[0]
        const siteId = recent && (recent.siteId || (recent.site && recent.site.id))
        if (siteId) {
          const recentContext = await this.fetchContext(siteId).catch(() => null)
          if (recentContext) {
            context = recentContext
            recentName = recent.siteName || (recent.site && recent.site.name) || ''
          }
        }
      }
      const hasSite = Number(context.siteId) > 0
      const isSite = context.route === 'site' && hasSite
      let contactSiteName = hasSite ? context.siteName || '' : ''
      let phone = hasSite ? context.servicePhone : ''
      if (isSite && !contactSiteName) {
        const detail = await api.sites.detail(context.siteId).catch(() => null)
        contactSiteName = (detail && (detail.name || detail.siteName)) || (!context.activeOrder && recentName) || '洗车场地'
        if (phone === undefined && detail) phone = detail.servicePhone
      }
      const servicePhone = String(phone || '').trim()
      if (this.disposed) return
      this.setData({ ready: true, active: !!context.activeOrder, siteId: isSite ? context.siteId : null,
        siteName: isSite ? contactSiteName : '平台客服',
        routeLabel: isSite ? (context.awaitingStart ? '团购券已核销，等待启动' : context.activeOrder ? '正在洗车的场地' : '最近洗过的场地') : '官方在线客服',
        contactSiteName,
        servicePhone: /^\+?\d{6,20}$/.test(servicePhone.replace(/[\s-]/g, '')) ? servicePhone : '' })
    } catch (err) {
      if (!this.disposed) this.setData({ error: '暂时无法连接客服，请检查网络后重试。' })
    } finally {
      if (!this.disposed) this.setData({ busy: false })
    }
  },
  callSite() {
    const { ready, busy, servicePhone } = this.data
    if (!ready || busy || !servicePhone) return
    wx.makePhoneCall({
      phoneNumber: servicePhone.replace(/[\s-]/g, ''),
      fail(err) {
        if (!/cancel/i.test(String(err && err.errMsg))) {
          wx.showToast({ title: '暂时无法拨打，请尝试在线咨询', icon: 'none' })
        }
      }
    })
  },
  fetchContext(siteId) {
    return request({ url: '/mini/customer-service/context', method: 'POST', data: siteId ? { siteId } : {} })
  },
  retry() { this.loadContext() },
  contactError() { this.setData({ error: '暂时无法打开在线客服，请稍后重试。' }) }
})
