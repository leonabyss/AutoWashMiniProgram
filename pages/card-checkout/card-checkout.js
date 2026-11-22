const api = require('../../utils/api')
const { ensurePhoneBound } = require('../../utils/auth')
const { secToText } = require('../../utils/format')
const { purchaseRuleParts } = require('../../utils/card-purchase-rules')
const { requestPayment, getPayOrderNo, getPayment, isPaymentSuccess } = require('../../utils/payment')
const reviewPurchase = require('../../utils/review-purchase')

const categories = {
  monthly_member: { label: '包月会员', icon: 'lucide-crown-active.svg' },
  wash_card: { label: '洗车卡', icon: 'lucide-credit-card.svg' },
  single_card: { label: '次卡', icon: 'lucide-ticket-blue.svg' }
}

function present(product, site) {
  const category = categories[product.cardKind]
  if (!category || !product.name || product.priceCent == null || !Number.isSafeInteger(Number(product.priceCent)) || Number(product.priceCent) <= 0) throw new Error('商品支付信息不完整或售价无效，请返回重新选择')
  const lines = []
  const seconds = product.rightsDurationSec != null ? product.rightsDurationSec : product.totalDurationSec
  const days = product.validDays != null ? product.validDays : product.durationDays
  if (seconds != null) lines.push(`洗车额度${secToText(seconds)}`)
  if (days != null) lines.push(`有效期${days}天`)
  if (Number(product.giftCouponCount) > 0) lines.push(Number(product.giftCouponMinutes) > 0 ? `赠${product.giftCouponCount}张${product.giftCouponMinutes}分钟券` : `赠${product.giftCouponCount}张洗车券`)
  return { category, detailLines: lines, priceText: (Number(product.priceCent) / 100).toFixed(2),
    ruleParts: purchaseRuleParts(product.cardKind, site.purchaseRules, product.description) }
}

function signature(product, site) {
  return JSON.stringify([product.productId, product.skuId, product.name, product.cardKind, product.priceCent,
    product.rightsDurationSec, product.totalDurationSec, product.validDays, product.durationDays,
    product.faceValueCent, product.usageTimes, product.giftCouponCount, product.giftCouponMinutes,
    product.description, site.name, site.purchaseRules])
}

