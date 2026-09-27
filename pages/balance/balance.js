const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')
const { centToYuan } = require('../../utils/format')

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
    balance: `余额 ¥${centToYuan(item.balanceAfterCent)}`,
    time: formatDate(item.createdAt)
  }
}

Page({
  data: { balance: '--', records: [], loading: true, error: false },
  onLoad() { this.loadData() },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()) },
  loadData() {
    this.setData({ loading: true, error: false })
    return ensureLogin()
      .then(() => Promise.all([api.wallet.get(), api.wallet.transactions({ page: 0, size: 10 })]))
      .then(([wallet, page]) => this.setData({
        balance: centToYuan(wallet && wallet.balanceCent),
        records: normalizePage(page).slice(0, 10).map(normalizeRecord)
      }))
      .catch(() => this.setData({ error: true }))
      .finally(() => this.setData({ loading: false }))
  },
  recharge() { wx.navigateTo({ url: '/pages/buy-card/buy-card' }) },
  retry() { this.loadData() }
})
