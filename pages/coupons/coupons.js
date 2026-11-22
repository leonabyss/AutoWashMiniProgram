const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')

function formatDate(value) {
  if (!value) return '--'
  const millis = expiryTime(value)
  const date = new Date(millis === null || millis === -1 ? NaN : millis + 8 * 3600000)
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 10)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function itemsOf(data) {
  if (Array.isArray(data)) return data
  return (data && (data.items || data.records || data.list || data.content)) || []
}

function expiryTime(value) {
  if (!value) return null
  let text = String(value).replace(' ', 'T')
  // 服务端无时区的时间是北京时间；显式时区也避免iOS和手机所在地造成解析差异。
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)) text += '+08:00'
  const time = new Date(text).getTime()
  return Number.isNaN(time) ? -1 : time
}

function displayStatus(status, expiry) {
  if (['available', 'active', 'normal'].indexOf(status) < 0) return status
  if (expiry === -1) return 'disabled'
  return expiry !== null && expiry <= Date.now() ? 'expired' : status
}

Page({
  data: { coupons: [], loading: true, error: false, reviewMode: false },
  onLoad() { this.visible = true; this.loadCoupons() },
  onShow() { this.visible = true; if (this.loaded) this.loadCoupons() },
  onHide() { this.visible = false; clearTimeout(this.expiryTimer) },
  onUnload() { this.visible = false; clearTimeout(this.expiryTimer); this.requestId = (this.requestId || 0) + 1 },
  onPullDownRefresh() { this.loadCoupons().finally(() => wx.stopPullDownRefresh()) },
  loadCoupons() {
    const requestId = (this.requestId || 0) + 1
    this.requestId = requestId
    this.setData({ loading: true, error: false })
    return ensureLogin().then(() => api.review.status()).then((status) => {
      this.setData({ reviewMode: status.reviewMode === true })
      return api.coupons.mine({ status: 'all', page: 0, size: 50 })
    })
      .then((data) => {
        if (requestId !== this.requestId) return
        this.loaded = true
        this.setData({ coupons: itemsOf(data).map((item) => ({
        id: item.couponId || item.id,
        name: item.name || '洗车券',
        detail: item.detailText || (item.minutes ? `${item.minutes}分钟洗车券` : '洗车抵扣券'),
        expire: formatDate(item.expireAt || item.validTo),
        expiryTime: expiryTime(item.expireAt || item.validTo),
        status: String(item.status || 'unknown').toLowerCase()
      })) }, () => this.refreshExpiry())
      })
      .catch(() => { if (requestId === this.requestId) this.setData({ coupons: [], error: true }) })
      .finally(() => { if (requestId === this.requestId) this.setData({ loading: false }) })
  },
  refreshExpiry() {
    clearTimeout(this.expiryTimer)
    const coupons = this.data.coupons.map((item) => {
      const status = displayStatus(item.status, item.expiryTime)
      return Object.assign({}, item, { status, statusText: ({ active: '可使用', available: '可使用', normal: '可使用', expired: '已过期', used: '已使用', frozen: '已冻结', disabled: '不可使用', canceled: '已撤回' })[status] || '状态待确认' })
    })
    this.setData({ coupons })
    const future = coupons.filter((c) => ['available', 'active', 'normal'].indexOf(c.status) >= 0 && c.expiryTime !== null && c.expiryTime > Date.now()).map((c) => c.expiryTime - Date.now())
    if (this.visible && future.length) this.expiryTimer = setTimeout(() => this.refreshExpiry(), Math.min(2147483647, Math.max(10, Math.min(...future) + 10)))
  },
  retry() { this.loadCoupons() }
})