Page({
  data: { loading: true, errorText: '', product: null, site: null, category: {}, detailLines: [], ruleParts: [],
    priceText: '--', payingId: '', submitting: false, paid: false, pendingConfirmation: false, reviewMode: false, phoneAuthVisible: false },
  onLoad(options) {
    this.siteId = options.siteId
    this.productId = options.productId
    this.loadData()
  },
  onUnload() { this.disposed = true },
  async fetchData() {
    if (!this.siteId || !this.productId) throw new Error('缺少场地或商品信息，请返回重新选择')
    await ensurePhoneBound()
    const [result, site, review] = await Promise.all([
      api.member.products({ siteId: this.siteId, bizCategory: 'wash_rights' }), api.sites.detail(this.siteId), api.review.status()
    ])
    const list = Array.isArray(result) ? result : (result && result.items) || []
    const product = list.find((item) => String(item.productId) === String(this.productId) && (!item.status || item.status === 'enabled'))
    if (!product || !site || !site.name || String(site.siteId) !== String(this.siteId)) throw new Error('该场地套餐已不可购买，请返回重新选择')
    return { product, site, review, display: present(product, site) }
  },
  applyData(result) {
    this.snapshot = signature(result.product, result.site)
    if (!this.disposed) this.setData(Object.assign({ product: result.product, site: result.site, reviewMode: result.review.reviewMode === true }, result.display))
  },
  async loadData() {
    if (this.data.paid || this.paymentOrder) return
    this.setData({ loading: true, errorText: '' })
    try { this.applyData(await this.fetchData()) } catch (err) { this.handleError(err) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  handleError(err) {
    if (this.disposed) return
    if (['PHONE_REQUIRED', 'AUTH_REQUIRED', 'UNAUTHORIZED'].includes(err.code)) this.setData({ phoneAuthVisible: true })
    else this.setData({ errorText: err.message || '支付信息获取失败，请稍后重试' })
  },
  onPhoneAuthSuccess() { this.setData({ phoneAuthVisible: false }); this.loadData() },
  onPhoneAuthCancel() { this.setData({ phoneAuthVisible: false }); wx.navigateBack() },
  showNotice() {
    wx.showModal({ title: '购买须知', content: '付款前请核对办卡场地、套餐名称、权益及应付金额。支付及权益发放结果以后台订单记录为准。如遇支付结果未确认，请先查看订单中心，避免重复付款。', showCancel: false, confirmColor: '#1262e8' })
  },
  async confirmPay() {
    if (this.data.loading || this.data.submitting || this.data.paid || this.data.pendingConfirmation || !this.data.product) return
    this.setData({ submitting: true, payingId: this.productId, errorText: '' })
    try {
      if (!this.paymentOrder) {
        const result = await this.fetchData()
        if (this.disposed) return
        const changed = this.snapshot !== signature(result.product, result.site)
        this.applyData(result)
        if (changed) {
          wx.showModal({ title: '套餐信息已更新', content: '价格、权益或场地规则已变化，请核对最新信息后再次确认支付。', showCancel: false, confirmColor: '#1262e8' })
          return
        }
        if (result.review.reviewMode === true) {
          const receipt = await reviewPurchase.purchase(result.product, { siteName: result.site.name }, result.review)
          if (receipt && !this.disposed) this.setData({ paid: true })
          return
        }
        this.paymentOrder = await api.member.createOrder({ siteId: result.site.siteId, productId: result.product.productId,
          ...(result.product.skuId ? { skuId: result.product.skuId } : {}), payPlatform: 'wechat' })
      }
      const order = this.paymentOrder
      if (this.disposed) return
      const amount = order && order.orderAmountCent
      if (amount == null || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) {
        this.setData({ pendingConfirmation: true })
        throw new Error('未获取到有效订单金额，请在订单中心核对后再操作')
      }
      if (Number(amount) !== Number(this.data.product.priceCent)) {
        this.setData({ product: Object.assign({}, this.data.product, { priceCent: Number(amount) }), priceText: (Number(amount) / 100).toFixed(2) })
        wx.showModal({ title: '订单金额已更新', content: '后台订单金额与刚才展示的价格不同，请核对最新应付金额后再次确认。', showCancel: false, confirmColor: '#1262e8' })
        return
      }
      const payOrderNo = getPayOrderNo(order)
      if (!payOrderNo) {
        this.setData({ pendingConfirmation: true })
        throw new Error('未获取到支付单号，请先在订单中心核对订单，避免重复付款')
      }
      let confirmed
      if (order.wxPayParams) {
        const payment = await requestPayment(order.wxPayParams, order)
        confirmed = payment && payment.confirmPending === false && isPaymentSuccess(payment.confirmResult)
      } else confirmed = isPaymentSuccess(await getPayment(payOrderNo))
      if (!this.disposed) this.setData({ paid: !!confirmed, pendingConfirmation: !confirmed })
    } catch (err) {
      if (!/cancel/i.test(err.errMsg || '')) this.handleError(err)
    } finally {
      if (!this.disposed) this.setData({ submitting: false, payingId: '' })
    }
  },
  async checkPayment() {
    const number = getPayOrderNo(this.paymentOrder)
    if (!number || this.data.submitting) return
    this.setData({ submitting: true })
    try {
      const payment = await api.orders.confirmPayment(number)
      if (!this.disposed && isPaymentSuccess(payment) && payment.confirmed !== false) this.setData({ paid: true, pendingConfirmation: false, errorText: '' })
    } catch (err) { this.handleError(err) }
    finally { if (!this.disposed) this.setData({ submitting: false }) }
  },
  openOrders() { wx.navigateTo({ url: '/pages/recharge-records/recharge-records' }) },
  backToUse() {
    const pages = getCurrentPages()
    const index = pages.findIndex((page) => page.route === 'pages/wash-confirm/wash-confirm')
    wx.navigateBack({ delta: index >= 0 ? pages.length - 1 - index : 1 })
  }
})
