const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')

function formatDate(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 10)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function itemsOf(data) {
  if (Array.isArray(data)) return data
  return (data && (data.items || data.records || data.list || data.content)) || []
}

Page({
  data: { coupons: [], loading: true, error: false, reviewMode: false },
  onLoad() { this.loadCoupons() },
  onPullDownRefresh() { this.loadCoupons().finally(() => wx.stopPullDownRefresh()) },
  loadCoupons() {
    this.setData({ loading: true, error: false })
    return ensureLogin().then(() => api.review.status()).then((status) => {
      this.setData({ reviewMode: status.reviewMode === true })
      return api.coupons.mine({ page: 0, size: 50 })
    })
      .then((data) => this.setData({ coupons: itemsOf(data).map((item) => ({
        id: item.couponId || item.id,
        name: item.name || '洗车券',
        detail: item.detailText || (item.minutes ? `${item.minutes}分钟洗车券` : '洗车抵扣券'),
        expire: formatDate(item.expireAt || item.validTo),
        status: String(item.status || 'active').toLowerCase(),
        statusText: ({ active: '可使用', available: '可使用', normal: '可使用', expired: '已过期', used: '已使用', frozen: '已冻结', disabled: '不可使用' })[String(item.status || 'active').toLowerCase()] || '状态待确认'
      })) }))
      .catch(() => this.setData({ error: true }))
      .finally(() => this.setData({ loading: false }))
  },
  retry() { this.loadCoupons() }
})
