const api = require('../../utils/api')
const { ensurePhoneBound } = require('../../utils/auth')
const { parsePromotionCode } = require('../../utils/format')
const { chineseText } = require('../../utils/display-text')

const STATUS_TEXT = {
  not_started: '活动尚未开始',
  expired: '活动已结束',
  disabled: '活动已停用',
  limit_reached: '活动名额已满'
}
const AUDIENCE = { all_users: '所有用户', new_user: '新用户', old_user: '老用户' }
const CLAIM_STATUS = {
  PROMOTION_NOT_STARTED: 'not_started',
  PROMOTION_EXPIRED: 'expired',
  PROMOTION_DISABLED: 'disabled',
  PROMOTION_LIMIT_REACHED: 'limit_reached'
}

function decode(value) {
  try { return decodeURIComponent(String(value || '')) } catch (_) { return '' }
}

function dateText(value) {
  return value ? String(value).replace('T', ' ').slice(0, 16) : ''
}

Page({
  data: {
    activity: null, loading: true, busy: false, error: '', statusText: '',
    canClaim: false, phoneAuthVisible: false, claimed: false, alreadyClaimed: false, validUntil: ''
  },

  onLoad(options = {}) {
    const directCode = decode(options.code || options.scene).trim()
    this.code = options.q
      ? parsePromotionCode(decode(options.q))
      : (/^[A-Za-z0-9_-]{1,64}$/.test(directCode) ? directCode : '')
    this.loadActivity()
  },

  onUnload() { this.disposed = true },

  async loadActivity() {
    if (!this.code) {
      this.setData({ loading: false, error: '推广二维码无效，请重新扫描' })
      return
    }
    this.setData({ loading: true, error: '', canClaim: false })
    try {
      const result = await api.promotions.detail(this.code)
      if (this.disposed) return
      if (!result || !result.siteId) throw new Error('未找到活动场地')
      const status = result.activityStatus || result.status
      this.setData({
        activity: {
          siteName: result.siteName || '活动场地',
          couponName: result.couponName || (result.couponMinutes ? `${result.couponMinutes}分钟洗车券` : '洗车券'),
          couponCount: result.couponCount || '',
          validity: result.validDaysText || (result.couponValidDays ? `${result.couponValidDays}天` : ''),
          audience: AUDIENCE[result.userType] || '',
          expiresAt: dateText(result.expiresAt)
        },
        canClaim: status === 'active',
        statusText: status === 'active' ? '' : STATUS_TEXT[status] || '活动暂不可领取'
      })
    } catch (err) {
      if (!this.disposed) this.setData({ error: chineseText(err.message, '活动加载失败，请重试') })
    } finally {
      if (!this.disposed) this.setData({ loading: false })
    }
  },

  async claim() {
    if (!this.data.canClaim || this.data.claimed || this.data.busy || this.data.phoneAuthVisible) return
    this.setData({ busy: true, error: '' })
    try {
      await ensurePhoneBound()
      if (this.disposed) return
      const result = await api.promotions.claim(this.code)
      if (!result || result.claimed !== true) throw new Error('未收到领券确认，请重试')
      if (!this.disposed) this.setData({ claimed: true, canClaim: false, validUntil: dateText(result.validUntil) })
    } catch (err) {
      if (this.disposed) return
      if (['AUTH_REQUIRED', 'UNAUTHORIZED', 'PHONE_REQUIRED', 'PHONE_VERIFICATION_REQUIRED'].includes(err.code)) {
        this.setData({ phoneAuthVisible: true })
      } else if (err.code === 'PROMOTION_ALREADY_CLAIMED') {
        this.setData({ claimed: true, canClaim: false, alreadyClaimed: true })
      } else if (CLAIM_STATUS[err.code]) {
        this.setData({ canClaim: false, statusText: STATUS_TEXT[CLAIM_STATUS[err.code]] })
      } else {
        this.setData({ error: chineseText(err.message, '领取失败，请稍后重试') })
      }
    } finally {
      if (!this.disposed) this.setData({ busy: false })
    }
  },

  onPhoneAuthSuccess() {
    this.setData({ phoneAuthVisible: false }, () => this.claim())
  },
  onPhoneAuthCancel() { this.setData({ phoneAuthVisible: false }) },
  startScan() {
    wx.redirectTo({
      url: '/pages/scan/scan',
      fail: () => wx.showToast({ title: '无法打开扫码页，请重试', icon: 'none' })
    })
  }
})
