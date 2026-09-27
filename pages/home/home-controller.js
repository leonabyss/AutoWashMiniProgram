const api = require('../../utils/api')
const { hasStoredSession, restoreSession } = require('../../utils/request')
const { ensurePhoneBound } = require('../../utils/auth')
const { API_BASE_URL, STORAGE_KEYS } = require('../../utils/config')
const { centToYuan, secToText, makeClientRequestId } = require('../../utils/format')
const { getOrderNo, getResumeTarget } = require('../../utils/wash-route')

const HOME_MACHINE_STATUS_INTERVAL = 5000
const HOME_RESUME_REFRESH_INTERVAL = 5000
const HOME_ACCOUNT_REFRESH_INTERVAL = 15000
const HOME_MESSAGE_REFRESH_INTERVAL = 15000
const defaultShareInfo = {
  title: '泡泡洗车 自助扫码洗车',
  path: '/pages/home/home',
  imageUrl: '',
  remoteImageUrl: ''
}

const guestSummary = {
  type: 'guest',
  icon: 'guest',
  prefix: '',
  value: '未登录',
  unit: ''
}

function isActiveCard(card) {
  return card && card.status === 'active'
}

function getProductType(card) {
  return String((card && (card.productType || card.productTypeCode || card.type)) || '').toLowerCase()
}

function getCardKind(card) {
  return String((card && card.cardKind) || '').toLowerCase()
}

function getCardName(card) {
  return String((card && card.name) || '')
}

function isDurationCard(card) {
  const cardKind = getCardKind(card)
  const productType = getProductType(card)
  const name = getCardName(card)

  return (
    cardKind === 'time_card'
    || productType === 'time_card'
    || productType === 'duration_card'
    || productType === 'hour_card'
    || productType === 'minute_card'
    || name.indexOf('时长') >= 0
  )
}

function isSingleCard(card) {
  const cardKind = getCardKind(card)
  const productType = getProductType(card)
  const name = getCardName(card)

  return (
    cardKind === 'single_card'
    || productType.indexOf('single_card') >= 0
    || name.indexOf('次卡') >= 0
  )
}

function isWashCard(card) {
  const cardKind = getCardKind(card)
  const productType = getProductType(card)
  const name = getCardName(card)

  return (
    cardKind === 'wash_card'
    || productType.indexOf('wash_card') >= 0
    || name.indexOf('洗车卡') >= 0
  )
}

function isVipCard(card) {
  const cardKind = getCardKind(card)
  const productType = getProductType(card)
  const name = getCardName(card).toLowerCase()

  return (
    cardKind === 'monthly_member'
    || productType === 'vip'
    || productType === 'vip_card'
    || productType === 'month_card'
    || productType.indexOf('member_') === 0
    || productType === 'season_card'
    || productType === 'year_card'
    || name.indexOf('vip') >= 0
    || name.indexOf('会员') >= 0
    || name.indexOf('月卡') >= 0
    || name.indexOf('季卡') >= 0
    || name.indexOf('年卡') >= 0
  )
}

function getExpireDays(validTo) {
  const expireAt = new Date(validTo).getTime()

  if (!expireAt) return 0

  return Math.max(0, Math.ceil((expireAt - Date.now()) / 86400000))
}

function getCrownState(cards) {
  const vipCards = (cards || []).filter(isVipCard)
  const activeVipCard = vipCards.find(isActiveCard)

  if (!activeVipCard) return 'expired'
  if (!activeVipCard.validTo) return 'active'
  return getExpireDays(activeVipCard.validTo) <= 7 ? 'expiring' : 'active'
}

function getCouponTotal(coupons) {
  if (!coupons) return 0
  if (typeof coupons.total === 'number') return coupons.total

  return ((coupons.items || coupons.list || [])).length
}

function buildAccountMetrics(profile, wallet, cards, coupons) {
  const activeCards = (cards || []).filter(isActiveCard)
  const vipCard = activeCards.find(isVipCard)
  const durationCard = activeCards.find(isDurationCard)
  const singleCard = activeCards.find(isSingleCard)
  let rightsTitle = '普通用户'
  let rightsDetail = '暂无专属权益'
  let rightsState = 'normal'

  if (vipCard) {
    rightsTitle = getCardName(vipCard) || '包月会员'
    rightsDetail = vipCard.validTo
      ? `剩余${getExpireDays(vipCard.validTo)}天`
      : '会员权益生效中'
    rightsState = getExpireDays(vipCard.validTo) <= 7 ? 'expiring' : 'active'
  } else if (durationCard) {
    rightsTitle = getCardName(durationCard) || '时长卡'
    rightsDetail = `剩余${secToText(durationCard.remainingDurationSec)}`
    rightsState = 'active'
  } else if (singleCard) {
    rightsTitle = getCardName(singleCard) || '次卡用户'
    rightsDetail = `剩余${singleCard.remainingTimes || singleCard.totalTimes || 0}次`
    rightsState = 'active'
  } else if (activeCards.length) {
    rightsTitle = '洗车卡用户'
    rightsDetail = `${activeCards.length}张卡可用`
    rightsState = 'active'
  }

  return {
    isLoggedIn: !!(profile && profile.phone),
    rightsTitle,
    rightsDetail,
    rightsState,
    balance: centToYuan(wallet && wallet.balanceCent),
    cardCount: activeCards.length,
    couponCount: getCouponTotal(coupons)
  }
}

