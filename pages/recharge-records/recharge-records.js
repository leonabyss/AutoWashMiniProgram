const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')
const { centToYuan } = require('../../utils/format')
const { history: reviewHistory } = require('../../utils/review-account')
const reviewPurchase = require('../../utils/review-purchase')

const categories = [
  { key: 'payments', title: '支付记录', desc: '充值、购卡及其他业务支付', icon: '/assets/icons/lucide-wallet-orange.png' },
  { key: 'products', title: '购卡订单', desc: '会员卡、洗车卡等商品订单', icon: '/assets/icons/lucide-credit-card.png' },
  { key: 'wash', title: '洗车订单', desc: '所有结算方式的洗车订单', icon: '/assets/icons/lucide-droplets-blue.png' },
  { key: 'wallet', title: '余额明细', desc: '充值入账、消费及退款流水', icon: '/assets/icons/lucide-ticket-blue.png' }
]

function dateText(value) {
  if (!value) return '--'
  return String(value).replace('T', ' ').slice(0, 19)
}

function statusText(value) {
  const states = {
    created: '已创建', pending: '待支付', pending_pay: '待支付', unpaid: '待支付',
    paying: '支付中', success: '支付成功', paid: '已支付', using: '使用中',
    starting: '准备洗车', running: '洗车中', runing: '洗车中', paused: '已暂停',
    stopping: '结束中', finished: '已完成', completed: '已完成', failed: '失败',
    closed: '已关闭', cancelled: '已取消', canceled: '已取消',
    refunding: '退款中', refunded: '已退款', partial_refunded: '部分退款',
    partially_refunded: '部分退款', expired: '已过期'
  }
  return states[String(value || '').toLowerCase()] || '状态待确认'
}

function businessText(value) {
  const types = {
    recharge: '余额充值', recharge_order: '余额充值', wallet_recharge: '余额充值',
    wash_order: '洗车订单', member_order: '购卡订单', product_order: '商品订单',
    glass_water_order: '玻璃水订单', foam_brush_order: '泡沫刷订单', refund: '退款'
  }
  return types[String(value || '').toLowerCase()] || '支付订单'
}

function normalize(item, category) {
  const payment = category === 'payments'
  const wallet = category === 'wallet'
  const wash = category === 'wash'
  const orderNo = item.payOrderNo || item.orderNo || item.transactionId || item.id || ''
  const amount = wash ? item.amountUsedCent : (category === 'products' ? item.orderAmountCent : item.amountCent)
  const direction = String(item.direction || '').toLowerCase()
  const record = {
    recordKey: `${category}-${orderNo || `${item.createdAt}-${amount}`}`,
    title: wash ? (item.siteName || '洗车订单') : (item.productInfo || item.remark || businessText(item.bizType)),
    amountText: amount == null ? '金额待确认' : `${wallet ? (direction === 'expense' ? '-' : '+') : ''}¥${centToYuan(amount)}`,
    statusText: wallet ? (direction === 'expense' ? '支出' : '入账') : statusText(payment ? item.payStatus : (item.washStatus || item.orderStatus)),
    rows: [{ label: wallet ? '流水号' : '订单号', value: String(orderNo || '--') },
      { label: '创建时间', value: dateText(item.createdAt || item.paidAt) }]
  }
  if (payment && item.bizOrderNo) record.rows.push({ label: '业务订单号', value: item.bizOrderNo })
  if (payment && item.paidAt) record.rows.push({ label: '支付时间', value: dateText(item.paidAt) })
  if (Number(item.refundAmountCent) > 0) record.rows.push({ label: '退款金额', value: `¥${centToYuan(item.refundAmountCent)}` })
  if (wallet && item.balanceAfterCent != null) record.rows.push({ label: '变动后余额', value: `¥${centToYuan(item.balanceAfterCent)}` })
  if (wash && item.machineName) record.rows.push({ label: '洗车设备', value: item.machineName })
  if (wash && item.finishedAt) record.rows.push({ label: '完成时间', value: dateText(item.finishedAt) })
  return record
}

function previewRecord(item) {
  return {
    recordKey: item.id, title: `模拟${item.kind === 'recharge' ? '充值' : '购卡'}：${item.name}`,
    amountText: `¥${centToYuan(item.priceCent)}`, statusText: '本机模拟完成',
    rows: [{ label: '记录时间', value: dateText(item.createdAt) },
      { label: '办卡场地', value: item.siteName }, { label: '说明', value: '未实际扣款、入账或发卡' }]
  }
}

