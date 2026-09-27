const api = require('../../utils/api')
const { STORAGE_KEYS } = require('../../utils/config')

Page({
  data: {
    message: null
  },

  onLoad(options) {
    const messageId = options && options.messageId
    const message = wx.getStorageSync(STORAGE_KEYS.currentMessage)

    if (!message || String(message.messageId || message.id) !== String(messageId || '')) {
      wx.showToast({ title: '信息不存在', icon: 'none' })
      return
    }

    this.setData({ message })
    api.messages.read(messageId).catch(() => {})
  },

  viewCoupons() {
    wx.navigateTo({ url: '/pages/coupons/coupons' })
  }
})