function buildAccountSummary(profile, wallet, cards, coupons) {
  if (!profile || !profile.phone) {
    return guestSummary
  }

  const couponTotal = getCouponTotal(coupons)

  if (couponTotal > 0) {
    return {
      type: 'coupon',
      icon: 'ticket',
      prefix: '洗车券剩余',
      value: String(couponTotal),
      unit: '张'
    }
  }

  const activeCards = (cards || []).filter(isActiveCard)
  const durationCard = activeCards.find(isDurationCard)
  const singleCard = activeCards.find(isSingleCard)
  const washCard = activeCards.find(isWashCard)

  if (durationCard) {
    return {
      type: 'duration',
      icon: 'clock',
      prefix: '时长卡还剩',
      value: secToText(durationCard.remainingDurationSec),
      unit: ''
    }
  }

  if (singleCard) {
    return {
      type: 'coupon',
      icon: 'ticket',
      prefix: '次卡剩余',
      value: String(singleCard.remainingTimes || singleCard.totalTimes || 0),
      unit: '次'
    }
  }

  if (washCard) {
    return {
      type: 'balance',
      icon: 'crown',
      prefix: '洗车卡余额',
      value: centToYuan(washCard.remainingAmountCent),
      unit: '元'
    }
  }

  const vipCard = activeCards.find(isVipCard)

  if (vipCard) {
    return {
      type: 'vip',
      icon: 'crown',
      prefix: 'VIP还剩',
      value: String(getExpireDays(vipCard.validTo)),
      unit: '天到期'
    }
  }

  return {
    type: 'balance',
    icon: 'crown',
    prefix: '充值余额还剩',
    value: centToYuan(wallet && wallet.balanceCent),
    unit: '元'
  }
}

function normalizeMachineStatus(status) {
  if (!status) {
    return {
      statusText: '维护',
      statusClass: 'maintenance'
    }
  }

  const machineStatus = String(status.machineStatus || status.status || '').toLowerCase()
  const onlineStatus = String(status.onlineStatus || '').toLowerCase()
  const pauseStatus = String(status.pauseStatus || '').toLowerCase()
  const maintenanceStatus = String(status.maintenanceStatus || '').toLowerCase()

  if (
    onlineStatus === 'offline'
    || maintenanceStatus === 'maintenance'
    || maintenanceStatus === 'repair'
    || pauseStatus === 'paused'
    || machineStatus === 'maintenance'
    || machineStatus === 'repair'
  ) {
    return {
      statusText: '维护',
      statusClass: 'maintenance'
    }
  }

  if (
    status.occupied
    || status.available === false
    || machineStatus === 'busy'
    || machineStatus === 'running'
    || machineStatus === 'washing'
    || machineStatus === 'working'
    || machineStatus === 'occupied'
  ) {
    return {
      statusText: '忙碌',
      statusClass: 'busy'
    }
  }

  return {
    statusText: '空闲',
    statusClass: 'idle'
  }
}

function hasMachineStatusSnapshot(source) {
  return !!(
    source
    && (
      source.machineStatus
      || source.onlineStatus
      || source.pauseStatus
      || source.maintenanceStatus
      || typeof source.occupied === 'boolean'
      || typeof source.available === 'boolean'
    )
  )
}

function getHomeSizeClass(heightRpx) {
  if (heightRpx <= 1080) return 'home-tight'
  if (heightRpx <= 1220) return 'home-compact'
  if (heightRpx >= 1500) return 'home-tall'
  return 'home-normal'
}

function pxToRpx(px, windowWidth) {
  return Math.round(Number(px || 0) * 750 / (windowWidth || 375))
}

function getPanelBottomGap(info, windowWidth, heightRpx) {
  const safeBottomPx = info.safeArea ? Math.max(0, (info.windowHeight || 0) - info.safeArea.bottom) : 0
  const safeBottomRpx = pxToRpx(safeBottomPx, windowWidth)
  const baseGap = heightRpx <= 1080 ? 14 : 18

  return Math.max(baseGap, safeBottomRpx + 10)
}

function getApiOrigin() {
  const match = String(API_BASE_URL || '').match(/^https?:\/\/[^/]+/)

  return match ? match[0] : ''
}

function normalizeCmsImageUrl(url) {
  if (!url) return ''

  const value = String(url)

  if (/^https?:\/\//.test(value) || value.indexOf('wxfile://') === 0) {
    return value
  }

  if (value.charAt(0) === '/') {
    if (value.indexOf('/image/') === 0 || value.indexOf('/uploads/') === 0) {
      return `${API_BASE_URL}${value}`
    }

    return `${getApiOrigin()}${value}`
  }

  return value
}

function isRemoteImageUrl(url) {
  return /^https?:\/\//.test(String(url || ''))
}

function normalizeCmsShare(homeCms) {
  const share = (homeCms && homeCms.share) || {}
  const imageUrl = share.imageUrl || homeCms.shareImageUrl || ''
  const remoteImageUrl = normalizeCmsImageUrl(imageUrl)

  return {
    title: share.title || homeCms.shareTitle || defaultShareInfo.title,
    path: share.path || defaultShareInfo.path,
    imageUrl: isRemoteImageUrl(remoteImageUrl) ? '' : remoteImageUrl,
    remoteImageUrl
  }
}

