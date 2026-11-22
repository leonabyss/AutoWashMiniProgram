const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')
const { chineseText } = require('../../utils/display-text')
const { getWashLocation } = require('../../utils/location')
const { STORAGE_KEYS } = require('../../utils/config')
const { redemptionFeedback } = require('../../utils/redemption-feedback')

Page({
  data: {
    siteId: '', platform: '', platformName: '', siteName: '',
    redemptionCode: '', loading: true, submitting: false,
    entryVisible: false, canRedeem: false, notice: '', errorText: '', reviewRequired: false
  },

  onLoad(options) {
    this.mid = options.mid || ''
    this.locationConfirm = options.locationConfirm === '1'
    const platform = options.platform
    if (!options.siteId || ['meituan', 'douyin'].indexOf(platform) < 0) {
      this.setData({ loading: false, errorText: '核销入口无效，请返回重新选择' })
      return
    }
    const platformName = platform === 'meituan' ? '美团' : '抖音'
    this.setData({ siteId: options.siteId, platform, platformName })
    wx.setNavigationBarTitle({ title: `${platformName}核销` })
  },

  onShow() {
    if (this.data.siteId && !this.data.reviewRequired) this.loadEntry()
  },

  onUnload() { this.disposed = true },

  async loadEntry() {
    this.setData({ loading: true, entryVisible: false, errorText: '' })
    try {
      const result = await api.groupBuy.entries(this.data.siteId)
      if (this.disposed) return
      const entry = result && result[this.data.platform]
      this.setData({
        siteName: result && result.siteName || '当前洗车场地',
        entryVisible: !!(entry && entry.showButton === true),
        canRedeem: !!(entry && entry.canRedeem === true),
        notice: !entry || entry.canRedeem !== true ? chineseText(entry && entry.message, '平台核销服务暂不可用，未提交核销') : '',
        errorText: !entry || entry.showButton !== true ? chineseText(entry && entry.message, '该场地暂未开启此平台核销，请返回选择其他方式') : ''
      })
    } catch (err) {
      if (!this.disposed) this.setData({ entryVisible: false, canRedeem: false, errorText: chineseText(err.message, '入口加载失败，请重试') })
    } finally {
      if (!this.disposed) this.setData({ loading: false })
    }
  },

  inputCode(event) {
    this.setData({ redemptionCode: event.detail.value, errorText: '' })
  },

  async submitCode() {
    if (this.data.loading || this.data.submitting || this.data.reviewRequired || !this.data.entryVisible || !this.data.canRedeem) return
    if (!this.mid) return this.setData({ errorText: '请先扫码选定洗车机' })
    const redemptionCode = this.data.redemptionCode.trim()
    if (!redemptionCode || redemptionCode.length > 128) {
      this.setData({ errorText: !redemptionCode ? '请输入核销码' : '核销码不能超过128个字符' })
      return
    }
    this.setData({ submitting: true, errorText: '' })
    let submitted = false
    try {
      await ensureLogin()
      const location = await getWashLocation()
      const position = { lat: location.latitude, lng: location.longitude }
      submitted = true
      const order = await api.groupBuy.redeem({ siteId: this.data.siteId, platform: this.data.platform, redemptionCode,
        mid: this.mid, locationConfirm: this.locationConfirm, ...position })
      if (this.disposed) return
      if (order && order.redemptionType === 'site_credit') {
        this.setData({ redemptionCode: '', canRedeem: false })
        const amount = (Number(order.creditedAmountCent) / 100).toFixed(2)
        wx.showModal({
          title: '储值成功',
          content: `已到账 ${amount} 元，仅限本场地使用。请选择「储值」继续洗车。`,
          showCancel: false,
          confirmText: '返回洗车',
          success: () => {
            this.getOpenerEventChannel().emit('redeemed', order)
            wx.navigateBack()
          }
        })
        return
      }
      if (!order || !order.orderNo || order.orderStatus !== 'paid') throw new Error('未确认核销订单，请联系门店核实')
      wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, order.orderNo)
      this.setData({ redemptionCode: '', canRedeem: false, notice: '核销成功，正在启动原订单' })
      try { await api.wash.start(order.orderNo, { ...position, clientRequestId: `douyin-${Date.now()}` }) }
      catch (_) { wx.showToast({ title: '已核销，原订单可继续启动', icon: 'none' }) }
      wx.redirectTo({ url: `/pages/wash-ready/wash-ready?orderNo=${encodeURIComponent(order.orderNo)}` })
    } catch (err) {
      if (!this.disposed) {
        const feedback = redemptionFeedback(err, submitted)
        this.setData({
          errorText: feedback.message || chineseText(err.message, '暂时无法处理核销，请检查后再试'),
          ...(feedback.hold ? { reviewRequired: true, canRedeem: false, redemptionCode: '' } : {})
        })
      }
    } finally {
      if (!this.disposed) this.setData({ submitting: false })
    }
  },

  goToWashHome() { wx.switchTab({ url: '/pages/home/home' }) },
  back() { if (!this.data.submitting) wx.navigateBack() }
})
