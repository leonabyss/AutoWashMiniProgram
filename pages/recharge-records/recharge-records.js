const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')
const { centToYuan } = require('../../utils/format')

function formatDate(value) {
  if (!value) return '--'

  const raw = String(value)
  let date = new Date(raw)

  if (Number.isNaN(date.getTime())) {
    date = new Date(raw.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:?\d{2}|Z)$/i, '').replace(/-/g, '/'))
  }

  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16)

  const pad = (number) => String(number).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function bizTypeText(type) {
  const map = {
    recharge: '储值充值',
    recharge_order: '储值充值',
    wallet_recharge: '储值充值',
    wash_order: '洗车消费',
    refund: '退款',
    member_order: '购卡',
    product_order: '购卡'
  }

  return map[String(type || '').toLowerCase()] || type || '储值流水'
}

function normalizePage(pageData) {
  const fallback = { items: [], page: 0, totalPages: 1 }

  if (Array.isArray(pageData)) {
    return {
      items: pageData,
      page: 0,
      totalPages: 1
    }
  }

  const normalized = Object.assign({}, fallback, pageData || {})
  normalized.items = normalized.items || normalized.records || normalized.list || normalized.content || []

  return normalized
}

function paymentLooksLikeRecharge(item) {
  const text = [
    item && item.bizType,
    item && item.payPurpose,
    item && item.remark,
    item && item.productInfo
  ].filter(Boolean).join(' ').toLowerCase()

  return text.indexOf('recharge') >= 0 ||
    text.indexOf('wallet') >= 0 ||
    text.indexOf('充值') >= 0 ||
    text.indexOf('储值') >= 0
}

function normalizeWalletRecord(item) {
  const direction = String(item.direction || '').toLowerCase()
  const sign = direction === 'expense' ? '-' : '+'
  const key = item.transactionId || item.id || `${item.bizType || 'wallet'}-${item.createdAt || ''}-${item.amountCent || 0}`

  return {
    recordKey: `wallet-${key}`,
    title: item.remark || bizTypeText(item.bizType),
    bizTypeText: bizTypeText(item.bizType),
    amountText: `${sign}¥${centToYuan(item.amountCent)}`,
    balanceText: `余额 ¥${centToYuan(item.balanceAfterCent)}`,
    directionClass: direction === 'expense' ? 'expense' : 'income',
    createdAt: item.createdAt,
    createdAtText: formatDate(item.createdAt),
    statusText: ''
  }
}

function payStatusText(status) {
  const map = {
    success: '支付成功',
    paid: '支付成功',
    pending: '支付中',
    failed: '支付失败',
    closed: '已关闭',
    refunded: '已退款'
  }

  return map[String(status || '').toLowerCase()] || status || '支付记录'
}

function normalizePaymentRecord(item) {
  const paidAt = item.paidAt || item.createdAt || item.updatedAt

  return {
    recordKey: `payment-${item.payOrderNo || item.paymentOrderNo || item.bizOrderNo || paidAt}`,
    title: item.payPurpose || bizTypeText(item.bizType),
    bizTypeText: bizTypeText(item.bizType),
    amountText: `+¥${centToYuan(item.amountCent)}`,
    balanceText: item.bizOrderNo ? `订单 ${item.bizOrderNo}` : payStatusText(item.payStatus),
    directionClass: 'income',
    createdAt: paidAt,
    createdAtText: formatDate(paidAt),
    statusText: payStatusText(item.payStatus)
  }
}

function mergeRecords(...recordGroups) {
  const map = {}
  const merged = []

  recordGroups.reduce((list, group) => list.concat(group || []), []).forEach((record) => {
    if (!record) return

    const key = record.recordKey
    if (key && map[key]) return

    if (key) map[key] = true
    merged.push(record)
  })

  return merged.sort((a, b) => {
    const at = new Date(a.createdAt || 0).getTime() || 0
    const bt = new Date(b.createdAt || 0).getTime() || 0

    return bt - at
  })
}

function getTotalPages(...pages) {
  return Math.max.apply(null, pages.map((item) => Number(item && item.totalPages || 1)).concat([1]))
}

function getCurrentPage(fallbackPage, ...pages) {
  const page = pages
    .map((item) => Number(item && item.page))
    .find((value) => !Number.isNaN(value))

  return Number.isNaN(page) || page === undefined ? fallbackPage : page
}

function normalizePaymentPage(pageData) {
  const normalized = normalizePage(pageData)

  return Object.assign({}, normalized, {
    items: (normalized.items || []).filter(paymentLooksLikeRecharge)
  })
}

function getSummaryRechargeRecords(summary) {
  return (summary && summary.recentRechargeRecords) || []
}

Page({
  data: {
    records: [],
    page: 0,
    size: 20,
    totalPages: 1,
    loading: false,
    loadingMore: false,
    finished: false
  },

  onLoad() {
    this.loadRecords(true)
  },

  onPullDownRefresh() {
    this.loadRecords(true).finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (!this.data.finished && !this.data.loadingMore && !this.data.loading) {
      this.loadRecords(false)
    }
  },

  loadRecords(reset) {
    const page = reset ? 0 : this.data.page + 1

    this.setData(reset ? { loading: true } : { loadingMore: true })

    return ensureLogin()
      .then(() => Promise.all([
        api.users.summary().catch(() => null),
        api.wallet.transactions({ page, size: this.data.size }).catch(() => null),
        api.orders.payments({ page, size: this.data.size }).catch(() => null)
      ]))
      .then(([summary, walletPageData, paymentPageData]) => {
        const walletPage = normalizePage(walletPageData)
        const paymentPage = normalizePaymentPage(paymentPageData)
        const records = mergeRecords(
          getSummaryRechargeRecords(summary).map(normalizeWalletRecord),
          (walletPage.items || []).map(normalizeWalletRecord),
          (paymentPage.items || []).map(normalizePaymentRecord)
        )
        const nextRecords = reset ? records : this.data.records.concat(records)
        const totalPages = getTotalPages(walletPage, paymentPage)
        const currentPage = getCurrentPage(page, walletPage, paymentPage)

        this.setData({
          records: nextRecords,
          page: currentPage,
          totalPages,
          finished: currentPage + 1 >= totalPages
        })
      })
      .catch((err) => {
        wx.showToast({
          title: err.message || '充值记录加载失败',
          icon: 'none'
        })
      })
      .finally(() => {
        this.setData({
          loading: false,
          loadingMore: false
        })
      })
  }
})