function normalizeCmsCarousel(item, index) {
  const imageUrl = normalizeCmsImageUrl(item.imageUrl || item.imagePath || item.coverUrl || '')

  return {
    id: item.id || item.carouselId || `cms-banner-${index}`,
    title: item.badgeText || '',
    subtitle: item.title || item.subtitle || '',
    desc: item.subtitle || item.description || item.desc || '',
    buttonText: item.actionText || item.buttonText || '',
    imageUrl,
    linkType: item.linkType || '',
    linkValue: item.linkValue || '',
    contentType: item.contentType || '',
    sort: Number(item.sort || index),
    shareTitle: item.shareTitle || item.title || ''
  }
}

function getCmsPlacementList(homeCms, placementCode) {
  if (!homeCms) return []

  const placement = String(placementCode || '').toLowerCase()

  if (placement === 'home_banner') {
    return homeCms.homeBanners || homeCms.homeBanner || homeCms.carousels || homeCms.banners || homeCms.cardPromotions || []
  }

  if (placement === 'home_badge') {
    return homeCms.homeBadges || homeCms.homeBadge || homeCms.badges || homeCms.carousels || homeCms.banners || []
  }

  if (placement === 'wash_finish') {
    return homeCms.washFinishBanners || homeCms.washFinish || homeCms.carousels || homeCms.banners || []
  }

  return homeCms.carousels || homeCms.banners || homeCms.cardPromotions || []
}

function getCmsPlacementItems(homeCms, placementCode) {
  const list = getCmsPlacementList(homeCms, placementCode)
  const placement = String(placementCode || '').toLowerCase()

  if (!placement) return list || []

  return (list || []).filter((item) => {
    const itemPlacement = String((item && item.placementCode) || '').toLowerCase()

    return !itemPlacement || itemPlacement === placement || itemPlacement === (homeCms.placements && homeCms.placements[placement])
  })
}

function normalizeCmsCarousels(homeCms, placementCode) {
  const list = getCmsPlacementItems(homeCms, placementCode)

  return (list || [])
    .filter((item) => item && (item.title || item.subtitle || item.imageUrl || item.imagePath))
    .map(normalizeCmsCarousel)
    .sort((a, b) => a.sort - b.sort)
}

function normalizeCmsBadges(homeCms) {
  return normalizeCmsCarousels(homeCms, 'home_badge')
}

function normalizeCardPromoText(homeCms) {
  if (!homeCms) return ''

  const direct = homeCms.buyCardPromotion || homeCms.cardPromotion || homeCms.cardPromo || {}
  const list = homeCms.cardPromotions || homeCms.promotions || []
  const item = list.find((entry) => {
    const placement = String(entry.placementCode || entry.placement || '').toLowerCase()
    const contentType = String(entry.contentType || '').toLowerCase()
    return placement === 'home_card_promo' || placement === 'buy_card_badge' || contentType === 'card_promotion'
  }) || direct

  return item.badgeText || item.promotionText || item.title || homeCms.buyCardBadgeText || ''
}

function normalizeCmsPagePath(path) {
  const value = String(path || '')

  if (value === '/pages/sites/index' || value === 'pages/sites/index') return '/pages/map/map'
  if (value === '/pages/member/cards/index' || value === 'pages/member/cards/index') return '/pages/buy-card/buy-card'
  if (value.indexOf('/') === 0) return value
  if (value.indexOf('pages/') === 0) return `/${value}`

  return ''
}

function parseCmsLinkValue(value) {
  if (!value) return {}
  if (typeof value === 'object') return value

  const text = String(value)

  try {
    return JSON.parse(text)
  } catch (err) {
    return { value: text }
  }
}

function normalizeResumeOrder(result) {
  if (!result) return null

  const source = result.resumeOrder || result.order || result.currentOrder || result
  const targetParams = (result && result.targetParams) || (source && source.targetParams) || {}
  const orderNo = getOrderNo(source) || targetParams.orderNo
  const shouldResume = result.shouldResume !== false && source.shouldResume !== false
  const washStatus = String((source && source.washStatus) || '').toLowerCase()
  const orderStatus = String((source && source.orderStatus) || '').toLowerCase()
  const resumeStage = targetParams.resumeStage || result.resumeStage || source.resumeStage || washStatus
  const targetWashStatus = String(targetParams.washStatus || '').toLowerCase()
  const targetPageKey = result.targetPageKey || source.targetPageKey || ''
  const terminalStatuses = ['finished', 'completed', 'abnormal', 'failed', 'canceled', 'cancelled', 'closed', 'refunded']
  const finished = terminalStatuses.indexOf(washStatus) >= 0
    || terminalStatuses.indexOf(orderStatus) >= 0
    || terminalStatuses.indexOf(targetWashStatus) >= 0

  if (!shouldResume || !orderNo || finished) return null

  return Object.assign({}, source, {
    orderNo,
    prompt: result.prompt || source.prompt || null,
    targetPage: result.targetPage || source.targetPage || '/pages/washing/washing',
    targetPageKey,
    resumeStage,
    targetParams: Object.assign({}, targetParams, {
      orderNo,
      resumeStage,
      washStatus
    })
  })
}

