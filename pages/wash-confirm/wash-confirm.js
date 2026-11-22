const api = require('../../utils/api')
const { registerOrder } = require('../../utils/review-mode')
const { ensurePhoneBound } = require('../../utils/auth')
const { STORAGE_KEYS } = require('../../utils/config')
const { getWashLocation } = require('../../utils/location')
const { centToYuan, parseMachineMid, secToText } = require('../../utils/format')
const { requestPayment, confirmPayment, isPaymentSuccess, getPayOrderNo } = require('../../utils/payment')
const { isWashRunning, navigateToOrder, redirectToOrder } = require('../../utils/wash-route')


function inferCardKind(card) {
  const cardKind = String((card && card.cardKind) || '').toLowerCase()
  const productType = String((card && (card.productType || card.productTypeCode)) || '').toLowerCase()
  const name = String((card && card.name) || '')

  if (cardKind) return cardKind
  if (productType.indexOf('wash_card') >= 0 || name.indexOf('洗车卡') >= 0) return 'wash_card'
  if (productType.indexOf('single_card') >= 0 || name.indexOf('次卡') >= 0) return 'single_card'
  if (productType.indexOf('member_') >= 0 || name.indexOf('月卡') >= 0 || name.indexOf('会员') >= 0) return 'monthly_member'

  return ''
}

