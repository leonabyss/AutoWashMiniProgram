const { request, ensureLogin } = require('../../utils/request')

Page({
  data: { venueIndex: -1, venues: ['已有场地', '正在找场地', '尚未确定'], consent: false, submitting: false, submitted: false, error: '' },
  chooseVenue(e) { this.setData({ venueIndex: Number(e.detail.value) }) },
  changeConsent(e) { this.setData({ consent: e.detail.value.includes('contact') }) },
  async submit(e) {
    if (this.data.submitting || this.data.submitted) return
    const fields = e.detail.value
    const contactName = fields.contactName.trim()
    const phone = fields.phone.trim()
    const city = fields.city.trim()
    const venueStatus = ['available', 'looking', 'undecided'][this.data.venueIndex]
    if (!contactName || !/^1[3-9]\d{9}$/.test(phone) || !city || !venueStatus)
      return this.setData({ error: '请填写联系人、有效手机号、意向城市及场地情况。' })
    if (!this.data.consent) return this.setData({ error: '请先同意将信息用于加盟联系。' })
    const payload = { contactName, phone, city, venueStatus, note: fields.note.trim(), consent: true }
    const fingerprint = JSON.stringify(payload)
    if (this.fingerprint !== fingerprint) {
      this.fingerprint = fingerprint
      this.requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    this.setData({ submitting: true, error: '' })
    try {
      await ensureLogin()
      await request({ url: '/mini/franchise-leads', method: 'POST', data: { ...payload, requestId: this.requestId } })
      this.setData({ submitted: true })
    } catch (error) {
      this.setData({ error: error.message || '提交失败，请稍后重试。' })
    } finally {
      this.setData({ submitting: false })
    }
  },
  goMine() { wx.switchTab({ url: '/pages/mine/mine' }) }
})
