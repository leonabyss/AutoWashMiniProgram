const api = require('../../utils/api')
const { ensurePhoneBound } = require('../../utils/auth')
const { IMAGE_BASE_URL, STORAGE_KEYS } = require('../../utils/config')
const { centToYuan } = require('../../utils/format')
const { requestPayment } = require('../../utils/payment')

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

function memberQuotaMinutes(item) {
  const text = productText(item)
  const durationDays = Number((item && item.durationDays) || 0)

  if (text.indexOf('two') >= 0 || text.indexOf('两年') >= 0 || durationDays >= 700) return 2400
  if (text.indexOf('year') >= 0 || text.indexOf('年卡') >= 0 || durationDays >= 330) return 1200
  if (text.indexOf('half') >= 0 || text.indexOf('半年') >= 0 || durationDays >= 170) return 600
  if (text.indexOf('season') >= 0 || text.indexOf('quarter') >= 0 || text.indexOf('季') >= 0 || durationDays >= 80) return 300
  return 150
}

function memberDisplayName(item) {
  const text = productText(item)
  const durationDays = Number((item && item.durationDays) || 0)

  if (text.indexOf('two') >= 0 || text.indexOf('两年') >= 0 || durationDays >= 700) return '两年卡'
  if (text.indexOf('year') >= 0 || text.indexOf('年卡') >= 0 || durationDays >= 330) return '年卡'
  if (text.indexOf('half') >= 0 || text.indexOf('半年') >= 0 || durationDays >= 170) return '半年卡'
  if (text.indexOf('season') >= 0 || text.indexOf('quarter') >= 0 || text.indexOf('季') >= 0 || durationDays >= 80) return '季卡'
  return '月卡'
}

function washCardAmount(product) {
  const value = Number(product && (product.faceValueCent || product.priceCent || 0)) / 100
  return value || 0
}

function isFiveCentTestCard(product) {
  const text = productText(product)
  const faceValueCent = Number(product && product.faceValueCent || 0)

  return faceValueCent === 5000 || text.indexOf('wash_card_50') >= 0 || text.indexOf('充50元') >= 0
}

function formatMemberProduct(product) {
  const quota = memberQuotaMinutes(product)

  return Object.assign({}, product, {
    name: memberDisplayName(product),
    rightsText: `洗车额度 ${quota}分钟`,
    displayPrice: product.price,
    category: 'member',
    artSrc: `${IMAGE_BASE_URL}/card-bg-monthly.jpg`,
    badgeText: product.badgeText || product.promotionText || product.cornerText || '',
    badgeImageUrl: product.badgeImageUrl || product.promotionBadgeImageUrl || ''
  })
}

function formatCardProduct(product) {
  const amount = washCardAmount(product)
  const validMonthMap = {
    50: 2,
    100: 5,
    200: 10,
    400: 24
  }
  const validMonth = validMonthMap[amount]

  return Object.assign({}, product, {
    name: `充${amount || product.amount || ''}元`,
    validityText: validMonth ? `卡有效期${validMonth}个月` : product.validityText,
    displayPrice: product.amount,
    rightsText: validMonth ? `卡有效期 ${validMonth}个月` : product.validityText,
    category: 'wash-card',
    artSrc: `${IMAGE_BASE_URL}/card-bg-single-10min.jpg`,
    fiveCentTestPay: isFiveCentTestCard(product),
    testPayText: isFiveCentTestCard(product) ? '微信支付 ¥0.05' : '',
    badgeImageUrl: product.badgeImageUrl || product.promotionBadgeImageUrl || ''
  })
}

const categoryTabs = [
  { key: 'member', label: '包月会员' },
  { key: 'wash-card', label: '洗车卡' }
]

function getCategoryProducts(category, memberProducts, cardProducts) {
  if (category === 'wash-card') return cardProducts
  return memberProducts
}

function getCategoryMeta(category) {
  if (category === 'wash-card') {
    return {
      title: '洗车卡按时间计费',
      desc: '6分钟内6元，超出按0.5元/分钟计费'
    }
  }
  return {
    title: '包月会员',
    desc: '当日洗车上限30分钟，额度或有效期用完后失效'
  }
}