function formatDate(value) {
  if (!value) return '长期有效'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '长期有效'

  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

function getCardDesc(card) {
  const cardKind = inferCardKind(card)

  if (cardKind === 'wash_card') return `余额${centToYuan(card.remainingAmountCent)}元`
  if (cardKind === 'single_card') return `剩余${card.remainingTimes || 0}次`
  if (card.remainingDurationSec) return `剩余${secToText(card.remainingDurationSec)}`

  return '可用'
}

function normalizeCoupon(item) {
  return {
    couponId: item.couponId,
    sourceType: item.sourceType,
    minutes: Number(item.minutes || 0),
    name: item.name || '洗车券',
    detailText: item.detailText || (item.minutes ? `可抵扣${item.minutes}分钟洗车` : '可用于本次洗车'),
    expireText: `到期时间：${formatDate(item.expireAt)}`,
    canUse: item.canUse === true || item.canUse === 1,
    unavailableReason: item.unavailableReason || ''
  }
}

function normalizeCard(item) {
  const cardKind = inferCardKind(item)

  return {
    cardId: item.cardId,
    sourceSiteId: item.sourceSiteId,
    cardKind,
    name: item.name || '会员卡',
    desc: getCardDesc(item),
    remainingAmountCent: Number(item.remainingAmountCent || 0),
    remainingTimes: Number(item.remainingTimes || 0),
    remainingDurationSec: Number(item.remainingDurationSec || 0),
    expireText: `到期时间：${formatDate(item.validTo || item.expireAt)}`,
    remainingDurationText: item.remainingDurationSec ? `剩余洗车时间：${secToText(item.remainingDurationSec)}` : '',
    canUse: item.canUse !== false && item.status !== 'expired',
    unavailableReason: item.unavailableReason || ''
  }
}

function normalizeRechargePackage(item) {
  const payAmountCent = Number(item.payAmountCent || item.amountCent || 0)
  const giftAmountCent = Number(item.giftAmountCent || 0)
  const giftText = giftAmountCent ? `，赠送${centToYuan(giftAmountCent)}元` : ''

  return {
    packageId: item.packageId,
    name: item.name || `充值${centToYuan(payAmountCent)}元`,
    actionText: `${item.name || `充值${centToYuan(payAmountCent)}元`}${giftText}`,
    payAmountCent,
    disabled: item.status && item.status !== 'enabled'
  }
}

function normalizePaymentSite(item) {
  return Object.assign({}, item, {
    siteId: item.siteId || item.id,
    siteName: item.siteName || item.name || '洗车场地'
  })
}

function pricingNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function formatSitePricing(pricing) {
  const source = pricing || {}
  const durationSec = pricingNumber(source.defaultDurationSec)
  const startMinutes = pricingNumber(source.startMinutes)
  const minutes = startMinutes !== null ? startMinutes : (durationSec !== null ? durationSec / 60 : null)
  const startPrice = pricingNumber(source.startPriceCent)
  const amount = startPrice !== null ? startPrice : pricingNumber(source.defaultAmountCent)
  const minutePrice = pricingNumber(source.minutePriceCent)
  const rate = minutePrice !== null ? `${centToYuan(minutePrice)}元/分钟` : ''
  if (minutes !== null && minutes > 0 && amount !== null) {
    return `${minutes}分钟内${centToYuan(amount)}元，${rate ? `超出按${rate}计费` : '超出费用以场地规则为准'}`
  }
  if (rate) return `按${rate}计费`
  return '计费信息暂不可用，请重新扫码'
}

const { machineAvailability } = require('../../utils/machine-availability')

Page({
  data: {
    serviceTop: 34,
    user: { balance: '0' },
    machine: {
      id: '',
      siteId: '',
      siteName: '',
      servicePhone: '',
      name: '',
      status: '',
      onlineStatus: '',
      onlineText: '未知',
      statusText: '状态待确认',
      statusClass: 'unknown',
      available: false,
      balanceRate: '',
      cardRule: '',
      maxMinutes: 0
    },
    scanInfo: null,
    phoneAuthVisible: false,
    purchasePromptPreview: true,
    membershipSupport: 'unknown',
    assetSheetOffset: 0,
    assetSheetDragging: false,
    reviewMode: false,
    mid: '',
    qrId: '',
    priceText: '加载中',
    ruleText: '',
    selectedPayMethod: '',
    selectedPayment: null,
    checkoutReady: false,
    checkoutPolicy: { enabledGroups: ['card_coupon', 'stored_value', 'group_buy'] },
    walletBalanceCent: 0,
    walletBalanceText: '0',
    coupons: [],
    washCards: [],
    memberCards: [],
    monthlyCards: [],
    singleCards: [],
    rechargePackages: [],
    paymentSites: [],
    rechargeSite: null,
    paymentSitesLoading: true,
    assetPanelVisible: false,
    assetPanelType: '',
    assetPanelTitle: '',
    locationConfirmed: false,
    starting: false,
    contactingService: false,
    rulesExpanded: true,
    groupBuyEntries: [],
    hasGroupBuyEntries: false,
    redeemedPlatforms: {},
    groupBuyError: false,
    payMethods: []
  },

  onLoad(options) {
    this.entryOptions = Object.assign({}, options || {})
    this.setData({
      serviceTop: 34
    })

    if (options && options.review === '1') {
      this.setData({ reviewMode: true })
      api.review.status().then((status) => {
        if (!status.reviewMode || status.expired || !status.enabled) throw new Error('模拟洗车未启用，请返回首页重新进入')
        const scan = wx.getStorageSync('reviewScanInfo')
        if (!scan || scan.reviewMode !== true || scan.scanSuccess !== true) throw new Error('缺少模拟设备信息，请返回首页重新进入')
        this.setData({
          scanInfo: scan,
          machine: {
            siteName: status.developerMode ? '开发测试模拟场地' : '审核体验模拟场地', name: scan.machine.name,
            onlineStatus: 'online', onlineText: '模拟在线', statusText: '空闲', statusClass: 'online', available: true,
            balanceRate: '每分钟1元，无起步价，暂停不计费',
            cardRule: '每分钟1元，无起步价，暂停不计费', maxMinutes: 0
          },
          walletBalanceCent: status.balanceCent,
          walletBalanceText: centToYuan(status.balanceCent),
          selectedPayMethod: 'wallet',
          selectedPayment: { uiKey: 'wallet', payMethod: 'wallet', desc: '虚拟体验余额' },
          paymentSitesLoading: false
        }, () => this.refreshPayMethods())
      }).catch((err) => this.showOrderError(err))
      return
    }

    this.guardConfirmAccess()
  },

  guardConfirmAccess() {
    if (this.accessPromise) return this.accessPromise
    const pending = ensurePhoneBound().then(() => {
      this.confirmAuthorized = true
      this.setData({ phoneAuthVisible: false })
      return this.loadConfirmData()
    }).catch((err) => {
      this.confirmAuthorized = false
      this.stopMachineStatusRefresh()
      if (err.code === 'PHONE_REQUIRED' || err.code === 'AUTH_REQUIRED' || err.code === 'UNAUTHORIZED') {
        this.setData({ phoneAuthVisible: true })
      } else {
        wx.showModal({ title: '登录状态检查失败', content: err.message || '请检查网络后重新尝试', showCancel: false })
      }
    }).finally(() => { if (this.accessPromise === pending) this.accessPromise = null })
    this.accessPromise = pending
    return pending
  },

  onPhoneAuthSuccess() {
    this.setData({ phoneAuthVisible: false })
    this.guardConfirmAccess()
  },

  onPhoneAuthCancel() {
    this.setData({ phoneAuthVisible: false })
    wx.showModal({
      title: '登录后继续洗车',
      content: '本次扫码信息已保留，登录后可继续选择结算方式。',
      confirmText: '重新登录', cancelText: '返回首页',
      success: (result) => {
        if (result.confirm) this.setData({ phoneAuthVisible: true })
        else wx.switchTab({ url: '/pages/home/home' })
      }
    })
  },

  loadConfirmData() {
    return this.reloadWallet()
      .catch(() => wx.showToast({ title: '余额刷新失败，请稍后重试', icon: 'none' }))
      .finally(() => {
        return this.loadScanInfo()
      })
  },

  onShow() {
    this.confirmVisible = true
    this.startMachineStatusRefresh()
    if (this.data.machine.siteId) this.loadGroupBuyEntries()
    if (!this.data.reviewMode && this.data.machine.siteId) this.loadMembershipSupport()
    // 从购卡/充值页返回时刷新权益，但不覆盖用户已经明确选择的卡券。
    if (!this.data.reviewMode && this.data.scanInfo) {
      if (this.pendingRechargePayOrderNo) this.resumeRechargeConfirmation().catch(() => {})
      else this.reloadWallet().catch(() => {}).finally(() => this.loadAccountAssets(this.data.scanInfo))
    }
  },

  onHide() {
    this.confirmVisible = false
    this.stopMachineStatusRefresh()
  },

  onUnload() {
    this.freeWashDisposed = true
    this.assetRequestId = (this.assetRequestId || 0) + 1
    this.membershipRequestId = (this.membershipRequestId || 0) + 1
    if (this.assetSheetTimer) clearTimeout(this.assetSheetTimer)
    this.confirmVisible = false
    this.stopMachineStatusRefresh()
    this.groupBuyRequestVersion = (this.groupBuyRequestVersion || 0) + 1
  },

  stopMachineStatusRefresh() {
    if (this.machineStatusTimer) clearInterval(this.machineStatusTimer)
    this.machineStatusTimer = null
    this.machineStatusVersion = (this.machineStatusVersion || 0) + 1
    this.machineStatusPromise = null
  },

  loadMembershipSupport() {
    const siteId = this.data.machine.siteId
    if (!siteId) return
    const version = this.membershipRequestId = (this.membershipRequestId || 0) + 1
    return api.sites.detail(siteId).then((site) => {
      if (version !== this.membershipRequestId || String(siteId) !== String(this.data.machine.siteId)) return
      const option = (site.billingOptions || []).find((item) => item.code === 'monthly_member')
      this.setData({ membershipSupport: option && typeof option.supported === 'boolean' ? (option.supported ? 'supported' : 'unsupported') : 'unknown' })
    }).catch(() => {
      if (version === this.membershipRequestId) this.setData({ membershipSupport: 'unknown' })
    })
  },

  startMachineStatusRefresh() {
    if (!this.confirmAuthorized || !this.confirmVisible || this.data.reviewMode || !this.data.machine.id) return
    this.refreshMachineStatus().catch(() => {})
    if (!this.machineStatusTimer) {
      this.machineStatusTimer = setInterval(() => {
        if (!this.data.starting) this.refreshMachineStatus().catch(() => {})
      }, 3000)
    }
  },

  refreshMachineStatus() {
    if (this.machineStatusPromise) return this.machineStatusPromise
    const machineId = this.data.machine.id
    const version = this.machineStatusVersion || 0
    const current = () => this.confirmVisible && version === (this.machineStatusVersion || 0) && String(machineId) === String(this.data.machine.id)
    const pending = api.machines.status(machineId).then((snapshot) => {
      if (!current()) throw new Error('页面状态已变化，请重新操作')
      const presentation = machineAvailability(snapshot)
      this.setData({
        machine: Object.assign({}, this.data.machine, presentation, { status: snapshot.machineStatus }),
        takeoverStatusUnavailable: false,
        scanInfo: Object.assign({}, this.data.scanInfo, { machine: Object.assign({}, this.data.scanInfo.machine, snapshot, { available: presentation.available }) })
      })
      if (this.data.takeoverWaiting && presentation.available && snapshot.machineStatus === 'idle') {
        this.setData({ takeoverWaiting: false })
        this.loadScanInfo()
      }
      return presentation
    }).catch((err) => {
      if (current()) this.setData({ takeoverStatusUnavailable: true, 'machine.statusText': '状态获取失败', 'machine.statusClass': 'unknown', 'machine.onlineText': '连接待确认', 'machine.onlineStatus': '', 'machine.available': false })
      throw err
    }).finally(() => {
      if (this.machineStatusPromise === pending) this.machineStatusPromise = null
    })
    this.machineStatusPromise = pending
    return pending
  },

  buildGroupBuyEntries(result) {
    const enabled = this.data.reviewMode || (this.data.checkoutReady && this.checkoutEnabled('group_buy'))
    const platforms = ['meituan', 'douyin']
      .filter((platform) => enabled && result && result[platform] && result[platform].showButton === true)
    const hasGroupBuyEntries = platforms.length > 0
    const groupBuyEntries = platforms
      .map((platform) => ({ platform, title: platform === 'meituan' ? '美团核销' : '抖音核销', redeemed: !!this.data.redeemedPlatforms[platform] }))
    return { groupBuyEntries, hasGroupBuyEntries }
  },

  loadGroupBuyEntries() {
    const siteId = this.data.machine.siteId
    if (!siteId) return
    const version = this.groupBuyRequestVersion = (this.groupBuyRequestVersion || 0) + 1
    this.setData({ ...this.buildGroupBuyEntries(null), groupBuyError: false })
    return api.groupBuy.entries(siteId)
      .then((result) => {
        if (version !== this.groupBuyRequestVersion || String(siteId) !== String(this.data.machine.siteId)) return
        this.setData(this.buildGroupBuyEntries(result))
      })
      .catch(() => {
        if (version === this.groupBuyRequestVersion) this.setData({ ...this.buildGroupBuyEntries(null), groupBuyError: true })
      })
  },

  openGroupBuy(event) {
    if (this.data.takeoverWaiting || this.data.takeoverPending) return
    const platform = event.currentTarget.dataset.platform
    if (!this.data.groupBuyEntries.some((item) => item.platform === platform)) return
    const siteId = this.data.machine.siteId
    const mid = this.data.scanInfo && (this.data.scanInfo.mid || this.data.scanInfo.qrId)
    if (!mid) return wx.showToast({ title: '请先扫码选择洗车机', icon: 'none' })
    wx.navigateTo({
      url: `/pages/group-buy-redeem/group-buy-redeem?siteId=${encodeURIComponent(siteId)}&platform=${platform}&mid=${encodeURIComponent(mid)}&locationConfirm=${this.data.locationConfirmed ? 1 : 0}`,
      events: {
        redeemed: (receipt) => {
          if (String(receipt.siteId) !== String(this.data.machine.siteId) || receipt.platform !== platform) return
          if (receipt.redemptionType === 'site_credit') {
            this.setData({ siteCreditRefreshPending: true })
            this.refreshSiteCredit()
            return
          }
          this.setData({ redeemedPlatforms: Object.assign({}, this.data.redeemedPlatforms, { [platform]: true }) })
          this.loadGroupBuyEntries()
          this.loadAccountAssets(this.data.scanInfo)
          wx.showToast({ title: '验券成功', icon: 'success' })
        }
      }
    })
  },

  backHome() {
    wx.navigateBack({
      fail() {
        wx.redirectTo({
          url: '/pages/home/home'
        })
      }
    })
  },

  async contactService() {
    if (this.data.contactingService) return
    this.setData({ contactingService: true })
    try {
      let phone = this.data.machine.servicePhone
      if (!phone && this.data.machine.siteId) {
        const site = await api.sites.detail(this.data.machine.siteId)
        // Public site APIs must expose the franchisee phone, not the user's phone.
        phone = site && site.franchiseePartnerPhone
      }
      const phoneNumber = String(phone || '').trim().replace(/[\s-]/g, '')
      if (!phoneNumber) {
        wx.showModal({
          title: '联系官方客服',
          content: '该场地暂未绑定客服电话。如需帮助，可前往“我的”页面，点击“联系客服”与官方客服沟通。',
          confirmText: '前往我的',
          cancelText: '暂不前往',
          success(res) {
            if (res.confirm) {
              wx.switchTab({ url: '/pages/mine/mine' })
            }
          }
        })
        return
      }
      if (!/^\+?\d{6,20}$/.test(phoneNumber)) {
        wx.showToast({ title: '场地联系电话无效，请联系平台处理', icon: 'none' })
        return
      }
      await new Promise((resolve, reject) => {
        wx.makePhoneCall({ phoneNumber, success: resolve, fail: reject })
      })
    } catch (err) {
      if (!/cancel/i.test(String(err.errMsg || ''))) {
        wx.showToast({ title: err.errMsg ? '无法拨号，请检查设备是否支持电话功能' : (err.message || '联系电话获取失败，请稍后重试'), icon: 'none' })
      }
    } finally {
      this.setData({ contactingService: false })
    }
  },

  toggleRules() {
    this.setData({
      rulesExpanded: !this.data.rulesExpanded
    })
  },

  noop() {},

  loadScanInfo() {
    this.scanLoadError = null
    const options = this.entryOptions || {}
    let scanCode = options.mid || options.qrId || options.qr_id || options.q || options.scene || ''
    if (scanCode) {
      try { scanCode = decodeURIComponent(scanCode) } catch (_) {}
      if (!scanCode.includes('?') && /^(mid|qrId|qr_id)=/.test(scanCode)) scanCode = `?${scanCode}`
    }
    const cached = wx.getStorageSync(STORAGE_KEYS.lastScan)

    if (!scanCode && cached && cached.machine) {
      // 重新取服务端策略和机器状态，不能让缓存中的旧距离确认继续拦截。
      scanCode = cached.mid || cached.qrId || ''
    }

    if (!scanCode) {
      wx.showToast({
        title: '缺少扫码信息，请重新扫码',
        icon: 'none'
      })
      return
    }

    const mid = parseMachineMid(scanCode)
    if (!mid) {
      wx.showToast({ title: '二维码信息无效，请重新扫码', icon: 'none' })
      return
    }

    wx.showLoading({ title: '加载机器信息' })
    return getWashLocation()
      .then((location) => api.scan.resolve({
        mid,
        lat: location.latitude,
        lng: location.longitude
      }))
      .then((scanInfo) => {
        const resolvedScanInfo = Object.assign({}, scanInfo, {
          mid: scanInfo.mid || scanInfo.qrId || parseMachineMid(scanCode)
        })
        wx.setStorageSync(STORAGE_KEYS.lastScan, resolvedScanInfo)
        this.applyScanInfo(resolvedScanInfo)
      })
      .catch((err) => {
        this.scanLoadError = err
        if (['LOCATION_DENIED', 'LOCATION_UNAVAILABLE', 'LOCATION_REQUIRED'].indexOf(err.code) >= 0) {
          this.showOrderError(err)
          return
        }
        wx.showToast({
          title: err.message || '机器信息加载失败',
          icon: 'none'
        })
      })
      .finally(() => {
        wx.hideLoading()
      })
  },

  applyScanInfo(scanInfo) {
    if (scanInfo.resumeOrder && scanInfo.resumeOrder.shouldResume && redirectToOrder(scanInfo.resumeOrder)) {
      return
    }

    const defaultAmountCent = (scanInfo.pricing && scanInfo.pricing.defaultAmountCent) || 0
    const defaultDurationSec = (scanInfo.pricing && scanInfo.pricing.defaultDurationSec) || 0
    const billingRule = formatSitePricing(scanInfo.pricing)
    this.setData({
      scanInfo,
      takeoverWaiting: scanInfo.machine.takeoverWaiting === true,
      takeoverStatusUnavailable: false,
      mid: scanInfo.mid || scanInfo.qrId,
      qrId: scanInfo.qrId,
      machine: {
        id: scanInfo.machine.machineId,
        siteId: scanInfo.site && (scanInfo.site.siteId || scanInfo.site.id),
        siteName: scanInfo.site.name,
        servicePhone: scanInfo.site.servicePhone || scanInfo.site.franchiseePartnerPhone || '',
        name: scanInfo.machine.name,
        status: scanInfo.machine.machineStatus,
        onlineStatus: '',
        onlineText: '连接待确认',
        statusText: '状态查询中',
        statusClass: 'unknown',
        available: false,
        balanceRate: billingRule,
        cardRule: billingRule,
        maxMinutes: Math.round(Number((scanInfo.pricing && scanInfo.pricing.maxDurationSec) || 0) / 60)
      },
      priceText: `${centToYuan(defaultAmountCent)}元`,
      ruleText: defaultDurationSec ? `默认时长${Math.round(defaultDurationSec / 60)}分钟` : '按后台计费规则结算',
      selectedPayMethod: '',
      selectedPayment: null,
      freeWashPreparationError: '',
      hasFreeWashActivities: false,
      locationConfirmed: false
    })

    this.loadAccountAssets(scanInfo)
    this.setData({ membershipSupport: 'unknown' })
    this.loadMembershipSupport()
    this.stopMachineStatusRefresh()
    this.startMachineStatusRefresh()
    this.setData({ redeemedPlatforms: {} })
    this.loadGroupBuyEntries()
  },

  prepareFreeWash(scanInfo, siteId, policy, requestId) {
    if (this.data.reviewMode || !siteId || !policy?.enabledGroups?.includes('card_coupon')) {
      return Promise.resolve({ activities: [], couponId: null })
    }
    // Several page lifecycle callbacks refresh assets. Share the in-flight claim for the same scan.
    if (this.freeWashPreparation?.scanInfo === scanInfo) return this.freeWashPreparation.promise
    const preparation = { scanInfo }
    preparation.promise = api.freeWash.list(siteId).then(async result => {
      const activities = Array.isArray(result.items) ? result.items : []
      const activity = activities.find(item => item.activityType === 'FREE_WASH')
      if (!activity || this.freeWashDisposed || this.data.scanInfo !== scanInfo || this.data.selectedPayment ||
          !(scanInfo.machine.available === true || this.data.machine.available === true) ||
          this.data.takeoverWaiting || this.data.takeoverPending) return { activities, couponId: null }
      try {
        const grant = await api.freeWash.claim(activity.activityId, siteId)
        if (!grant?.couponId) throw new Error('未确认发券结果')
        return { activities, couponId: grant.couponId }
      } catch (_) {
        return { activities, couponId: null, error: '免费洗车券暂未准备好，点击重试' }
      }
    }).catch(() => ({ activities: [], couponId: null }))
      .finally(() => { if (this.freeWashPreparation === preparation) this.freeWashPreparation = null })
    if (requestId === this.assetRequestId) this.freeWashPreparation = preparation
    return preparation.promise
  },

  retryFreeWashPreparation() {
    if (this.data.scanInfo && !this.data.paymentSitesLoading) this.loadAccountAssets(this.data.scanInfo)
  },

  openFreeWashActivities() {
    const { siteId, siteName } = this.data.machine
    if (!this.data.reviewMode && siteId) wx.navigateTo({
      url: '/pages/free-wash-activities/free-wash-activities?siteId=' + encodeURIComponent(siteId) + '&siteName=' + encodeURIComponent(siteName || '')
    })
  },

  async takeOverWash() {
    const scan = this.data.scanInfo
    const expectedOrderId = scan && scan.machine && scan.machine.takeoverOrderId
    if (!expectedOrderId || this.data.takeoverPending) return
    this.setData({ takeoverPending: true })
    try {
      const confirmed = await new Promise((resolve) => wx.showModal({
        title: '确认车位空闲',
        content: '请在机器旁确认当前车位没有车辆正在洗车。确认后将结束上一笔订单，你可以继续选择结算方式。',
        confirmText: '确认空闲',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      }))
      if (!confirmed) return
      wx.showLoading({ title: '正在结束上一单', mask: true })
      const location = await getWashLocation()
      const result = await api.scan.takeover({ mid: scan.mid || scan.qrId, expectedOrderId, confirmed: true,
        lat: location.latitude, lng: location.longitude })
      if (result.waitingForDevice) {
        this.setData({ takeoverWaiting: true, 'scanInfo.machine.takeoverOrderId': null })
        wx.hideLoading()
        return
      } else if (!result.released) {
        throw new Error('设备未收到停止指令，请稍后重新扫码')
      }
      wx.hideLoading()
      await this.loadScanInfo()
    } catch (err) {
      wx.hideLoading()
      wx.showModal({ title: '暂不能接手', content: err.message || '请重新扫码，或联系场地工作人员。', showCancel: false })
    } finally {
      this.setData({ takeoverPending: false })
    }
  },

  choosePayMethod(event) {
    const key = event.currentTarget.dataset.key
    if (this.data.reviewMode && key !== 'wallet') {
      wx.showModal({ title: '审核体验结算', content: '此体验仅使用虚拟余额，不消耗真实卡券。退出体验后可使用正式卡券。', showCancel: false })
      return
    }
    const target = this.data.payMethods.find((item) => item.key === key)

    if (!target || target.disabled) return

    if (key === 'coupon_pack') {
      this.openAssetPanel('coupon_pack')
      return
    }
    this.openAssetPanel('stored_value')
  },

  loadAccountAssets(scanInfo) {
    const requestId = (this.assetRequestId || 0) + 1
    this.assetRequestId = requestId
    this.setData({ paymentSitesLoading: true, checkoutReady: false })
    const siteId = scanInfo.site && (scanInfo.site.siteId || scanInfo.site.id)
    const machineId = scanInfo.machine && scanInfo.machine.machineId

    const policyPromise = api.sites.checkoutOptions(siteId)
    const couponsPromise = policyPromise.then(async policy => {
      const freeWash = await this.prepareFreeWash(scanInfo, siteId, policy, requestId)
      // Read available coupons after the claim; only a server-validated coupon may be selected.
      try {
        return { freeWash, couponPage: await api.coupons.available({ siteId, machineId, bizType: 'wash_order' }) }
      } catch (_) {
        if (requestId === this.assetRequestId) wx.showToast({ title: '可用洗车券查询失败，请刷新后重试', icon: 'none' })
        return { freeWash: { ...freeWash, error: freeWash.couponId ? '免费洗车券状态未确认，点击重试' : freeWash.error }, couponPage: [] }
      }
    })

    return Promise.all([
      couponsPromise,
      api.member.cards().catch(error => {
        if (this.data.siteCreditRefreshPending) throw error
        return []
      }),
      api.member.temporaryCards({ activeOnly: true }).catch(() => []),
      api.recharge.packages().catch(() => []),
      api.payment.sites().catch(() => []),
      policyPromise
    ])
      .then(([{ couponPage, freeWash }, cards, temporaryCards, rechargePackages, paymentSiteItems, policy]) => {
        if (requestId !== this.assetRequestId) return
        if(!policy || !Array.isArray(policy.enabledGroups))throw new Error('结算方式配置无效')
        this.setData({checkoutPolicy:policy,checkoutReady:true})
        const couponItems = Array.isArray(couponPage) ? couponPage : []
        const accountCards = (cards || []).concat(temporaryCards || [])
        const cardItems = accountCards
        const coupons = couponItems.map(normalizeCoupon).filter(item=>this.checkoutEnabled(item.sourceType==='group_buy_redemption'?'group_buy':'card_coupon'))
        const freeCoupon = freeWash.couponId && coupons.find(item => item.canUse &&
          item.sourceType === 'free_wash_activity' && String(item.couponId) === String(freeWash.couponId))
        const freeWashUnavailable = freeWash.couponId && !freeCoupon
        const normalizedCards = cardItems.map(normalizeCard)
        const siteIdForCards = scanInfo.site && (scanInfo.site.siteId || scanInfo.site.id)
        const washCards = normalizedCards.filter((item) => item.cardKind === 'wash_card' && siteIdForCards && String(item.sourceSiteId) === String(siteIdForCards) && this.checkoutEnabled('stored_value'))
        const memberCards = normalizedCards.filter((item) => item.cardKind !== 'wash_card' && this.checkoutEnabled('card_coupon'))
        const monthlyCards = memberCards.filter((item) => item.cardKind !== 'single_card')
        const singleCards = memberCards.filter((item) => item.cardKind === 'single_card')
        const packages = (rechargePackages || [])
          .map(normalizeRechargePackage)
          .filter((item) => !item.disabled)
        const paymentSites = (paymentSiteItems || []).map(normalizePaymentSite).filter((item) => item.siteId)
        const currentSiteId = scanInfo.site && (scanInfo.site.siteId || scanInfo.site.id)
        const rechargeSite = paymentSites.find((item) => String(item.siteId) === String(currentSiteId || '')) || null

        this.clearInvalidCouponSelection(coupons)
        this.setData({
          coupons,
          hasFreeWashActivities: freeWash.activities.length > 0,
          freeWashPreparationError: freeWash.error || '',
          freeWashUnavailable: !!freeWashUnavailable,
          washCards,
          memberCards,
          monthlyCards,
          singleCards,
          rechargePackages: packages,
          paymentSites,
          rechargeSite,
          paymentSitesLoading: false
        }, () => {
          if (this.data.siteCreditRefreshPending) this.setData({ siteCreditRefreshPending: false })
          if (!this.data.selectedPayment && freeCoupon) this.selectCoupon(freeCoupon)
          if (!freeWash.error && !freeWashUnavailable && !this.returningFromCardPurchase) this.selectAvailableBalance(scanInfo)
          this.refreshPayMethods()
          this.loadGroupBuyEntries()
          if (this.returningFromCardPurchase) {
            this.returningFromCardPurchase = false
          }
        })
      })
      .catch(() => {
        if (requestId !== this.assetRequestId) return
        this.clearInvalidCouponSelection([])
        const fallbackCards = (scanInfo.availableCards || []).map(normalizeCard)
        this.setData({
          coupons: [],
          washCards: fallbackCards.filter((item) => item.cardKind === 'wash_card' && this.data.machine.siteId && String(item.sourceSiteId) === String(this.data.machine.siteId)),
          memberCards: fallbackCards.filter((item) => item.cardKind !== 'wash_card'),
          monthlyCards: fallbackCards.filter((item) => item.cardKind !== 'wash_card' && item.cardKind !== 'single_card'),
          singleCards: fallbackCards.filter((item) => item.cardKind === 'single_card'),
          paymentSitesLoading: false,
          checkoutReady:false,checkoutPolicy:{enabledGroups:[]},selectedPayment:null,selectedPayMethod:''
        }, () => {
          this.setData(this.buildGroupBuyEntries(null))
          this.refreshPayMethods()
        })
      })
  },

  refreshSiteCredit() {
    if (this.data.scanInfo) return this.loadAccountAssets(this.data.scanInfo)
  },

  clearInvalidCouponSelection(coupons) {
    const selected = this.data.selectedPayment
    if (selected && selected.payMethod === 'coupon' && !coupons.some((coupon) => String(coupon.couponId) === String(selected.couponId) && coupon.canUse)) {
      this.setData({ selectedPayment: null, selectedPayMethod: '' })
    }
  },

  selectAvailableBalance(scanInfo) {
    if (this.data.selectedPayment || this.data.reviewMode) return
    if (!this.checkoutEnabled('stored_value')) return
    // 购洗车卡的钱在卡内而不是钱包中；只默认选扫码接口确认可用于本机器的储值卡。
    const eligibleIds = ((scanInfo && scanInfo.availableCards) || [])
      .filter((card) => card.canUse === true || card.canUse === 1)
      .map((card) => String(card.cardId))
    const card = this.data.washCards.find((item) => item.canUse && item.remainingAmountCent > 0 && eligibleIds.indexOf(String(item.cardId)) >= 0)
    if (card) this.setSelectedPayment({ uiKey: 'wallet', payMethod: 'member_card', cardId: card.cardId,
      cardKind: card.cardKind, remainingAmountCent: card.remainingAmountCent, name: card.name, desc: `${card.name} · ${card.desc}` })
  },

  refreshPayMethods() {
    if(!this.data.checkoutReady&&!this.data.reviewMode){this.setData({payMethods:[],couponMethod:null,walletMethod:null});return}
    if(this.data.selectedPayment&&!this.paymentAllowed(this.data.selectedPayment))this.setData({selectedPayment:null,selectedPayMethod:'',assetPanelVisible:false})
    const selected = this.data.selectedPayment || {}
    const couponCount = this.data.coupons.concat(this.data.monthlyCards, this.data.singleCards).filter((item) => item.canUse === true).length
    const payMethods = [
        {
          key: 'coupon_pack',
          name: '卡券',
          usableCount: couponCount,
          desc: selected.uiKey === 'coupon_pack'
            ? `已选：${selected.name || '卡券权益'}`
            : (couponCount ? '点击查看并选择可用卡券' : '当前暂无可用卡券'),
          badge: selected.uiKey === 'coupon_pack' ? '已选择' : (couponCount ? `${couponCount}项` : ''),
          active: selected.uiKey === 'coupon_pack'
        },
        {
          key: 'wallet',
          name: '储值',
          desc: this.data.reviewMode ? `体验余额 ${this.data.walletBalanceText} 元`
            : `本场地余额 ${centToYuan(this.data.washCards.filter(card=>card.canUse).reduce((sum,card)=>sum+card.remainingAmountCent,0))} 元`,
          active: selected.uiKey === 'wallet'
        }
      ].filter(item=>item.key==='wallet'?this.checkoutEnabled('stored_value'):this.checkoutEnabled('card_coupon')||couponCount>0)
    this.setData({payMethods,couponMethod:payMethods.find(item=>item.key==='coupon_pack')||null,walletMethod:payMethods.find(item=>item.key==='wallet')||null})
  },

  checkoutEnabled(code) { return this.data.reviewMode ? code==='stored_value' : !!this.data.checkoutPolicy && this.data.checkoutPolicy.enabledGroups.includes(code) },
  paymentAllowed(payment) { return (payment.payMethod!=='wallet'||this.data.reviewMode) && this.checkoutEnabled(payment.payMethod==='wallet'||payment.cardKind==='wash_card'?'stored_value':payment.sourceType==='group_buy_redemption'?'group_buy':'card_coupon') },
  chooseWalletBalance() { if(this.data.reviewMode)this.setSelectedPayment({uiKey:'wallet',payMethod:'wallet',desc:'体验余额支付'}) },

  getDefaultPriceText() {
    const amountCent = (this.data.scanInfo && this.data.scanInfo.pricing && this.data.scanInfo.pricing.defaultAmountCent) || 0

    return centToYuan(amountCent)
  },

  setSelectedPayment(payment) {
    if(!this.data.checkoutReady&&!this.data.reviewMode){wx.showToast({title:'结算方式正在更新，请稍候',icon:'none'});return}
    if(!this.paymentAllowed(payment)){wx.showToast({title:'该场地不支持此结算方式',icon:'none'});return}
    this.setData({
      selectedPayMethod: payment.uiKey,
      selectedPayment: payment,
      assetPanelVisible: false,
      assetPanelType: '',
      assetPanelTitle: ''
    }, () => {
      this.refreshPayMethods()
    })
  },

  openAssetPanel(type) {
    if (this.assetSheetTimer) clearTimeout(this.assetSheetTimer)
    // 用户停留在确认页时也可能刚收到赠券，打开选择面板时重新读取本场地可用权益。
    if (!this.data.reviewMode && this.data.scanInfo && !this.data.paymentSitesLoading) this.loadAccountAssets(this.data.scanInfo)
    this.setData({
      assetSheetOffset: 0,
      assetSheetDragging: false,
      assetPanelVisible: true,
      assetPanelType: type,
      assetPanelTitle: type==='stored_value'?'选择储值账户':'选择可用卡券'
    })
  },

  closeAssetPanel() {
    if (this.assetSheetTimer) clearTimeout(this.assetSheetTimer)
    this.assetSheetTouch = null
    this.setData({
      assetSheetOffset: 0,
      assetSheetDragging: false,
      assetPanelVisible: false,
      assetPanelType: '',
      assetPanelTitle: ''
    })
  },

  onAssetDragStart(event) {
    const touch = event.touches && event.touches[0]
    if (!touch || event.touches.length !== 1) return
    this.assetSheetTouch = { x: touch.clientX, y: touch.clientY, time: Date.now() }
  },

  onAssetDragMove(event) {
    const start = this.assetSheetTouch
    const touch = event.touches && event.touches[0]
    if (!start || !touch || event.touches.length !== 1) return
    const dy = touch.clientY - start.y
    if (dy > 0 && dy > Math.abs(touch.clientX - start.x)) this.setData({ assetSheetOffset: dy, assetSheetDragging: true })
  },

  onAssetDragEnd() {
    const start = this.assetSheetTouch
    this.assetSheetTouch = null
    if (!start) return
    const distance = this.data.assetSheetOffset
    if (distance >= 100 || (distance >= 40 && distance / Math.max(1, Date.now() - start.time) > 0.6)) {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.setData({ assetSheetOffset: info.windowHeight || 800, assetSheetDragging: false })
      this.assetSheetTimer = setTimeout(() => this.closeAssetPanel(), 220)
    } else this.onAssetDragCancel()
  },

  onAssetDragCancel() {
    this.assetSheetTouch = null
    this.setData({ assetSheetOffset: 0, assetSheetDragging: false })
  },

  buyCardsFromAssets() {
    this.closeAssetPanel()
    this.returningFromCardPurchase = true
    wx.navigateTo({ url: `/pages/buy-card-new/buy-card-new?siteId=${encodeURIComponent(this.data.machine.siteId || '')}`, fail: () => { this.returningFromCardPurchase = false } })
  },

  chooseCoupon(event) {
    const couponId = event.currentTarget.dataset.id
    const coupon = this.data.coupons.find((item) => String(item.couponId) === String(couponId))

    this.selectCoupon(coupon)
  },

  selectCoupon(coupon) {
    if (!coupon || !coupon.canUse) return
    if (coupon.preview) {
      wx.showToast({ title: '该洗车券暂不可用，请刷新后重试', icon: 'none' })
      return
    }

    this.setSelectedPayment({
      uiKey: 'coupon_pack',
      payMethod: 'coupon',
      couponId: coupon.couponId,
      sourceType: coupon.sourceType,
      minutes: coupon.minutes,
      name: coupon.name,
      desc: coupon.name
    })
  },

  chooseWashCard(event) {
    const cardId = event.currentTarget.dataset.id
    const card = this.data.washCards.find((item) => String(item.cardId) === String(cardId))

    if (!card || !card.canUse) return
    if (card.preview) {
      wx.showToast({ title: '该洗车卡暂不可用，请刷新后重试', icon: 'none' })
      return
    }

    this.setSelectedPayment({
      uiKey: 'wallet',
      payMethod: 'member_card',
      cardId: card.cardId,
      cardKind: card.cardKind,
      remainingAmountCent: card.remainingAmountCent,
      name: card.name,
      desc: `${card.name} · ${card.desc}`
    })
  },

  chooseMemberCard(event) {
    const cardId = event.currentTarget.dataset.id
    const card = this.data.monthlyCards.concat(this.data.singleCards).find((item) => String(item.cardId) === String(cardId))

    if (!card || !card.canUse) return
    if (card.preview) {
      wx.showToast({ title: '该卡暂不可用，请刷新后重试', icon: 'none' })
      return
    }

    this.setSelectedPayment({
      uiKey: 'coupon_pack',
      payMethod: 'member_card',
      cardId: card.cardId,
      cardKind: card.cardKind,
      remainingAmountCent: card.remainingAmountCent,
      remainingTimes: card.remainingTimes,
      name: card.name,
      desc: `${card.name} · ${card.desc}`
    })
  },

  startWash() {
    if (this.data.reviewMode) return this.performStartWash()
    if (this.startAuthPromise || this.data.starting || this.data.takeoverWaiting || this.data.takeoverPending) return
    this.startAuthPromise = ensurePhoneBound().then(() => {
      this.confirmAuthorized = true
      return this.performStartWash()
    }).catch((err) => {
      if (err.code === 'PHONE_REQUIRED' || err.code === 'AUTH_REQUIRED' || err.code === 'UNAUTHORIZED') {
        this.confirmAuthorized = false
        this.stopMachineStatusRefresh()
        this.setData({ phoneAuthVisible: true })
      } else this.showOrderError(err)
    }).finally(() => { this.startAuthPromise = null })
    return this.startAuthPromise
  },

  performStartWash() {
    if (this.data.starting) return
    if (this.data.reviewMode) {
      if (!this.data.scanInfo || !this.data.selectedPayment) return
      this.setData({ starting: true })
      wx.showLoading({ title: '创建体验订单' })
      api.review.createOrder().then((order) => navigateToOrder(registerOrder(order)))
        .catch((err) => this.showOrderError(err))
        .finally(() => { wx.hideLoading(); this.setData({ starting: false }) })
      return
    }
    const scanInfo = this.data.scanInfo
    if (this.data.takeoverWaiting || this.data.takeoverPending) return
    if (scanInfo && scanInfo.machine && scanInfo.machine.takeoverOrderId) return this.takeOverWash()

    if(!this.data.checkoutReady){wx.showToast({title:'请先刷新场地结算方式',icon:'none'});return}
    if(this.data.selectedPayment&&!this.paymentAllowed(this.data.selectedPayment)){this.setData({selectedPayment:null,selectedPayMethod:''});wx.showToast({title:'结算方式已关闭，请重新选择',icon:'none'});return}
    if (this.data.paymentSitesLoading) {
      wx.showToast({ title: '正在更新可用卡券，请稍候', icon: 'none' })
      return
    }
    const method = this.data.selectedPayment

    if (!scanInfo) {
      if (this.scanLoadError) {
        this.showOrderError(this.scanLoadError)
        return
      }
      wx.showModal({
        title: '机器信息未加载',
        content: '请确认已允许获取定位，并重新扫描机器二维码。',
        showCancel: false
      })
      return
    }
    if (!method) {
      this.openAssetPanel('coupon_pack')
      return
    }

    const risk = scanInfo.locationRisk

    if (risk && risk.needUserConfirm && !this.data.locationConfirmed) {
      this.confirmLocationRisk(risk)
        .then((confirmed) => {
          if (confirmed) {
            this.setData({ locationConfirmed: true })
            this.startWash()
          }
        })
      return
    }

    this.setData({ starting: true })
    wx.showLoading({ title: '创建订单' })

    this.refreshMachineStatus().then((state) => {
      if (!state.available) throw new Error(`机器${state.statusText}，暂不能开始洗车`)
      return this.buildOrderPayload(this.data.scanInfo, method)
    })
      .then((orderPayload) => api.wash.createOrder(orderPayload))
      .then((order) => {
        wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, order.orderNo)

        const washStatus = String((order && order.washStatus) || '').toLowerCase()

        if (washStatus === 'starting' || isWashRunning(washStatus) || washStatus === 'stopping' || washStatus === 'finished') {
          navigateToOrder(order)
          return null
        }

        if (order.payRequired && order.wxPayParams) {
          wx.hideLoading()
          return requestPayment(order.wxPayParams, order).then((payment) => Object.assign({}, order, {
            paymentConfirmPending: payment && payment.confirmPending
          }))
        }

        if (order.payRequired) {
          wx.hideLoading()
          return api.wash.pay(order.orderNo, {
            payMethod: method.payMethod
          }).then((payResult) => requestPayment(payResult.wxPayParams, payResult).then((payment) => Object.assign({}, order, {
            paymentConfirmPending: payment && payment.confirmPending
          })))
        }

        return order
      })
      .then((order) => {
        if (!order) return null
        if (order.paymentConfirmPending) return null

        wx.showLoading({ title: '启动洗车' })
        return api.wash.start(order.orderNo, {
          clientRequestId: `mini-${Date.now()}`
        }).then(() => order)
      })
      .then((order) => {
        if (!order) return

        wx.navigateTo({
          url: `/pages/wash-ready/wash-ready?orderNo=${encodeURIComponent(order.orderNo)}`
        })
      })
      .catch((err) => {
        if (err.code === 'LOCATION_CONFIRM_REQUIRED') {
          this.handleLocationConfirmRequired(err)
          return
        }

        this.showOrderError(err)
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ starting: false })
      })
  },

  confirmLocationRisk(risk) {
    return new Promise((resolve) => {
      wx.showModal({
        title: risk.title || '请确认现场位置',
        content: risk.message || '远程代下单行为是禁止的，如果继续操作会被冻结账号。',
        confirmText: '继续下单',
        cancelText: '取消',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
  },

  handleLocationConfirmRequired(err) {
    const response = err.response || {}
    const data = response.data || {}
    const risk = data.locationRisk || {
      title: '请确认现场位置',
      message: err.message || response.message || '远程代下单行为是禁止的，如果继续操作会被冻结账号。'
    }

    this.confirmLocationRisk(risk)
      .then((confirmed) => {
        if (confirmed) {
          this.setData({ locationConfirmed: true })
          this.startWash()
        }
      })
  },

  buildOrderPayload(scanInfo, method) {
    const defaultAmountCent = (scanInfo.pricing && scanInfo.pricing.defaultAmountCent) || 0
    const isFreeCard = method.payMethod === 'member_card' && method.cardKind !== 'wash_card' && !method.remainingAmountCent
    const expectedAmountCent = method.payMethod === 'coupon' || isFreeCard ? 0 : defaultAmountCent

    return getWashLocation()
      .then((location) => ({
        mid: scanInfo.mid || scanInfo.qrId,
        lat: location.latitude,
        lng: location.longitude,
        locationConfirm: this.data.locationConfirmed,
        payMethod: method.payMethod,
        cardId: method.cardId || null,
        couponId: method.couponId || null,
        expectedAmountCent,
        platform: 'wechat_mini'
      }))
  },

  showOrderError(err) {
    if (err.code === 'SITE_PAYMENT_METHOD_DISABLED' && this.data.scanInfo) {
      this.setData({selectedPayment:null,selectedPayMethod:'',checkoutReady:false})
      this.loadAccountAssets(this.data.scanInfo)
    }
    if (['LOCATION_DENIED', 'LOCATION_UNAVAILABLE', 'LOCATION_REQUIRED'].indexOf(err.code) >= 0) {
      if (this.locationPromptOpen) return
      this.locationPromptOpen = true
      wx.showModal({
        title: err.code === 'LOCATION_UNAVAILABLE' ? '暂时无法定位' : '需要开启定位',
        content: '扫码洗车需要定位以核实您在机器附近。请允许小程序获取位置，并开启手机定位服务；这与余额或卡券无关。',
        confirmText: '去设置', cancelText: '暂不开启',
        success: (result) => {
          this.locationPromptOpen = false
          if (!result.confirm) return
          wx.openSetting({
            success: (settings) => {
              if (!settings.authSetting || !settings.authSetting['scope.userLocation']) {
                wx.showToast({ title: '定位未开启，暂不能开始洗车', icon: 'none' })
                return
              }
              // 只恢复机器信息，不自动提交订单；已选支付方式、卡券保持不变。
              if (!this.data.scanInfo) this.loadScanInfo()
              else wx.showToast({ title: '请确认手机定位已开启，再点击开始洗车', icon: 'none' })
            },
            fail: () => wx.showToast({ title: '请在小程序设置中开启定位', icon: 'none' })
          })
        },
        fail: () => { this.locationPromptOpen = false }
      })
      return
    }
    if (String(err.code || '').indexOf('COUPON_') === 0 && this.data.scanInfo) {
      this.clearInvalidCouponSelection([])
      this.loadAccountAssets(this.data.scanInfo)
    }
    if (err.code === 'BALANCE_NOT_ENOUGH') {
      wx.showModal({
        title: '余额不足',
        content: err.message || '钱包余额不足，请先充值。',
        confirmText: '去充值',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this.rechargeWallet()
          }
        }
      })
      return
    }

    wx.showModal({
      title: '下单失败',
      content: err.message || '启动洗车失败',
      showCancel: false
    })
  },

  rechargeWallet() {
    this.buyCardsFromAssets()
  },

  createRechargeOrder(target) {
    if (this.rechargeInFlight || this.pendingRechargePayOrderNo) {
      if (this.pendingRechargePayOrderNo) this.resumeRechargeConfirmation().catch(() => {})
      wx.showToast({ title: '充值结果确认中，请勿重复付款', icon: 'none' })
      return
    }
    this.rechargeInFlight = true
    let paymentReturned = false
    wx.showLoading({ title: '创建充值单' })

    return api.recharge.createOrder({
      packageId: target.packageId,
      siteId: this.data.rechargeSite.siteId,
      payPlatform: 'wechat'
    })
      .then((order) => {
        wx.hideLoading()

        if (order && order.wxPayParams) {
          return requestPayment(order.wxPayParams, order).then((payment) => Object.assign({}, order, {
            paymentReturned: true,
            rechargePayOrderNo: payment.payOrderNo || getPayOrderNo(order) || order.orderNo,
            paymentConfirmPending: payment && payment.confirmPending
          }))
        }

        if (isPaymentSuccess(order)) return Object.assign({}, order, { paymentReturned: true })
        throw new Error('缺少充值支付参数，尚未完成支付')
      })
      .then((order) => {
        paymentReturned = !!order.paymentReturned
        this.pendingRechargePayOrderNo = order.rechargePayOrderNo || getPayOrderNo(order) || order.orderNo
        return this.resumeRechargeConfirmation()
      })
      .catch((err) => {
        if (!String(err.errMsg || '').includes('cancel')) {
          wx.showModal({
            title: paymentReturned ? '充值结果同步中' : '充值未完成',
            content: paymentReturned ? '微信支付已返回，余额暂未同步，请稍后返回本页重试，请勿重复充值。' : err.code === 'SITE_SUB_MERCHANT_REQUIRED'
              ? '当前场地暂未开通微信充值收款。'
              : (err.message || '充值订单创建失败'),
            showCancel: false
          })
        }
      })
      .finally(() => {
        this.rechargeInFlight = false
        wx.hideLoading()
      })
  },

  resumeRechargeConfirmation() {
    if (this.rechargeSyncPromise) return this.rechargeSyncPromise
    const payOrderNo = this.pendingRechargePayOrderNo
    if (!payOrderNo) return Promise.reject(new Error('缺少充值单号，请到充值记录核实，请勿重复付款'))
    let attempts = 0
    const poll = () => confirmPayment(payOrderNo).then((payment) => {
      if (isPaymentSuccess(payment)) {
        // 先确认后台已记账，再刷新余额及可用权益，不用微信弹窗成功冒充到账。
        return this.reloadWallet().then(() => this.loadAccountAssets(this.data.scanInfo)).then(() => {
          this.pendingRechargePayOrderNo = ''
          wx.showToast({ title: '充值到账，余额已更新', icon: 'success' })
        })
      }
      if (++attempts >= 6) {
        wx.showModal({ title: '充值确认中', content: '暂未确认到账，请勿重复充值。返回本页将再次同步，也可在充值记录中查询。', showCancel: false })
        return
      }
      return new Promise((resolve) => setTimeout(resolve, 2000)).then(poll)
    })
    this.rechargeSyncPromise = poll().finally(() => { this.rechargeSyncPromise = null })
    return this.rechargeSyncPromise
  },

  reloadWallet() {
    const requestId = (this.walletRequestId || 0) + 1
    this.walletRequestId = requestId
    return api.wallet.get()
      .then((wallet) => {
        if (requestId !== this.walletRequestId) return
        this.setData({
          user: Object.assign({}, this.data.user, {
            balance: centToYuan(wallet.balanceCent)
          }),
          walletBalanceCent: Number(wallet.balanceCent || 0),
          walletBalanceText: centToYuan(wallet.balanceCent)
        }, () => {
          if (!this.returningFromCardPurchase) this.selectAvailableBalance(this.data.scanInfo)
          this.refreshPayMethods()
        })
      })
  }
})