function normalizeResumeTargetPage(page, targetPageKey, resumeStage) {
  const value = String(page || '')
  const key = String(targetPageKey || '').toLowerCase()
  const stage = String(resumeStage || '').toLowerCase()

  if (key === 'wash_confirm' || stage === 'confirm' || value.indexOf('/pages/wash-confirm') >= 0) {
    return '/pages/wash-confirm/wash-confirm'
  }

  if (
    key === 'wash_ready'
    || key === 'wash_starting'
    || stage === 'ready_to_start'
    || stage === 'starting'
    || value.indexOf('/pages/wash-ready') >= 0
    || value.indexOf('/pages/wash-starting') >= 0
  ) {
    return '/pages/wash-ready/wash-ready'
  }

  if (
    key === 'washing'
    || key === 'wash_stopping'
    || stage === 'running'
    || stage === 'runing'
    || stage === 'stopping'
    || value.indexOf('/pages/washing') >= 0
    || value.indexOf('/pages/wash-stopping') >= 0
  ) {
    return '/pages/washing/washing'
  }

  return value || '/pages/washing/washing'
}

function buildResumeTargetUrl(order) {
  const targetParams = (order && order.targetParams) || {}
  const orderNo = getOrderNo(order) || targetParams.orderNo
  const targetPage = normalizeResumeTargetPage(order && order.targetPage, order && order.targetPageKey, order && order.resumeStage)
  const query = Object.assign({}, targetParams, {
    orderNo
  })

  if (!orderNo) return ''

  const queryText = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
    .join('&')

  return queryText ? `${targetPage}?${queryText}` : targetPage
}

