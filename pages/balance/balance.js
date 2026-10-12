const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')
const { centToYuan } = require('../../utils/format')
const { history: reviewHistory } = require('../../utils/review-account')

function formatDate(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizePage(data) {
  if (Array.isArray(data)) return data
  return (data && (data.items || data.records || data.list || data.content)) || []
}

function normalizeRecord(item) {
  const expense = String(item.direction || '').toLowerCase() === 'expense'
  return {
    id: item.transactionId || item.id || `${item.createdAt}-${item.amountCent}`,
    title: item.remark || (expense ? '洗车消费' : '余额充值'),
    amount: `${expense ? '-' : '+'}¥${centToYuan(item.amountCent)}`,
    amountClass: expense ? 'expense' : 'income',
    balance: item.balanceAfterCent == null ? '' : `余额 ¥${centToYuan(item.balanceAfterCent)}`,
    time: formatDate(item.createdAt)
  }
}

Page({
  data: { balance: '--', records: [], loading: true, error: false, reviewMode: false, reviewStale: false },
  onLoad() { this.loadData() },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()) },
  loadData() {
    this.setData({ loading: true, error: false })
    return ensureLogin()
      .then(() => api.review.status())
      .then(async (status) => {
        if (this.data.reviewMode !== (status.reviewMode === true)) this.setData({ records: [], balance: '--' })
        this.setData({ reviewMode: status.reviewMode === true, reviewStale: false })
        if (!status.reviewMode) return Promise.all([api.wallet.get(), api.wallet.transactions({ page: 0, size: 10 })])
        const records = await reviewHistory(status)
        const latest = await api.review.status()
        this.setData({ reviewStale: records.stale })
        return [{ balanceCent: latest.balanceCent }, { items: records.items.filter((order) => order.washStatus === 'finished').map((order) => ({
          transactionId: order.orderNo, direction: 'expense', remark: '模拟洗车结算',
          amountCent: order.amountCent, createdAt: order.finishedAt
        })) }]
      })
      .then(([wallet, page]) => this.setData({
        balance: centToYuan(wallet && wallet.balanceCent),
        records: normalizePage(page).slice(0, 10).map(normalizeRecord)
      }))
      .catch(() => this.setData({ error: true }))
      .finally(() => this.setData({ loading: false }))
  },
  recharge() {
    wx.navigateTo({ url: '/pages/buy-card/buy-card?category=wash-card' })
  },
  retry() { this.loadData() }
})
