const api = require('../../utils/api')
const { centToYuan, secToText } = require('../../utils/format')
const createBuyCardPage = require('../buy-card/buy-card-controller')
const { purchaseRuleParts } = require('../../utils/card-purchase-rules')

const types = [
  { key: 'monthly_member', title: '包月会员', icon: 'lucide-crown-active.svg' },
  { key: 'wash_card', title: '洗车卡', icon: 'lucide-credit-card.svg' },
  { key: 'single_card', title: '次卡', icon: 'lucide-ticket-blue.svg' }
]

function valuePresent(value) {
  return value !== null && value !== undefined && value !== ''
}

function productView(item) {
  const seconds = item.rightsDurationSec != null ? item.rightsDurationSec : item.totalDurationSec
  const days = item.validDays != null ? item.validDays : item.durationDays
  const lines = []
  if (valuePresent(seconds)) lines.push(`洗车额度${secToText(seconds)}`)
  if (valuePresent(days)) lines.push(`有效期${days}天`)
  const priceValid = valuePresent(item.priceCent) && Number.isFinite(Number(item.priceCent)) && Number(item.priceCent) >= 0
  return Object.assign({}, item, {
    payKey: `${item.cardKind}-${item.productId}`,
    displayPrice: priceValid ? centToYuan(item.priceCent) : '--',
    priceValid,
    detailLines: lines,
    rightsText: lines.join(' · '),
    badgeText: item.badgeText || item.promotionText || item.cornerText || (Number(item.giftCouponCount) > 0 ? `赠${item.giftCouponCount}张券` : ''),
    badgeImageUrl: item.badgeImageUrl || item.promotionBadgeImageUrl || '',
    unavailable: !priceValid || !item.productId || !item.name
  })
}

Page(createBuyCardPage({
  data: { sections: [], selectedProduct: null, productError: '', rulesText: '' },

  onLoad(options) {
    this.entrySiteId = options && options.siteId
    this.guardAccess()
  },

  onShow() {
    if (this.data.selectedPaymentSite && !this.data.loading) {
      this.loadSiteProducts(this.data.selectedPaymentSite, { silent: true })
    }
  },

  loadSiteProducts(site, options = {}) {
    const silent = options.silent === true && String(this.displayedSiteId) === String(site.siteId) && this.data.sections.length > 0
    const version = this.productRequestId = (this.productRequestId || 0) + 1
    if (!silent) this.setData({ loading: true, selectedProduct: null, sections: [], productError: '', rulesText: '',
      memberProducts: [], cardProducts: [], singleProducts: [] })
    return Promise.all([
      api.member.products({ siteId: site.siteId, bizCategory: 'wash_rights' }),
      api.sites.detail(site.siteId).catch(() => null)
    ]).then(([result, detail]) => {
      if (version !== this.productRequestId || String(site.siteId) !== String((this.data.selectedPaymentSite || {}).siteId)) return
      const list = Array.isArray(result) ? result : ((result && result.items) || [])
      const products = list.filter((item) => !item.status || item.status === 'enabled').map(productView)
      const rules = (detail && detail.purchaseRules) || {}
      const sections = types.map((type) => {
        const items = products.filter((item) => item.cardKind === type.key)
        const descriptions = Array.from(new Set(items.map((item) => item.description).filter(Boolean)))
        const ruleParts = purchaseRuleParts(type.key, rules, descriptions.join('\n'))
        const count = items.length
        const columns = count <= 4 ? 2 : 3
        const lastRowCount = count % columns
        return Object.assign({}, type, { products: items, ruleParts, columns,
          splitLastRow: columns === 3 && lastRowCount === 2 })
      })
      const selectedKey = this.data.selectedProduct && this.data.selectedProduct.payKey
      const nextData = { sections,
        selectedProduct: products.find((item) => item.payKey === selectedKey && !item.unavailable) || null,
        productError: '',
        memberProducts: products.filter((item) => item.cardKind === 'monthly_member'),
        cardProducts: products.filter((item) => item.cardKind === 'wash_card'),
        singleProducts: products.filter((item) => item.cardKind === 'single_card'),
        rulesText: sections.map((section) => `${section.title}\n${section.ruleParts.map((part) => part.text).join('')}`).join('\n\n')
      }
      this.displayedSiteId = site.siteId
      const changed = {}
      Object.keys(nextData).forEach((key) => {
        if (JSON.stringify(this.data[key]) !== JSON.stringify(nextData[key])) changed[key] = nextData[key]
      })
      if (Object.keys(changed).length) this.setData(changed)
    }).catch((err) => {
      if (version === this.productRequestId) {
        if (silent) wx.showToast({ title: '套餐更新失败，已保留当前内容', icon: 'none' })
        else this.setData({ productError: err.message || '套餐加载失败，请重试' })
      }
    }).finally(() => {
      if (!silent && version === this.productRequestId) this.setData({ loading: false })
    })
  },

  selectProduct(event) {
    if (this.data.payingId || this.data.loading) return
    const key = event.currentTarget.dataset.key
    const product = this.data.memberProducts.concat(this.data.cardProducts, this.data.singleProducts).find((item) => item.payKey === key)
    if (product && !product.unavailable) this.setData({ selectedProduct: product })
  },

  confirmPurchase() {
    const product = this.data.selectedProduct
    if (!product || product.unavailable || this.data.loading || this.data.payingId) return
    const site = this.data.selectedPaymentSite
    if (!site || !site.siteId) return
    wx.navigateTo({ url: `/pages/card-checkout/card-checkout?siteId=${encodeURIComponent(site.siteId)}&productId=${encodeURIComponent(product.productId)}` })
  },

  retryProducts() {
    if (this.data.selectedPaymentSite) this.loadSiteProducts(this.data.selectedPaymentSite)
    else this.loadProducts()
  },

  toggleDetails() {
    this.setData({ rulesExpanded: !this.data.rulesExpanded })
  }
}))
