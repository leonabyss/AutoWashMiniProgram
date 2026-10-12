const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')
const { chineseText } = require('../../utils/display-text')

Page({
  data: {
    siteId: '', platform: '', platformName: '', siteName: '',
    redemptionCode: '', loading: true, submitting: false,
    entryVisible: false, canRedeem: false, notice: '', errorText: ''
  },

  onLoad(options) {
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
    if (this.data.siteId) this.loadEntry()
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
        notice: !entry || entry.canRedeem !== true ? chineseText(entry && entry.message, '平台核销服务暂不可用，提交结果以后台返回为准') : '',
        errorText: !entry || entry.showButton !== true ? '该场地暂未开启此平台核销，请返回选择其他方式' : ''
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
    if (this.data.loading || this.data.submitting || !this.data.entryVisible) return
    const redemptionCode = this.data.redemptionCode.trim()
    if (!redemptionCode || redemptionCode.length > 128) {
      this.setData({ errorText: !redemptionCode ? '请输入核销码' : '核销码不能超过128个字符' })
      return
    }
    this.setData({ submitting: true, errorText: '' })
    try {
      await ensureLogin()
      await api.groupBuy.redeem({ siteId: this.data.siteId, platform: this.data.platform, redemptionCode })
      if (this.disposed) return
      // An unavailable entry must never be presented as a redeemed voucher.
      if (!this.data.canRedeem) {
        this.setData({ errorText: this.data.notice || '平台核销尚未开放，暂不能确认核销成功' })
        return
      }
      const channel = this.getOpenerEventChannel()
      channel.emit('redeemed', { siteId: this.data.siteId, platform: this.data.platform })
      this.setData({ redemptionCode: '' })
      wx.navigateBack()
    } catch (err) {
      if (!this.disposed) this.setData({ errorText: chineseText(err.message, '核销未成功，请检查核销码后重试') })
    } finally {
      if (!this.disposed) this.setData({ submitting: false })
    }
  },

  back() { if (!this.data.submitting) wx.navigateBack() }
})