Page({
  data: { categories, isDetail: false, activeCategory: 'payments', activeTitle: '支付记录', reviewMode: false,
    records: [], page: 0, size: 20, loading: false, loadingMore: false, finished: false,
    loadError: false, reviewStale: false },
  onLoad(options) {
    const category = categories.find((item) => item.key === (options && options.category))
    if (!category) return
    this.setData({ isDetail: true, activeCategory: category.key, activeTitle: category.title })
    wx.setNavigationBarTitle({ title: category.title })
  },
  onShow() {
    if (this.data.isDetail) {
      this.loadRecords(true)
      return
    }
    this.refreshMode()
  },
  refreshMode() {
    return ensureLogin().then(() => api.review.status())
      .then((status) => this.setData({ reviewMode: status.reviewMode === true }))
      .catch(() => {})
  },
  onUnload() { this.requestId = (this.requestId || 0) + 1 },
  onPullDownRefresh() {
    const refresh = this.data.isDetail ? this.loadRecords(true) : this.refreshMode()
    refresh.finally(() => wx.stopPullDownRefresh())
  },
  onReachBottom() {
    if (this.data.isDetail && !this.data.finished && !this.data.loading && !this.data.loadingMore) this.loadRecords(false)
  },
  selectCategory(event) {
    const category = categories.find((item) => item.key === event.currentTarget.dataset.key)
    if (!category) return
    wx.navigateTo({ url: `/pages/recharge-records/recharge-records?category=${category.key}` })
  },
  retry() { this.loadRecords(this.data.records.length === 0) },
  async reviewRecords(status, category) {
    if (category === 'payments') return reviewPurchase.records().map(previewRecord)
    if (category === 'products') return reviewPurchase.records().map(previewRecord)
    const history = await reviewHistory(status)
    this.reviewHistoryStale = history.stale
    if (category === 'wash') return history.items.map((item) => normalize(item, 'wash'))
    return history.items.filter((item) => item.washStatus === 'finished').map((item) => normalize({
      transactionId: item.orderNo, direction: 'expense', remark: '模拟洗车结算',
      amountCent: item.amountCent, createdAt: item.finishedAt
    }, 'wallet'))
  },
  loadRecords(reset) {
    const requestId = this.requestId = (this.requestId || 0) + 1
    const category = this.data.activeCategory
    const page = reset ? 0 : this.data.page + 1
    this.setData(reset ? { records: [], loading: true, loadingMore: false, finished: false, loadError: false }
      : { loadingMore: true, loadError: false })
    return ensureLogin().then(() => api.review.status()).then(async (status) => {
      if (requestId !== this.requestId) return null
      this.setData({ reviewMode: status.reviewMode === true, reviewStale: false })
      if (status.reviewMode) {
        this.reviewHistoryStale = false
        const items = await this.reviewRecords(status, category)
        return { items, page: 0, totalPages: 1, normalized: true, stale: this.reviewHistoryStale }
      }
      const params = { page, size: this.data.size }
      const loaders = { payments: () => api.orders.payments(params), products: () => api.orders.productOrders(params),
        wash: () => api.wash.list(params), wallet: () => api.wallet.transactions(params) }
      return loaders[category]()
    }).then((result) => {
      if (!result || requestId !== this.requestId) return
      const list = Array.isArray(result) ? result : (result.items || result.records || result.content || [])
      const records = result.normalized ? list : list.map((item) => normalize(item, category))
      const currentPage = Number(result.page == null ? page : result.page)
      const finished = Array.isArray(result) || (result.totalPages != null
        ? currentPage + 1 >= Number(result.totalPages) : list.length < this.data.size)
      const combined = reset ? records : this.data.records.concat(records)
      const seen = new Set()
      this.setData({ records: combined.filter((item) => {
        if (seen.has(item.recordKey)) return false
        seen.add(item.recordKey)
        return true
      }), page: currentPage, finished, reviewStale: !!result.stale })
    }).catch(() => {
      if (requestId === this.requestId) this.setData({ loadError: true })
    }).finally(() => {
      if (requestId === this.requestId) this.setData({ loading: false, loadingMore: false })
    })
  }
})