function buildPreviewCategories(activeCategory, memberProducts, cardProducts) {
  return categoryTabs
    .filter((item) => item.key !== activeCategory)
    .map((item) => {
      const products = getCategoryProducts(item.key, memberProducts, cardProducts)
      const first = products[0] || {}
      return Object.assign({}, item, {
        artSrc: first.artSrc,
        subtitle: item.key === 'member' ? '会员额度套餐' : '充值更优惠',
        priceText: first.displayPrice ? `¥${first.displayPrice}` : ''
      })
    })
}

function normalizeMemberProduct(item) {
  const durationDays = Number(item.durationDays || item.validDays || 0)
  const quotaMinutes = durationToMinutes(item.rightsDurationSec || item.totalDurationSec)

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
    rightsText: quotaMinutes ? `洗车额度：${quotaMinutes}分钟` : `有效期：${durationDays || '-'}天`,
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
  const badgeText = item.badgeText || item.promotionText || item.cornerText || (giftCouponCount ? `送${giftCouponCount}次，立省¥${giftCouponCount * 8}元` : '')
  const giftText = giftCouponCount ? `送：免费${giftCouponMinutes || 10}分钟券 x ${giftCouponCount}张` : ''
  const name = item.name || (cardKind === 'single_card' ? `${usageTimes || 1}次卡` : `充${faceValue || price}元`)

  return {
    id: item.productId,
    productId: item.productId,
    payKey: `card-${item.productId}`,
    cardKind,
    productTypeCode: item.productTypeCode || item.type || '',
    name,
    amount: price,
    priceCent: Number(item.priceCent || 0),
    faceValueCent: Number(item.faceValueCent || item.priceCent || 0),
    durationDays: Number(item.durationDays || item.validDays || 0),
    validityText: cardKind === 'single_card' ? `${rightsMinutes || 10}分钟 · 可用${usageTimes || 1}次` : durationDaysToText(item.durationDays || item.validDays),
    giftText,
    badgeText,
    badgeImageUrl: item.badgeImageUrl || item.promotionBadgeImageUrl || '',
    disabled: item.status && item.status !== 'enabled'
  }
}

Page({
  data: {
    couponCount: 0,
    crownState: 'expired',
    siteTitle: '正在获取可支付场地...',
    paymentSites: [],
    selectedPaymentSite: null,
    selectedPaymentSiteIndex: 0,
    paymentSitesLoading: true,
    siteSelectorVisible: false,
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

  onLoad() {
    this.guardAccess()
  },

  onUnload() {
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
      api.member.products({ bizCategory: 'wash_rights' }).catch(() => null),
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
        const preferredSiteId = previousSiteId || storedSiteId || recentSiteId
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
          activeProducts: getCategoryProducts(activeCategory, memberProducts, cardProducts),
          previewCategories: buildPreviewCategories(activeCategory, memberProducts, cardProducts)
        })

        if (selectedPaymentSite) {
          wx.setStorageSync(STORAGE_KEYS.paymentSiteId, selectedPaymentSite.siteId)
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
        this.setData({ loading: false, paymentSitesLoading: false })
      })
  },

  openSiteSelector() {
    this.setData({
      siteSelectorVisible: true,
      siteSelectorError: '',
      siteSelectorKeyword: ''
    })
    this.loadSiteSelectorRegions()
  },

  closeSiteSelector() {
    if (this.siteSelectorTimer) {
      clearTimeout(this.siteSelectorTimer)
      this.siteSelectorTimer = null
    }
    this.siteSelectorRequestId = (this.siteSelectorRequestId || 0) + 1
    this.setData({ siteSelectorVisible: false, siteSelectorLoading: false })
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
        activeProducts: getCategoryProducts(category, this.data.memberProducts, this.data.cardProducts),
        categoryMeta: getCategoryMeta(category),
        previewCategories: buildPreviewCategories(category, this.data.memberProducts, this.data.cardProducts),
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

    api.member.createOrder(payload)
      .then((order) => this.payIfNeeded(order))
      .then((order) => {
        if (!order || !order.paymentConfirmPending) {
          wx.showToast({
            title: '购买成功',
            icon: 'success'
          })
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

    if (order && order.wxPayParams) {
      return requestPayment(order.wxPayParams, order).then((payment) => Object.assign({}, order, {
        paymentConfirmPending: payment && payment.confirmPending
      }))
    }

    return Promise.resolve(order)
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
})