function createHomePage(overrides) {
  const options = {
  data: {
    user: {},
    banners: [],
    badgeImages: [],
    cardPromoText: '',
    shareInfo: defaultShareInfo,
    accountSummary: guestSummary,
    accountMetrics: buildAccountMetrics(null, null, [], null),
    lastWash: null,
    resumableOrder: null,
    orderAction: '',
    isLoggedIn: false,
    currentBanner: 0,
    hasActiveMonthCard: false,
    crownState: 'expired',
    unreadMessageCount: 0,
    phoneAuthVisible: false,
    loading: false,
    homeSizeClass: 'home-normal',
    homeViewportStyle: ''
  },

  onLoad() {
    this.updateHomeViewport()
    this.enableShareMenu()
    this.loadCmsHome()
    this.loadHomeData()
  },

  onResize() {
    this.updateHomeViewport()
  },

  onShow() {
    this.updateHomeViewport()

    if (!hasStoredSession()) {
      this.showLoggedOutState()
      return
    }

    if (this.data.isLoggedIn) {
      this.startHomeRefreshTimers(true)
    } else if (!this.data.loading) {
      this.loadHomeData()
    }
  },

  onHide() {
    this.resetOrderAction()
    this.stopHomeRefreshTimers()
  },

  onUnload() {
    this.resetOrderAction()
    this.stopHomeRefreshTimers()
  },

  updateHomeViewport() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = info.windowWidth || 375
    const windowHeight = info.windowHeight || 667
    const heightRpx = windowHeight * 750 / windowWidth
    const bottomInset = info.safeArea ? Math.max(0, windowHeight - info.safeArea.bottom) : 0
    const panelBottomGap = getPanelBottomGap(info, windowWidth, heightRpx)

    this.setData({
      homeSizeClass: getHomeSizeClass(heightRpx),
      homeViewportStyle: `height:${windowHeight}px;--safe-bottom:${bottomInset}px;--panel-bottom-gap:${panelBottomGap}rpx;`
    })
  },

  loadCmsHome() {
    api.cms.home()
      .then((homeCms) => {
        if (!homeCms) {
          this.loadCmsCarouselsFallback()
          this.loadCmsBadgeFallback()
          return
        }

        const shareInfo = normalizeCmsShare(homeCms)
        const banners = normalizeCmsCarousels(homeCms, 'home_banner')
        const badgeImages = normalizeCmsBadges(homeCms)
        const cardPromoText = normalizeCardPromoText(homeCms)
        const nextData = {
          shareInfo
        }

        if (cardPromoText) {
          nextData.cardPromoText = cardPromoText
        }

        if (banners.length) {
          nextData.banners = banners
          nextData.currentBanner = 0
        }

        if (badgeImages.length) {
          nextData.badgeImages = badgeImages
        }

        this.setData(nextData, () => {
          this.preloadShareImage(shareInfo.remoteImageUrl)
        })

        if (!banners.length) {
          this.loadCmsCarouselsFallback()
        }
        if (!badgeImages.length) {
          this.loadCmsBadgeFallback()
        }
      })
      .catch(() => {
        this.loadCmsCarouselsFallback()
        this.loadCmsBadgeFallback()
      })
  },

  loadCmsCarouselsFallback() {
    api.cms.homeCarousels({
      platform: 'wechat',
      placementCode: 'home_banner'
    })
      .then((list) => {
        const banners = normalizeCmsCarousels({
          carousels: list
        }, 'home_banner')

        if (banners.length) {
          this.setData({
            banners,
            currentBanner: 0
          })
        }
      })
      .catch(() => {})
  },

  loadCmsBadgeFallback() {
    api.cms.homeCarousels({
      platform: 'wechat',
      placementCode: 'home_badge'
    })
      .then((list) => {
        const badgeImages = normalizeCmsBadges({
          carousels: list
        })

        if (badgeImages.length) {
          this.setData({
            badgeImages
          })
        }
      })
      .catch(() => {})
  },

  preloadShareImage(imageUrl) {
    if (!imageUrl || !isRemoteImageUrl(imageUrl) || (!wx.getImageInfo && !wx.downloadFile)) return

    this.downloadShareImage(imageUrl)
      .then((localPath) => {
        const current = this.data.shareInfo || {}

        if (!localPath || current.remoteImageUrl !== imageUrl) return

        this.setData({
          'shareInfo.imageUrl': localPath
        })
      })
      .catch(() => {})
  },

  downloadShareImage(imageUrl) {
    if (this.shareImageDownloadUrl === imageUrl && this.shareImageDownloadPromise) {
      return this.shareImageDownloadPromise
    }

    this.shareImageDownloadUrl = imageUrl
    this.shareImageDownloadPromise = new Promise((resolve) => {
      const fallbackDownload = () => {
        if (!wx.downloadFile) {
          resolve('')
          return
        }

        wx.downloadFile({
          url: imageUrl,
          success: (res) => {
            resolve(res.statusCode === 200 ? (res.tempFilePath || '') : '')
          },
          fail: () => {
            resolve('')
          }
        })
      }

      if (!wx.getImageInfo) {
        fallbackDownload()
        return
      }

      wx.getImageInfo({
        src: imageUrl,
        success: (res) => {
          resolve(res.path || '')
        },
        fail: fallbackDownload
      })
    }).finally(() => {
      this.shareImageDownloadPromise = null
    })

    return this.shareImageDownloadPromise
  },

  loadHomeData() {
    this.setData({ loading: true })

    return restoreSession()
      .then(() => Promise.all([
        api.users.me().catch(() => null),
        api.wallet.get().catch(() => null),
        api.wash.resume().catch(() => null),
        api.member.cards().catch(() => []),
        api.member.temporaryCards({ activeOnly: true }).catch(() => []),
        api.coupons.mine({ status: 'available', page: 0, size: 1 }).catch(() => null),
        api.wash.list({ page: 0, size: 1 }).catch(() => null)
      ]))
      .then(([profile, wallet, resumeResult, memberCards, temporaryCards, coupons, washOrders]) => {
        const cards = (memberCards || []).concat(temporaryCards || [])
        const nextUser = Object.assign({}, this.data.user)

        if (profile) {
          nextUser.name = profile.nickname || profile.phone || nextUser.name
          nextUser.phone = profile.phone || nextUser.phone
          nextUser.avatarUrl = profile.avatarUrl
        }
        if (wallet) {
          nextUser.balance = centToYuan(wallet.balanceCent)
        }

        const hasActiveMonthCard = (cards || []).some((card) => isActiveCard(card) && isVipCard(card))
        const accountSummary = buildAccountSummary(profile, wallet, cards, coupons)
        const accountMetrics = buildAccountMetrics(profile, wallet, cards, coupons)
        const lastOrder = (washOrders && washOrders.items && washOrders.items[0]) || null

        const isLoggedIn = !!(profile && profile.phone)
        const resumableOrder = isLoggedIn ? normalizeResumeOrder(resumeResult) : null

        this.setData({
          user: nextUser,
          accountSummary,
          accountMetrics,
          hasActiveMonthCard,
          crownState: getCrownState(cards),
          isLoggedIn,
          resumableOrder
        }, () => {
          if (isLoggedIn) {
            this.startHomeRefreshTimers(false)
            this.handleResumePrompt(resumableOrder)
            this.refreshUnreadMessages(!resumableOrder)
          } else {
            this.stopHomeRefreshTimers()
          }
        })

        if (resumableOrder && resumableOrder.orderNo) {
          wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, resumableOrder.orderNo)
        } else {
          wx.removeStorageSync(STORAGE_KEYS.currentWashOrderNo)
        }

        if (!profile || !profile.phone || !lastOrder) {
          this.setData({ lastWash: null })
          return null
        }

        return this.loadLastWash(lastOrder)
      })
      .catch((err) => {
        this.showLoggedOutState()

        if (err.code !== 'AUTH_REQUIRED') {
          wx.showToast({
            title: err.message || '首页数据加载失败',
            icon: 'none'
          })
        }
      })
      .finally(() => {
        this.setData({ loading: false })
      })
  },

  showLoggedOutState() {
    this.setData({
      user: {},
      accountSummary: guestSummary,
      accountMetrics: buildAccountMetrics(null, null, [], null),
      lastWash: null,
      resumableOrder: null,
      isLoggedIn: false,
      hasActiveMonthCard: false,
      crownState: 'expired',
      unreadMessageCount: 0,
      loading: false
    })
    wx.removeStorageSync(STORAGE_KEYS.currentWashOrderNo)
    this.stopHomeRefreshTimers()
  },

  openAccountDetail(event) {
    const url = event.currentTarget.dataset.url
    if (!url) return

    wx.navigateTo({
      url,
      fail: () => {
        wx.showToast({ title: '页面打开失败', icon: 'none' })
      }
    })
  },

  loadLastWash(order) {
    return api.wash.detail(order.orderNo)
      .catch(() => order)
      .then((detail) => {
        const siteName = detail.siteName || order.siteName || '未知场地'
        const machineName = detail.machineName || order.machineName || '未知机器'
        const machineId = detail.machineId || order.machineId

        if (!machineId) {
          this.setData({
            lastWash: Object.assign({
              siteName,
              machineName,
              machineId: null
            }, normalizeMachineStatus(hasMachineStatusSnapshot(detail) ? detail : null))
          })
          return null
        }

        return api.machines.status(machineId)
          .then((machineStatus) => {
            this.setData({
              lastWash: Object.assign({
                siteName,
                machineName,
                machineId
              }, normalizeMachineStatus(machineStatus))
            })
          })
          .catch(() => {
            this.setData({
              lastWash: Object.assign({
                siteName,
                machineName,
                machineId
              }, normalizeMachineStatus(hasMachineStatusSnapshot(detail) ? detail : null))
            })
          })
      })
  },

  startHomeRefreshTimers(immediate) {
    if (!this.data.isLoggedIn) return

    if (!this.machineStatusTimer) {
      this.machineStatusTimer = setInterval(() => {
        this.refreshLastMachineStatus()
      }, HOME_MACHINE_STATUS_INTERVAL)
    }

    if (!this.resumeRefreshTimer) {
      this.resumeRefreshTimer = setInterval(() => {
        this.refreshResumeOrder(false)
      }, HOME_RESUME_REFRESH_INTERVAL)
    }

    if (!this.accountRefreshTimer) {
      this.accountRefreshTimer = setInterval(() => {
        this.refreshAccountSummary()
      }, HOME_ACCOUNT_REFRESH_INTERVAL)
    }

    if (!this.messageRefreshTimer) {
      this.messageRefreshTimer = setInterval(() => {
        this.refreshUnreadMessages(true)
      }, HOME_MESSAGE_REFRESH_INTERVAL)
    }

    if (immediate) {
      this.refreshResumeOrder(true)
      this.refreshLastMachineStatus()
      this.refreshAccountSummary()
      this.refreshUnreadMessages(!this.data.resumableOrder)
    }
  },

  stopHomeRefreshTimers() {
    if (this.machineStatusTimer) {
      clearInterval(this.machineStatusTimer)
      this.machineStatusTimer = null
    }

    if (this.accountRefreshTimer) {
      clearInterval(this.accountRefreshTimer)
      this.accountRefreshTimer = null
    }

    if (this.resumeRefreshTimer) {
      clearInterval(this.resumeRefreshTimer)
      this.resumeRefreshTimer = null
    }

    if (this.messageRefreshTimer) {
      clearInterval(this.messageRefreshTimer)
      this.messageRefreshTimer = null
    }
  },

  refreshUnreadMessages(showPrompt) {
    if (!this.data.isLoggedIn || this.messageRefreshing) return Promise.resolve(null)

    this.messageRefreshing = true
    return api.messages.unreadSummary()
      .then((summary) => {
        const unreadCount = Number((summary && summary.unreadCount) || 0)
        const latest = summary && summary.latestUnreadMessage
        this.setData({ unreadMessageCount: unreadCount })
        this.syncMessageBadge(unreadCount)

        if (showPrompt && latest && latest.messageType === 'coupon_issued') {
          this.showCouponArrivalMessage(latest)
        }
        return summary
      })
      .catch(() => null)
      .finally(() => {
        this.messageRefreshing = false
      })
  },

  syncMessageBadge(count) {
    const value = Number(count || 0)
    if (value > 0) {
      wx.setTabBarBadge({ index: 2, text: value > 99 ? '99+' : String(value), fail: () => {} })
      return
    }
    wx.removeTabBarBadge({ index: 2, fail: () => {} })
  },

  showCouponArrivalMessage(message) {
    const messageId = message && (message.messageId || message.id)
    const shownIds = wx.getStorageSync(STORAGE_KEYS.shownMessageIds) || []
    const normalizedIds = Array.isArray(shownIds) ? shownIds.map(String) : []

    if (!messageId || normalizedIds.indexOf(String(messageId)) >= 0 || this.messagePrompting || this.resumePrompting) return

    this.messagePrompting = true
    wx.setStorageSync(STORAGE_KEYS.shownMessageIds, normalizedIds.concat(String(messageId)).slice(-50))
    wx.showModal({
      title: message.title || '洗车券已到账',
      content: message.content || '你收到了一张新的洗车券，可在“我的洗车券”中查看。',
      confirmText: '查看洗车券',
      cancelText: '知道了',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/coupons/coupons' })
        }
      },
      complete: () => {
        api.messages.read(messageId)
          .then(() => Promise.all([
            api.messages.unreadSummary().catch(() => null),
            this.refreshAccountSummary()
          ]))
          .then(([summary]) => {
            const count = Number((summary && summary.unreadCount) || 0)
            this.setData({ unreadMessageCount: count })
            this.syncMessageBadge(count)
          })
          .catch(() => {})
          .finally(() => {
            this.messagePrompting = false
          })
      }
    })
  },

  refreshResumeOrder(shouldPrompt) {
    if (!this.data.isLoggedIn || this.resumeRefreshing) return Promise.resolve(null)

    this.resumeRefreshing = true

    return api.wash.resume()
      .then((result) => {
        const resumableOrder = normalizeResumeOrder(result)

        if (resumableOrder && resumableOrder.orderNo) {
          wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, resumableOrder.orderNo)
          this.setData({ resumableOrder }, () => {
            if (shouldPrompt) {
              this.handleResumePrompt(resumableOrder)
            }
          })
          return resumableOrder
        }

        this.clearResumableOrder()
        return null
      })
      .catch(() => null)
      .finally(() => {
        this.resumeRefreshing = false
      })
  },

  clearResumableOrder() {
    if (this.data.resumableOrder) {
      this.setData({ resumableOrder: null })
    }

    wx.removeStorageSync(STORAGE_KEYS.currentWashOrderNo)
  },

  handleResumePrompt(order) {
    const orderNo = getOrderNo(order)
    const prompt = (order && order.prompt) || {}

    if (!orderNo || this.resumePrompting || this.data.orderAction) return

    this.resumePrompting = true

    wx.showModal({
      title: prompt.title || '你有一笔洗车正在进行',
      content: prompt.message || '是否继续进入洗车页面？',
      confirmText: prompt.confirmText || '继续洗车',
      cancelText: prompt.cancelText || '稍后处理',
      success: (res) => {
        if (res.confirm) {
          this.enterResumeOrder(order)
        }
      },
      complete: () => {
        this.resumePrompting = false
      }
    })
  },

  enterResumeOrder(order) {
    const orderNo = getOrderNo(order || this.data.resumableOrder)
    const targetUrl = buildResumeTargetUrl(order || this.data.resumableOrder)

    if (!orderNo || !targetUrl) return

    wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, orderNo)
    wx.navigateTo({
      url: targetUrl
    })
  },

  resetOrderAction() {
    if (this.orderActionTimer) clearTimeout(this.orderActionTimer)
    this.orderActionTimer = null
    if (this.resolveOrderAnimation) this.resolveOrderAnimation(false)
    this.resolveOrderAnimation = null
    this.setData({ orderAction: '' })
  },

  animateOrderAction(action) {
    this.setData({ orderAction: action })
    return new Promise((resolve) => {
      this.resolveOrderAnimation = resolve
      this.orderActionTimer = setTimeout(() => {
        this.orderActionTimer = null
        this.resolveOrderAnimation = null
        resolve(true)
      }, 480)
    })
  },

  continueHomeWash() {
    if (this.data.orderAction || !this.data.resumableOrder) return
    const order = this.data.resumableOrder
    this.animateOrderAction('continue').then((active) => {
      if (!active) return
      const url = buildResumeTargetUrl(order)
      if (!url) return this.resetOrderAction()
      wx.navigateTo({ url, complete: () => this.resetOrderAction() })
    })
  },

  finishHomeWash() {
    if (this.data.orderAction || !this.data.resumableOrder) return
    const orderNo = getOrderNo(this.data.resumableOrder)
    if (!orderNo) return
    this.animateOrderAction('finish').then((active) => {
      if (!active) return
      wx.showModal({
        title: '结束洗车',
        content: '确定结束本次洗车并结算吗？',
        confirmText: '结束洗车',
        success: (res) => {
          if (!res.confirm) return this.resetOrderAction()
          api.wash.stop(orderNo, {
            clientRequestId: makeClientRequestId('mini-home-stop'),
            reason: 'user_stop'
          }).then((result) => {
            const target = getResumeTarget(Object.assign({}, result, { orderNo }))
            if (target && target.page === 'wash-finish') this.clearResumableOrder()
            wx.navigateTo({
              url: target && target.page === 'wash-finish'
                ? target.url
                : `/pages/washing/washing?orderNo=${encodeURIComponent(orderNo)}`,
              complete: () => this.resetOrderAction()
            })
          }).catch((err) => {
            this.resetOrderAction()
            wx.showModal({ title: '结束洗车失败', content: err.message || '请稍后重试', showCancel: false })
          })
        },
        fail: () => this.resetOrderAction()
      })
    })
  },

  refreshLastMachineStatus() {
    const lastWash = this.data.lastWash
    const machineId = lastWash && lastWash.machineId

    if (!this.data.isLoggedIn || !machineId || this.machineStatusRefreshing) return

    this.machineStatusRefreshing = true
    api.machines.status(machineId)
      .then((machineStatus) => {
        const current = this.data.lastWash

        if (!current || String(current.machineId) !== String(machineId)) return

        const normalized = normalizeMachineStatus(machineStatus)

        this.setData({
          'lastWash.statusText': normalized.statusText,
          'lastWash.statusClass': normalized.statusClass
        })
      })
      .catch(() => {})
      .finally(() => {
        this.machineStatusRefreshing = false
      })
  },

  refreshAccountSummary() {
    if (!this.data.isLoggedIn || this.accountRefreshing) return

    this.accountRefreshing = true
    Promise.all([
      api.wallet.get().catch(() => null),
      api.member.cards().catch(() => []),
      api.member.temporaryCards({ activeOnly: true }).catch(() => []),
      api.coupons.mine({ status: 'available', page: 0, size: 1 }).catch(() => null)
    ])
      .then(([wallet, memberCards, temporaryCards, coupons]) => {
        const cards = (memberCards || []).concat(temporaryCards || [])
        const profile = this.data.user
        const nextUser = Object.assign({}, this.data.user)

        if (wallet) {
          nextUser.balance = centToYuan(wallet.balanceCent)
        }

        this.setData({
          user: nextUser,
          accountSummary: buildAccountSummary(profile, wallet, cards, coupons),
          accountMetrics: buildAccountMetrics(profile, wallet, cards, coupons),
          hasActiveMonthCard: (cards || []).some((card) => isActiveCard(card) && isVipCard(card)),
          crownState: getCrownState(cards)
        })
      })
      .catch(() => {})
      .finally(() => {
        this.accountRefreshing = false
      })
  },

  onBannerChange(event) {
    this.setData({
      currentBanner: event.detail.current
    })
  },

  handleBannerTap(event) {
    this.handleBannerAction(event)
  },

  handleBannerAction(event) {
    const index = Number(event.currentTarget.dataset.index || 0)
    const banner = (this.data.banners || [])[index]

    this.openCmsLink(banner)
  },

  handleBadgeTap(event) {
    const index = Number(event.currentTarget.dataset.index || 0)
    const badge = (this.data.badgeImages || [])[index]

    this.openCmsLink(badge)
  },

  openCmsLink(item) {
    if (!item) return

    const linkType = String(item.linkType || '').toLowerCase()
    const contentType = String(item.contentType || '').toLowerCase()
    const linkInfo = parseCmsLinkValue(item.linkValue)
    const linkValue = linkInfo.pagePath || linkInfo.path || linkInfo.url || linkInfo.value || item.linkValue || ''

    if (linkType === 'none') return

    if (linkType === 'member_products' || linkType === 'buy_card' || contentType === 'card_promotion') {
      this.buyCard()
      return
    }

    if (linkType === 'scan') {
      this.scanMachine()
      return
    }

    if (linkType === 'page' || linkType === 'mini_page' || linkType === 'static_page') {
      const pagePath = normalizeCmsPagePath(linkValue)

      if (!pagePath) return

      if (pagePath === '/pages/home/home' || pagePath === '/pages/map/map' || pagePath === '/pages/mine/mine') {
        wx.switchTab({ url: pagePath })
        return
      }

      wx.navigateTo({
        url: pagePath,
        fail: () => {}
      })
      return
    }

    if (linkType === 'h5' || linkType === 'webview' || linkType === 'web_view') {
      const url = linkInfo.url || linkValue

      if (!url) return

      wx.navigateTo({
        url: `/pages/webview/webview?url=${encodeURIComponent(url)}&title=${encodeURIComponent(item.title || '')}`,
        fail: () => {
          wx.setClipboardData({
            data: url,
            success: () => {
              wx.showToast({
                title: '链接已复制',
                icon: 'none'
              })
            }
          })
        }
      })
      return
    }

    if (linkType === 'other_mini_program' || linkType === 'mini_program') {
      const appId = linkInfo.appId || linkInfo.appid || ''

      if (!appId || !wx.navigateToMiniProgram) return

      wx.navigateToMiniProgram({
        appId,
        path: linkInfo.path || '',
        extraData: linkInfo.extraData || {},
        envVersion: linkInfo.envVersion || 'release',
        fail: () => {}
      })
    }
  },

  requirePhone(action) {
    this.authAfterSuccess = action

    if (!hasStoredSession()) {
      this.setData({ phoneAuthVisible: true })
      return Promise.resolve()
    }

    return ensurePhoneBound()
      .then(() => {
        const nextAction = this.authAfterSuccess
        this.authAfterSuccess = null

        if (nextAction) {
          nextAction()
        }
      })
      .catch((err) => {
        if (err.code === 'PHONE_REQUIRED') {
          this.setData({ phoneAuthVisible: true })
          return
        }

        this.authAfterSuccess = null
        wx.showToast({
          title: err.message || '登录失败',
          icon: 'none'
        })
      })
  },

  openScanPage() {
    wx.navigateTo({
      url: '/pages/scan/scan'
    })
  },

  scanMachine() {
    this.requirePhone(() => {
      if (this.data.resumableOrder) {
        this.enterResumeOrder(this.data.resumableOrder)
        return
      }

      this.openScanPage()
    })
  },

  onPhoneAuthSuccess() {
    const nextAction = this.authAfterSuccess

    this.setData({ phoneAuthVisible: false })
    this.loadHomeData()
      .finally(() => {
        this.authAfterSuccess = null

        if (nextAction) {
          nextAction()
        }
      })
  },

  onPhoneAuthCancel() {
    this.authAfterSuccess = null
    this.setData({ phoneAuthVisible: false })
  },

  enableShareMenu() {
    if (!wx.showShareMenu) return

    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })
  },

  buildShareInfo() {
    const cmsShare = this.data.shareInfo || {}
    const banner = (this.data.banners && this.data.banners[this.data.currentBanner]) || {}
    const imageUrl = cmsShare.imageUrl || ''
    const info = {
      title: cmsShare.title || banner.shareTitle || defaultShareInfo.title,
      path: cmsShare.path || defaultShareInfo.path
    }

    if (imageUrl) {
      info.imageUrl = imageUrl
    }

    return info
  },

  onShareAppMessage() {
    const shareInfo = this.data.shareInfo || {}

    if (!shareInfo.imageUrl && shareInfo.remoteImageUrl) {
      this.preloadShareImage(shareInfo.remoteImageUrl)
    }

    return this.buildShareInfo()
  },

  onShareTimeline() {
    const currentShare = this.data.shareInfo || {}

    if (!currentShare.imageUrl && currentShare.remoteImageUrl) {
      this.preloadShareImage(currentShare.remoteImageUrl)
    }

    const shareInfo = this.buildShareInfo()
    const timelineInfo = {
      title: shareInfo.title,
      query: ''
    }

    if (shareInfo.imageUrl) {
      timelineInfo.imageUrl = shareInfo.imageUrl
    }

    return timelineInfo
  },

  buyCard() {
    wx.navigateTo({
      url: '/pages/buy-card/buy-card'
    })
  }
  }

  return Object.assign(options, overrides || {})
}

module.exports = createHomePage
