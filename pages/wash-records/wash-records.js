const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')
const { centToYuan, secToText } = require('../../utils/format')
const { history: reviewHistory } = require('../../utils/review-account')

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

function statusText(status) {
  const map = {
    created: '待支付',
    paid: '已支付',
    starting: '启动中',
    running: '进行中',
    runing: '进行中',
    stopping: '结束中',
    finished: '已完成',
    failed: '失败',
    cancelled: '已取消',
    canceled: '已取消'
  }

  return map[String(status || '').toLowerCase()] || '状态待确认'
}

function payMethodText(method) {
  const map = {
    wechat: '微信支付',
    wallet: '余额支付',
    member_card: '会员卡',
    coupon: '洗车券',
    review_wallet: '虚拟体验余额'
  }

  return map[String(method || '').toLowerCase()] || '结算方式待确认'
}

function normalizePage(pageData) {
  if (Array.isArray(pageData)) {
    return {
      items: pageData,
      page: 0,
      totalPages: 1
    }
  }

  return Object.assign({ items: [], page: 0, totalPages: 1 }, pageData || {})
}

function normalizeOrder(item) {
  const washStatus = item.washStatus || item.orderStatus
  const durationSec = Number(item.washDurationSec || item.machineStartSec || item.usedDurationSec || 0)

  return {
    orderNo: item.orderNo,
    siteName: item.siteName || '洗车点',
    machineName: item.machineName || '--',
    amountText: `¥${centToYuan(item.amountUsedCent)}`,
    durationText: durationSec ? secToText(durationSec) : '--',
    statusText: statusText(washStatus),
    statusClass: String(washStatus || '').toLowerCase(),
    payMethodText: payMethodText(item.payMethod),
    createdAtText: formatDate(item.createdAt),
    finishedAtText: formatDate(item.finishedAt)
  }
}

Page({
  data: {
    reviewMode: false,
    reviewStale: false,
    loadError: false,
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

    this.setData(reset ? { loading: true, loadError: false } : { loadingMore: true, loadError: false })

    return ensureLogin()
      .then(() => api.review.status())
      .then(async (status) => {
        if (this.data.reviewMode !== (status.reviewMode === true)) this.setData({ records: [] })
        this.setData({ reviewMode: status.reviewMode === true, reviewStale: false })
        if (!status.reviewMode) return api.wash.list({ page, size: this.data.size })
        const result = await reviewHistory(status)
        this.setData({ reviewStale: result.stale })
        return { items: result.items, page: 0, totalPages: 1 }
      })
      .then((pageData) => {
        const normalized = normalizePage(pageData)
        const records = (normalized.items || []).map(normalizeOrder)
        const nextRecords = reset || this.data.reviewMode ? records : this.data.records.concat(records)
        const totalPages = Number(normalized.totalPages || 1)

        this.setData({
          records: nextRecords,
          page: Number(normalized.page == null ? page : normalized.page),
          totalPages,
          finished: Number(normalized.page == null ? page : normalized.page) + 1 >= totalPages
        })
      })
      .catch((err) => {
        this.setData({ loadError: true })
        wx.showToast({
          title: err.message || '洗车记录加载失败',
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
