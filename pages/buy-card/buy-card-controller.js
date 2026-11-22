const api = require('../../utils/api')
const { ensurePhoneBound } = require('../../utils/auth')
const { IMAGE_BASE_URL, STORAGE_KEYS } = require('../../utils/config')
const { centToYuan } = require('../../utils/format')
const { requestPayment, getPayment, getPayOrderNo, isPaymentSuccess } = require('../../utils/payment')
const reviewPurchase = require('../../utils/review-purchase')

function getCouponTotal(coupons) {
  if (!coupons) return 0
  if (typeof coupons.total === 'number') return coupons.total

  return (coupons.items || []).length
}

function getCouponCount(summary, coupons) {
  const summaryCoupons = summary && summary.coupons
  if (summaryCoupons && summaryCoupons.availableCount !== undefined) {
    return Number(summaryCoupons.availableCount || 0)
  }
  return getCouponTotal(coupons)
}

function isVipCard(card) {
  const text = productText(card)
  return getCardKind(card) === 'monthly_member' || text.indexOf('member') >= 0 || text.indexOf('会员') >= 0 || text.indexOf('月卡') >= 0 || text.indexOf('季卡') >= 0 || text.indexOf('年卡') >= 0
}

function isActiveCard(card) {
  const status = String((card && card.status) || '').toLowerCase()
  return card && card.canUse !== false && ['active', 'enabled', 'normal', 'available'].indexOf(status) >= 0
}

function getCrownState(cards) {
  const activeCard = (cards || []).filter(isVipCard).find(isActiveCard)
  if (!activeCard) return 'expired'
  if (!activeCard.validTo) return 'active'

  const expireAt = new Date(activeCard.validTo).getTime()
  if (!expireAt) return 'active'
  const remainingDays = Math.ceil((expireAt - Date.now()) / 86400000)
  return remainingDays <= 7 ? 'expiring' : 'active'
}

function normalizePaymentSite(item) {
  const siteName = item.siteName || item.name || '洗车场地'
  const cityName = item.cityName || ''
  const districtName = item.districtName || ''
  const address = item.address || ''

  return Object.assign({}, item, {
    siteId: item.siteId || item.id,
    siteName,
    cityName,
    districtName,
    regionText: [cityName, districtName].filter(Boolean).join(' '),
    optionText: [siteName, cityName || address].filter(Boolean).join(' · ')
  })
}

function getPageItems(result) {
  if (Array.isArray(result)) return result
  return (result && Array.isArray(result.items)) ? result.items : []
}

