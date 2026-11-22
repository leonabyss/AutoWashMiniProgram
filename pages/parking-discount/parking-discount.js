const { request, ensureLogin } = require('../../utils/request')

Page({
  data: { orderNo: '', loading: false, submitting: false, canClaim: false, statusText: '', message: '', couponName: '', validTo: '', qrPath: '', error: '' },
  onLoad(options) { this.setData({ orderNo: options.orderNo || '' }) },
  onShow() { this.load() },
  onHide() { this.clearExpiryTimer() },
  onUnload() { this.disposed = true; this.clearExpiryTimer(); this.removeQr() },
  clearExpiryTimer() { if (this.expiryTimer) clearTimeout(this.expiryTimer); this.expiryTimer = null },
  removeQr() {
    if (this.qrFile) wx.getFileSystemManager().unlink({ filePath: this.qrFile, fail() {} })
    this.qrFile = ''
  },
  endpoint() { return '/mini/wash/orders/' + encodeURIComponent(this.data.orderNo) + '/parking-discount' },
  load() {
    if (!this.data.orderNo) { this.setData({ error: '请从洗车订单进入停车优惠' }); return }
    if (this.data.loading || this.data.submitting) return
    this.setData({ loading: true, error: '' })
    ensureLogin().then(() => request({ url: this.endpoint() })).then(data => this.display(data))
      .catch(error => { if (!this.disposed) { this.removeQr(); this.setData({ qrPath: '', canClaim: false, error: error.message || '停车优惠读取失败，请稍后重试' }) } })
      .finally(() => { if (!this.disposed) this.setData({ loading: false }) })
  },
  display(data) {
    if (this.disposed) return
    this.clearExpiryTimer()
    this.removeQr()
    this.setData({ canClaim: !!data.canClaim, statusText: data.statusText, message: data.message, couponName: data.couponName || '', validTo: (data.validTo || '').replace('T', ' '), qrPath: '', error: '' })
    if (!data.qrPngBase64) return
    const filePath = wx.env.USER_DATA_PATH + '/parking-' + Date.now() + '.png'
    this.qrFile = filePath
    wx.getFileSystemManager().writeFile({ filePath, data: data.qrPngBase64, encoding: 'base64',
      success: () => { if (!this.disposed && this.qrFile === filePath) this.setData({ qrPath: filePath }) },
      fail: () => { if (!this.disposed) this.setData({ error: '优惠二维码显示失败，请重新加载' }) }
    })
    // Parse the local ISO timestamp explicitly for iOS, and hide the voucher at expiry.
    const parts = String(data.validTo || '').match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/)
    if (parts) {
      const expires = new Date(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], +parts[6]).getTime()
      this.expiryTimer = setTimeout(() => { this.removeQr(); this.setData({ qrPath: '', statusText: '请刷新核对有效期' }); this.load() }, Math.max(500, Math.min(expires - Date.now(), 2147483000)))
    }
  },
  claim() {
    if (this.data.submitting || !this.data.canClaim) return
    wx.showModal({ title: '领取停车优惠', content: '每笔洗车订单仅可领取一次，请在离场前领取并向停车场出示二维码。是否领取？',
      success: result => { if (result.confirm) this.submitClaim() }
    })
  },
  submitClaim() {
    if (this.data.submitting) return
    this.setData({ submitting: true, error: '', canClaim: false })
    ensureLogin().then(() => request({ url: this.endpoint(), method: 'POST' })).then(data => this.display(data))
      .catch(error => {
        if (!this.disposed) this.setData({ error: error.message || '领取结果未确认，请刷新查看，勿重复领取' })
      }).finally(() => { if (!this.disposed) { this.setData({ submitting: false }); this.load() } })
  }
})