function siteMatchesKeyword(site, keyword) {
  const value = String(keyword || '').trim().toLowerCase()
  if (!value) return true

  return [site.siteName, site.name, site.address, site.cityName, site.districtName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .indexOf(value) >= 0
}

function getRecentSiteId(summary) {
  const latest = summary && summary.recentWashOrders && summary.recentWashOrders[0]
  return latest && (latest.siteId || latest.serviceSiteId)
}

function durationToMinutes(sec) {
  return Math.round(Number(sec || 0) / 60)
}

function durationDaysToText(days) {
  const value = Number(days || 0)

  if (!value) return '有效期以后台配置为准'
  if (value % 30 === 0) return `卡有效期${value / 30}个月`

  return `卡有效期${value}天`
}

function getCardKind(item) {
  return String((item && item.cardKind) || '').toLowerCase()
}

function productText(item) {
  return [
    item && item.productId,
    item && item.productTypeCode,
    item && item.name,
    item && item.cardKind
  ].filter(Boolean).join(' ').toLowerCase()
}


function formatMemberProduct(product) {
  return Object.assign({}, product, {
    name: product.name,
    rightsText: product.rightsText,
    displayPrice: product.price,
    category: 'member',
    artSrc: `${IMAGE_BASE_URL}/card-bg-monthly.jpg`,
    badgeText: product.badgeText || product.promotionText || product.cornerText || '',
    badgeImageUrl: product.badgeImageUrl || product.promotionBadgeImageUrl || ''
  })
}

function formatCardProduct(product) {
  return Object.assign({}, product, {
    name: product.name,
    validityText: product.validityText,
    displayPrice: product.amount,
    rightsText: `到账${centToYuan(product.faceValueCent)}元 · ${product.validityText}`,
    category: 'wash-card',
    artSrc: `${IMAGE_BASE_URL}/card-bg-single-10min.jpg`,
    badgeImageUrl: product.badgeImageUrl || product.promotionBadgeImageUrl || ''
  })
}

function formatSingleProduct(item) {
  const seconds = item.rightsDurationSec != null ? item.rightsDurationSec : item.totalDurationSec
  const minutes = seconds != null ? `${Number(seconds) / 60}分钟/次` : '单次时长以门店配置为准'
  const times = item.usageTimes != null ? `${Number(item.usageTimes)}次` : '次数以门店配置为准'
  return Object.assign({}, item, {
    payKey: `single-${item.productId}`,
    displayPrice: centToYuan(item.priceCent),
    rightsText: `${times} · ${minutes} · ${durationDaysToText(item.validDays != null ? item.validDays : item.durationDays)}`,
    category: 'single',
    artSrc: item.imageUrl || `${IMAGE_BASE_URL}/card-bg-recharge.jpg`,
    badgeText: item.badgeText || item.promotionText || '',
    badgeImageUrl: item.badgeImageUrl || '',
    disabled: item.status && item.status !== 'enabled'
  })
}

const categoryTabs = [
  { key: 'member', label: '包月会员' },
  { key: 'wash-card', label: '洗车卡' },
  { key: 'single', label: '次卡' }
]

function getCategoryProducts(category, memberProducts, cardProducts, singleProducts = []) {
  if (category === 'single') return singleProducts
  if (category === 'wash-card') return cardProducts
  return memberProducts
}

function getCategoryMeta(category) {
  if (category === 'single') return { title: '次卡', desc: '每次洗车扣除一次，次数、时长及有效期以所选门店为准' }
  if (category === 'wash-card') {
    return {
      title: '洗车卡按时间计费',
      desc: '按实际洗车时长及使用场地的计费规则扣费'
    }
  }
  return {
    title: '包月会员',
    desc: '按所选场地配置购买，额度或有效期用完后失效'
  }
}

function buildPreviewCategories(activeCategory, memberProducts, cardProducts, singleProducts = []) {
  return categoryTabs
    .filter((item) => item.key !== activeCategory)
    .map((item) => {
      const products = getCategoryProducts(item.key, memberProducts, cardProducts, singleProducts)
      const first = products[0] || {}
      return Object.assign({}, item, {
        artSrc: first.artSrc,
        subtitle: item.key === 'member' ? '会员额度套餐' : (item.key === 'single' ? '按次洗车套餐' : '充值更优惠'),
        priceText: first.displayPrice ? `¥${first.displayPrice}` : ''
      })
    })
}

function normalizeMemberProduct(item) {
  const durationDays = Number(item.durationDays || item.validDays || 0)
  const quotaSeconds = item.rightsDurationSec != null ? item.rightsDurationSec : item.totalDurationSec
  const quotaMinutes = durationToMinutes(quotaSeconds)

  return {
    id: item.productId,
    productId: item.productId,
    payKey: `member-${item.productId}`,
    skuId: item.skuId || null,
    productTypeCode: item.productTypeCode || item.type || '',
    durationDays,
    cardKind: getCardKind(item),
    name: item.name,
    price: centToYuan(item.priceCent),
    priceCent: Number(item.priceCent || 0),
    rightsText: quotaSeconds != null ? `洗车额度：${quotaMinutes}分钟 · ${durationDaysToText(durationDays)}` : `有效期：${durationDays || '-'}天`,
    badgeText: item.badgeText || item.promotionText || item.cornerText || '',
    badgeImageUrl: item.badgeImageUrl || item.promotionBadgeImageUrl || '',
    disabled: item.status && item.status !== 'enabled'
  }
}

function normalizeCardProduct(item) {
  const cardKind = getCardKind(item)
  const price = centToYuan(item.priceCent)
  const faceValue = centToYuan(item.faceValueCent)
  const giftCouponCount = Number(item.giftCouponCount || 0)
  const giftCouponMinutes = Number(item.giftCouponMinutes || 0)
  const usageTimes = Number(item.usageTimes || 0)
  const rightsMinutes = durationToMinutes(item.rightsDurationSec || item.totalDurationSec)
  const badgeText = item.badgeText || item.promotionText || item.cornerText || (giftCouponCount ? `赠送${giftCouponCount}张洗车券` : '')
  const giftText = giftCouponCount && giftCouponMinutes > 0 ? `送：免费${giftCouponMinutes}分钟券 x ${giftCouponCount}张` : ''
  const name = item.name || (cardKind === 'single_card' ? `${usageTimes}次卡` : `充${faceValue || price}元`)

  return {
    id: item.productId,
    productId: item.productId,
    payKey: `card-${item.productId}`,
    cardKind,
    productTypeCode: item.productTypeCode || item.type || '',
    name,
    amount: price,
    priceCent: Number(item.priceCent || 0),
    faceValueCent: Number(item.faceValueCent != null ? item.faceValueCent : (item.priceCent || 0)),
    durationDays: Number(item.durationDays || item.validDays || 0),
    validityText: cardKind === 'single_card' ? `${rightsMinutes > 0 ? rightsMinutes + '分钟' : '普通单次洗车'} · 可用${usageTimes}次` : durationDaysToText(item.durationDays || item.validDays),
    giftText,
    badgeText,
    badgeImageUrl: item.badgeImageUrl || item.promotionBadgeImageUrl || '',
    disabled: item.status && item.status !== 'enabled'
  }
}

module.exports = function createBuyCardPage(overrides = {}) {
  const options = {
  data: {
    reviewMode: false,
    couponCount: 0,
    crownState: 'expired',
    siteTitle: '正在获取可支付场地...',
    paymentSites: [],
    selectedPaymentSite: null,
    selectedPaymentSiteIndex: 0,
    paymentSitesLoading: true,
    siteSelectorVisible: false,
    siteSheetOffset: 0,
    siteSheetDragging: false,
    siteSelectorLoading: false,
    siteSelectorError: '',
    siteSelectorKeyword: '',
    siteSelectorResults: [],
    siteCityOptions: [{ cityId: '', cityName: '全部城市' }],
    siteCityIndex: 0,
    siteDistrictOptions: [{ districtCode: '', districtName: '全部区域' }],
    siteDistrictIndex: 0,
    memberProducts: [],
    cardProducts: [],
    singleProducts: [],
    categoryTabs,
    activeCategory: 'member',
    activeCategoryIndex: 0,
    activeProducts: [],
    categoryMeta: getCategoryMeta('member'),
    previewCategories: buildPreviewCategories('member', [], []),
    categorySwitching: false,
    switchDirection: 'next',
    categoryDragging: false,
    categoryDragX: 0,
    rulesExpanded: false,
    phoneAuthVisible: false,
    loading: false,
    payingId: ''
  },

  onLoad(options) {
    if (options && options.category === 'wash-card') {
      this.setData({ activeCategory: 'wash-card', activeCategoryIndex: 1, categoryMeta: getCategoryMeta('wash-card') })
    }
    this.guardAccess()
  },

  onUnload() {
    if (this.siteSheetCloseTimer) clearTimeout(this.siteSheetCloseTimer)
    this.productRequestId = (this.productRequestId || 0) + 1
    if (this.siteSelectorTimer) {
      clearTimeout(this.siteSelectorTimer)
      this.siteSelectorTimer = null
    }
    this.siteSelectorRequestId = (this.siteSelectorRequestId || 0) + 1
  },

  guardAccess() {
    ensurePhoneBound()
      .then(() => {
        this.setData({ phoneAuthVisible: false })
        return api.review.status()
      })
      .then((status) => {
        this.setData({ reviewMode: status.reviewMode === true })
        this.loadProducts()
      })
      .catch((err) => {
        if (err.code === 'PHONE_REQUIRED') {
          this.setData({ phoneAuthVisible: true })
          return
        }

        wx.showToast({
          title: err.message || '登录失败',
          icon: 'none'
        })
      })
  },

  loadProducts() {
    this.setData({ loading: true, paymentSitesLoading: true })

    Promise.all([
      api.coupons.mine({ status: 'available', page: 0, size: 1 }).catch(() => null),
      // 商品必须等收款场地确定后再加载，不能用全局目录冒充场地售价。
      Promise.resolve([]),
      api.users.summary().catch(() => null),
      api.member.cards().catch(() => []),
      api.payment.sites()
        .then((items) => ({ items: items || [], error: null }))
        .catch((error) => ({ items: null, error }))
    ])
      .then(([coupons, products, summary, cards, paymentSiteResult]) => {
        const list = products || []
        const paymentSites = Array.isArray(paymentSiteResult.items)
          ? paymentSiteResult.items.map(normalizePaymentSite).filter((item) => item.siteId)
          : this.data.paymentSites
        const previousSiteId = this.data.selectedPaymentSite && this.data.selectedPaymentSite.siteId
        const storedSiteId = wx.getStorageSync(STORAGE_KEYS.paymentSiteId)
        const recentSiteId = getRecentSiteId(summary)
        const preferredSiteId = previousSiteId || this.entrySiteId || storedSiteId || recentSiteId
        let selectedPaymentSiteIndex = paymentSites.findIndex((item) => String(item.siteId) === String(preferredSiteId || ''))

        if (selectedPaymentSiteIndex < 0) selectedPaymentSiteIndex = 0

        const selectedPaymentSite = paymentSites[selectedPaymentSiteIndex] || null
        const enabledMonthlyProducts = list
          .filter((item) => getCardKind(item) === 'monthly_member')
          .map(normalizeMemberProduct)
          .map(formatMemberProduct)
          .filter((item) => !item.disabled)
        const enabledCardProducts = list
          .filter((item) => getCardKind(item) === 'wash_card')
          .map(normalizeCardProduct)
          .map(formatCardProduct)
          .filter((item) => !item.disabled)
        const memberProducts = enabledMonthlyProducts
        const cardProducts = enabledCardProducts
        const singleProducts = list.filter((item) => getCardKind(item) === 'single_card').map(formatSingleProduct).filter((item) => !item.disabled)
        const activeCategory = this.data.activeCategory

        this.setData({
          couponCount: getCouponCount(summary, coupons),
          crownState: getCrownState(cards),
          siteTitle: selectedPaymentSite
            ? selectedPaymentSite.siteName
            : (paymentSiteResult.error ? '支付场地加载失败' : '暂无已开通在线办卡场地'),
          paymentSites,
          selectedPaymentSite,
          selectedPaymentSiteIndex,
          paymentSitesLoading: false,
          memberProducts,
          cardProducts,
          singleProducts,
          activeProducts: getCategoryProducts(activeCategory, memberProducts, cardProducts, singleProducts),
          previewCategories: buildPreviewCategories(activeCategory, memberProducts, cardProducts, singleProducts)
        })

        if (selectedPaymentSite) {
          wx.setStorageSync(STORAGE_KEYS.paymentSiteId, selectedPaymentSite.siteId)
          return this.loadSiteProducts(selectedPaymentSite)
        }

        if (paymentSiteResult.error && !selectedPaymentSite) {
          wx.showToast({
            title: paymentSiteResult.error.message || '支付场地加载失败',
            icon: 'none'
          })
        }
      })
      .catch((err) => {
        wx.showToast({
          title: err.message || '套餐加载失败',
          icon: 'none'
        })
      })
      .finally(() => {
        this.setData({ paymentSitesLoading: false })
        if (!this.data.selectedPaymentSite) this.setData({ loading: false })
      })
  },

  openSiteSelector() {
    if (this.data.payingId) return
    if (this.siteSheetCloseTimer) clearTimeout(this.siteSheetCloseTimer)
    this.siteSheetClosing = false
    this.siteSheetTouch = null
    this.setData({
      siteSheetOffset: 0,
      siteSheetDragging: false,
      siteSelectorVisible: true,
      siteSelectorError: '',
      siteSelectorKeyword: ''
    })
    this.loadSiteSelectorRegions()
  },

  closeSiteSelector() {
    if (this.siteSheetCloseTimer) clearTimeout(this.siteSheetCloseTimer)
    this.siteSheetCloseTimer = null
    this.siteSheetClosing = false
    this.siteSheetTouch = null
    if (this.siteSelectorTimer) {
      clearTimeout(this.siteSelectorTimer)
      this.siteSelectorTimer = null
    }
    this.siteSelectorRequestId = (this.siteSelectorRequestId || 0) + 1
    this.setData({ siteSelectorVisible: false, siteSelectorLoading: false, siteSheetOffset: 0, siteSheetDragging: false })
  },

  onSiteSheetStart(event) {
    const touch = event.touches && event.touches[0]
    if (this.siteSheetClosing || !touch || event.touches.length !== 1) return
    this.siteSheetTouch = { x: touch.clientX, y: touch.clientY, time: Date.now(), direction: '' }
  },

  onSiteSheetMove(event) {
    const start = this.siteSheetTouch
    const touch = event.touches && event.touches[0]
    if (!start || !touch || event.touches.length !== 1) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (!start.direction && Math.max(Math.abs(dx), Math.abs(dy)) > 8) start.direction = dy > 0 && dy > Math.abs(dx) ? 'down' : 'other'
    if (start.direction === 'down') this.setData({ siteSheetOffset: Math.max(0, dy), siteSheetDragging: true })
  },

  onSiteSheetEnd() {
    const start = this.siteSheetTouch
    this.siteSheetTouch = null
    if (!start || !this.data.siteSheetDragging) return
    const distance = this.data.siteSheetOffset
    if (distance >= 100 || (distance >= 40 && distance / Math.max(1, Date.now() - start.time) > 0.6)) {
      this.siteSheetClosing = true
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.setData({ siteSheetOffset: info.windowHeight || 800, siteSheetDragging: false })
      this.siteSheetCloseTimer = setTimeout(() => this.closeSiteSelector(), 220)
    } else this.onSiteSheetCancel()
  },

  onSiteSheetCancel() {
    this.siteSheetTouch = null
    if (!this.siteSheetClosing) this.setData({ siteSheetOffset: 0, siteSheetDragging: false })
  },

  noop() {},

  loadSiteSelectorRegions() {
    const selected = this.data.selectedPaymentSite || {}

    return api.regions.cities()
      .then((items) => {
        const cities = [{ cityId: '', cityName: '全部城市' }].concat(Array.isArray(items) ? items : [])
        const selectedCityId = selected.cityId || ''
        const siteCityIndex = selectedCityId
          ? Math.max(cities.findIndex((item) => String(item.cityId) === String(selectedCityId)), 0)
          : 0

        this.siteSelectorCityId = cities[siteCityIndex].cityId || ''
        this.siteSelectorDistrictCode = selected.districtCode || ''
        this.setData({ siteCityOptions: cities, siteCityIndex })
        return this.loadSiteSelectorDistricts(this.siteSelectorCityId)
      })
      .catch(() => {
        this.siteSelectorCityId = ''
        this.siteSelectorDistrictCode = ''
        this.setData({
          siteCityOptions: [{ cityId: '', cityName: '全部城市' }],
          siteCityIndex: 0,
          siteDistrictOptions: [{ districtCode: '', districtName: '全部区域' }],
          siteDistrictIndex: 0
        })
      })
      .then(() => this.searchPaymentSites())
  },

  loadSiteSelectorDistricts(cityId) {
    if (!cityId) {
      this.siteSelectorDistrictCode = ''
      this.setData({
        siteDistrictOptions: [{ districtCode: '', districtName: '全部区域' }],
        siteDistrictIndex: 0
      })
      return Promise.resolve()
    }

    return api.regions.districts(cityId)
      .then((items) => {
        const districts = [{ districtCode: '', districtName: '全部区域' }].concat(Array.isArray(items) ? items : [])
        const siteDistrictIndex = this.siteSelectorDistrictCode
          ? Math.max(districts.findIndex((item) => String(item.districtCode) === String(this.siteSelectorDistrictCode)), 0)
          : 0

        this.siteSelectorDistrictCode = districts[siteDistrictIndex].districtCode || ''
        this.setData({ siteDistrictOptions: districts, siteDistrictIndex })
      })
      .catch(() => {
        this.siteSelectorDistrictCode = ''
        this.setData({
          siteDistrictOptions: [{ districtCode: '', districtName: '全部区域' }],
          siteDistrictIndex: 0
        })
      })
  },

  onSiteSelectorCityChange(event) {
    const siteCityIndex = Number(event.detail.value || 0)
    const city = this.data.siteCityOptions[siteCityIndex] || this.data.siteCityOptions[0]
    this.siteSelectorCityId = city.cityId || ''
    this.siteSelectorDistrictCode = ''
    this.setData({ siteCityIndex, siteDistrictIndex: 0 })
    this.loadSiteSelectorDistricts(this.siteSelectorCityId)
      .then(() => this.searchPaymentSites())
  },

  onSiteSelectorDistrictChange(event) {
    const siteDistrictIndex = Number(event.detail.value || 0)
    const district = this.data.siteDistrictOptions[siteDistrictIndex] || this.data.siteDistrictOptions[0]
    this.siteSelectorDistrictCode = district.districtCode || ''
    this.setData({ siteDistrictIndex })
    this.searchPaymentSites()
  },

  onSiteSelectorKeywordInput(event) {
    this.setData({ siteSelectorKeyword: String(event.detail.value || '') })
    this.schedulePaymentSiteSearch(320)
  },

  clearSiteSelectorKeyword() {
    this.setData({ siteSelectorKeyword: '' })
    this.schedulePaymentSiteSearch(0)
  },

  submitPaymentSiteSearch() {
    this.schedulePaymentSiteSearch(0)
  },

  schedulePaymentSiteSearch(delay) {
    if (this.siteSelectorTimer) clearTimeout(this.siteSelectorTimer)
    this.siteSelectorTimer = setTimeout(() => {
      this.siteSelectorTimer = null
      this.searchPaymentSites()
    }, Number(delay) || 0)
  },

  searchPaymentSites() {
    const requestId = (this.siteSelectorRequestId || 0) + 1
    const cityId = this.siteSelectorCityId || ''
    const districtCode = this.siteSelectorDistrictCode || ''
    const keyword = String(this.data.siteSelectorKeyword || '').trim()
    this.siteSelectorRequestId = requestId
    this.setData({ siteSelectorLoading: true, siteSelectorError: '' })

    const payableRequest = api.payment.sites({
      cityId: cityId || undefined,
      keyword: keyword || undefined
    }).catch((error) => {
      if (this.data.paymentSites.length) return this.data.paymentSites
      throw error
    })
    const searchRequest = api.sites.search({
      cityId: cityId || undefined,
      districtCode: districtCode || undefined,
      keyword: keyword || undefined,
      page: 0,
      size: 50
    }).catch(() => null)

    return Promise.all([payableRequest, searchRequest])
      .then(([payableItems, searchPage]) => {
        if (requestId !== this.siteSelectorRequestId) return

        const payableSites = getPageItems(payableItems).map(normalizePaymentSite).filter((item) => item.siteId)
        const searchMap = getPageItems(searchPage).reduce((result, item) => {
          result[String(item.siteId || item.id)] = item
          return result
        }, {})
        const results = payableSites
          .map((payable) => {
            const detail = searchMap[String(payable.siteId)]
            const site = normalizePaymentSite(Object.assign({}, payable, detail || {}, {
              siteId: payable.siteId,
              siteName: payable.siteName
            }))
            site.selected = String(site.siteId) === String((this.data.selectedPaymentSite || {}).siteId || '')
            return site
          })
          .filter((site) => {
            if (!districtCode) return true
            return String(site.districtCode || '') === String(districtCode)
          })

        this.setData({
          siteSelectorResults: results,
          siteSelectorError: results.length ? '' : '当前筛选范围暂无已开通在线办卡的场地'
        })
      })
      .catch((err) => {
        if (requestId !== this.siteSelectorRequestId) return
        const fallbackResults = this.data.paymentSites
          .filter((site) => {
            const cityMatched = !cityId || String(site.cityId) === String(cityId)
            const districtMatched = !districtCode || String(site.districtCode || '') === String(districtCode)
            return cityMatched && districtMatched && siteMatchesKeyword(site, keyword)
          })
          .map((site) => Object.assign({}, site, {
            selected: String(site.siteId) === String((this.data.selectedPaymentSite || {}).siteId || '')
          }))
        this.setData({
          siteSelectorResults: fallbackResults,
          siteSelectorError: fallbackResults.length ? '' : (err.message || '场地加载失败，请稍后重试')
        })
      })
      .finally(() => {
        if (requestId === this.siteSelectorRequestId) this.setData({ siteSelectorLoading: false })
      })
  },

  selectPaymentSite(event) {
    if (this.data.payingId) return
    const siteId = event.currentTarget.dataset.siteId
    const selectedPaymentSite = this.data.siteSelectorResults.find((item) => String(item.siteId) === String(siteId))
    if (!selectedPaymentSite) return

    const paymentSites = this.data.paymentSites.slice()
    let selectedPaymentSiteIndex = paymentSites.findIndex((item) => String(item.siteId) === String(siteId))
    if (selectedPaymentSiteIndex < 0) {
      paymentSites.push(selectedPaymentSite)
      selectedPaymentSiteIndex = paymentSites.length - 1
    } else {
      paymentSites[selectedPaymentSiteIndex] = Object.assign({}, paymentSites[selectedPaymentSiteIndex], selectedPaymentSite)
    }
    wx.setStorageSync(STORAGE_KEYS.paymentSiteId, selectedPaymentSite.siteId)
    this.setData({
      paymentSites,
      selectedPaymentSiteIndex,
      selectedPaymentSite,
      siteTitle: selectedPaymentSite.siteName,
      siteSelectorVisible: false
    })
    this.loadSiteProducts(selectedPaymentSite)
  },

  onShow() {
    if (this.data.selectedPaymentSite && !this.data.loading) {
      this.loadSiteProducts(this.data.selectedPaymentSite)
    }
  },

  loadSiteProducts(site) {
    const requestId = (this.productRequestId || 0) + 1
    this.productRequestId = requestId
    // 切换场地先清空旧商品，防止旧价格与新场地下单参数混用。
    this.setData({ loading: true, memberProducts: [], cardProducts: [], singleProducts: [], activeProducts: [], previewCategories: [] })
    return api.member.products({ bizCategory: 'wash_rights', siteId: site.siteId })
      .then((result) => {
        if (requestId !== this.productRequestId || String(site.siteId) !== String((this.data.selectedPaymentSite || {}).siteId)) return
        const list = getPageItems(result)
        const memberProducts = list.filter((item) => getCardKind(item) === 'monthly_member').map(normalizeMemberProduct).map(formatMemberProduct).filter((item) => !item.disabled)
        const cardProducts = list.filter((item) => getCardKind(item) === 'wash_card').map(normalizeCardProduct).map(formatCardProduct).filter((item) => !item.disabled)
        const singleProducts = list.filter((item) => getCardKind(item) === 'single_card').map(formatSingleProduct).filter((item) => !item.disabled)
        this.setData({ memberProducts, cardProducts, singleProducts,
          activeProducts: getCategoryProducts(this.data.activeCategory, memberProducts, cardProducts, singleProducts),
          previewCategories: buildPreviewCategories(this.data.activeCategory, memberProducts, cardProducts, singleProducts) })
      })
      .catch((err) => {
        if (requestId !== this.productRequestId) return
        wx.showToast({ title: err.message || '场地商品加载失败，请重新选择场地', icon: 'none' })
      })
      .finally(() => { if (requestId === this.productRequestId) this.setData({ loading: false }) })
  },

  toggleRules() {
    const rulesExpanded = !this.data.rulesExpanded

    this.setData({ rulesExpanded }, () => {
      if (rulesExpanded) this.scrollToRules()
    })
  },

  openRules() {
    if (this.data.rulesExpanded) {
      this.scrollToRules()
      return
    }

    this.setData({ rulesExpanded: true }, () => {
      this.scrollToRules()
    })
  },

  scrollToRules() {
    setTimeout(() => {
      wx.pageScrollTo({
        selector: '#rules-panel',
        duration: 420,
        offsetTop: -24
      })
    }, 60)
  },

  switchCategory(event) {
    const category = event.currentTarget.dataset.category
    this.changeCategory(category)
  },

  changeCategory(category) {
    const nextIndex = categoryTabs.findIndex((item) => item.key === category)
    const currentIndex = this.data.activeCategoryIndex

    if (nextIndex < 0 || nextIndex === currentIndex || this.data.categorySwitching) return

    this.setData({
      categorySwitching: true,
      switchDirection: nextIndex > currentIndex ? 'next' : 'prev'
    })

    setTimeout(() => {
      this.setData({
        activeCategory: category,
        activeCategoryIndex: nextIndex,
        activeProducts: getCategoryProducts(category, this.data.memberProducts, this.data.cardProducts, this.data.singleProducts),
        categoryMeta: getCategoryMeta(category),
        previewCategories: buildPreviewCategories(category, this.data.memberProducts, this.data.cardProducts, this.data.singleProducts),
        categorySwitching: false,
        categoryDragX: 0,
        categoryDragging: false
      })
    }, 150)
  },

  onCategoryTouchStart(event) {
    if (this.data.categorySwitching || !event.touches || !event.touches.length) return

    const touch = event.touches[0]
    this.categoryTouchStart = {
      x: touch.clientX,
      y: touch.clientY
    }
    this.categorySwipeMode = ''
    this.setData({
      categoryDragging: true,
      categoryDragX: 0
    })
  },

  onCategoryTouchMove(event) {
    if (!this.categoryTouchStart || !event.touches || !event.touches.length) return

    const touch = event.touches[0]
    const deltaX = touch.clientX - this.categoryTouchStart.x
    const deltaY = touch.clientY - this.categoryTouchStart.y
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (!this.categorySwipeMode && Math.max(absX, absY) > 8) {
      this.categorySwipeMode = absX > absY * 1.15 ? 'horizontal' : 'vertical'
    }

    if (this.categorySwipeMode !== 'horizontal') return

    const atFirst = this.data.activeCategoryIndex === 0 && deltaX > 0
    const atLast = this.data.activeCategoryIndex === categoryTabs.length - 1 && deltaX < 0
    const resistance = atFirst || atLast ? 0.24 : 0.72
    const dragX = Math.max(-110, Math.min(110, deltaX * resistance))

    this.setData({ categoryDragX: dragX })
  },

  onCategoryTouchEnd(event) {
    if (!this.categoryTouchStart) return

    const touch = (event.changedTouches && event.changedTouches[0]) || this.categoryTouchStart
    const deltaX = touch.clientX - this.categoryTouchStart.x
    const isHorizontal = this.categorySwipeMode === 'horizontal'
    let nextIndex = this.data.activeCategoryIndex

    if (isHorizontal && Math.abs(deltaX) >= 46) {
      nextIndex += deltaX < 0 ? 1 : -1
    }

    nextIndex = Math.max(0, Math.min(categoryTabs.length - 1, nextIndex))
    this.categoryTouchStart = null
    this.categorySwipeMode = ''
    this.setData({
      categoryDragging: false,
      categoryDragX: 0
    }, () => {
      if (nextIndex !== this.data.activeCategoryIndex) {
        setTimeout(() => this.changeCategory(categoryTabs[nextIndex].key), 90)
      }
    })
  },

  onCategoryTouchCancel() {
    this.categoryTouchStart = null
    this.categorySwipeMode = ''
    this.setData({
      categoryDragging: false,
      categoryDragX: 0
    })
  },

  buyActiveProduct(event) {
    if (this.data.activeCategory === 'single') {
      const productId = event.currentTarget.dataset.id
      const product = this.data.singleProducts.find((item) => String(item.productId) === String(productId))
      if (product && !this.data.payingId) this.createMemberOrder(product)
      return
    }
    if (this.data.activeCategory === 'member') {
      this.buyMemberProduct(event)
      return
    }
    this.buyCardProduct(event)
  },

  buyMemberProduct(event) {
    const productId = event.currentTarget.dataset.id
    const product = this.data.memberProducts.find((item) => String(item.productId) === String(productId))

    if (!product || this.data.payingId) return

    this.createMemberOrder(product)
  },

  buyCardProduct(event) {
    const productId = event.currentTarget.dataset.id
    const target = this.data.cardProducts.find((item) => String(item.productId) === String(productId))

    if (!target || this.data.payingId) return

    this.createMemberOrder(target)
  },

  createMemberOrder(product) {
    if (this.data.loading || this.data.payingId) return
    const paymentSite = this.data.selectedPaymentSite

    if (!paymentSite || !paymentSite.siteId) {
      wx.showModal({
        title: '请选择办卡场地',
        content: '当前没有可用的收款场地，请稍后刷新或联系客服。',
        showCancel: false
      })
      return
    }

    this.setData({ payingId: product.payKey })
    wx.showLoading({ title: '创建订单' })
    const payload = {
      productId: product.productId,
      siteId: paymentSite.siteId,
      payPlatform: 'wechat'
    }

    if (product.skuId) {
      payload.skuId = product.skuId
    }

    api.review.status()
      .then((status) => {
        this.setData({ reviewMode: status.reviewMode === true })
        if (status.reviewMode) {
          wx.hideLoading()
          return reviewPurchase.purchase(product, paymentSite, status).then((receipt) => ({ reviewPreview: true, receipt }))
        }
        return api.member.createOrder(payload)
      })
      .then((order) => this.payIfNeeded(order))
      .then((order) => {
        if (order && order.reviewPreview) {
          if (order.receipt) {
            wx.showModal({ title: '模拟流程已完成', content: '本机体验记录已保存，可在我的洗车卡或充值记录中查看。未产生真实支付，后台体验余额保持不变。', showCancel: false })
          }
          return
        }
        if (order && order.paymentVerified === true) {
          wx.showToast({
            title: '购买成功',
            icon: 'success'
          })
        } else {
          wx.showModal({ title: '支付确认中', content: '暂未确认支付成功，请稍后在订单中心查看结果，请勿重复付款。', showCancel: false })
        }
        this.loadProducts()
      })
      .catch((err) => {
        if (!String(err.errMsg || '').includes('cancel')) {
          wx.showToast({
            title: err.code === 'SITE_SUB_MERCHANT_REQUIRED'
              ? '该场地暂不支持支付'
              : (err.message || '支付失败'),
            icon: 'none'
          })
        }
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ payingId: '' })
      })
  },

  payIfNeeded(order) {
    wx.hideLoading()

    if (order && order.reviewPreview) return Promise.resolve(order)

    if (order && order.wxPayParams) {
      return requestPayment(order.wxPayParams, order).then((payment) => Object.assign({}, order, {
        paymentConfirmPending: !payment || payment.confirmPending !== false,
        paymentVerified: !!payment && payment.confirmPending === false && isPaymentSuccess(payment.confirmResult)
      }))
    }

    const payOrderNo = getPayOrderNo(order)
    if (!payOrderNo) return Promise.reject(new Error('订单缺少支付信息，尚未完成支付'))
    return getPayment(payOrderNo).then((payment) => {
      if (!isPaymentSuccess(payment)) throw new Error('未获取到有效支付参数，尚未完成支付，请稍后重试')
      return Object.assign({}, order, { paymentVerified: true, paymentConfirmPending: false })
    })
  },

  onPhoneAuthSuccess() {
    this.setData({ phoneAuthVisible: false })
    this.loadProducts()
  },

  onPhoneAuthCancel() {
    this.setData({ phoneAuthVisible: false })
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/home/home'
        })
      }
    })
  }
  }
  return Object.assign({}, options, overrides, { data: Object.assign({}, options.data, overrides.data || {}) })
}
