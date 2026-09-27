const api = require('../../utils/api')
const { STORAGE_KEYS } = require('../../utils/config')
const { getCurrentLocation } = require('../../utils/location')
const { centToYuan, parseMachineMid, secToText } = require('../../utils/format')
const { requestPayment } = require('../../utils/payment')
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
    name: item.name || '洗车券',
    detailText: item.detailText || (item.minutes ? `可抵扣${item.minutes}分钟洗车` : '可用于本次洗车'),
    expireText: `到期时间：${formatDate(item.expireAt)}`,
    canUse: item.canUse !== false,
    unavailableReason: item.unavailableReason || ''
  }
}

function normalizeCard(item) {
  const cardKind = inferCardKind(item)

  return {
    cardId: item.cardId,
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

function toOnlineText(status) {
  const value = String(status || '').toLowerCase()

  if (value === 'online') return '设备上线'
  if (value === 'offline') return '设备下线'

  return status || '未知'
}

Page({
  data: {
    serviceTop: 34,
    user: { balance: '0' },
    machine: {
      id: '',
      siteId: '',
      siteName: '',
      name: '',
      status: '',
      onlineStatus: '',
      onlineText: '未知',
      available: false,
      balanceRate: '',
      cardRule: '',
      maxMinutes: 0
    },
    scanInfo: null,
    mid: '',
    qrId: '',
    priceText: '加载中',
    ruleText: '',
    selectedPayMethod: '',
    selectedPayment: null,
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
    rulesExpanded: true,
    payMethods: [
      {
        key: 'coupon_pack',
        name: '洗车券',
        desc: '暂无可用'
      },
      {
        key: 'wallet',
        name: '余额支付',
        desc: '余额支付'
      }
    ]
  },

  onLoad() {
    this.setData({
      serviceTop: 34
    })

    api.wallet.get()
      .then((wallet) => {
        this.setData({
          user: Object.assign({}, this.data.user, {
            balance: centToYuan(wallet.balanceCent)
          }),
          walletBalanceCent: Number(wallet.balanceCent || 0),
          walletBalanceText: centToYuan(wallet.balanceCent)
        }, () => this.refreshPayMethods())
      })
      .catch(() => {})
      .finally(() => {
        this.loadScanInfo()
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

  contactService() {
    wx.showToast({
      title: '客服电话待接入',
      icon: 'none'
    })
  },

  toggleRules() {
    this.setData({
      rulesExpanded: !this.data.rulesExpanded
    })
  },

  noop() {},

  loadScanInfo() {
    const cached = wx.getStorageSync(STORAGE_KEYS.lastScan)

    if (cached && cached.machine) {
      this.applyScanInfo(cached)
      return
    }

    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    const scanCode = current && current.options && (current.options.mid || current.options.qrId)

    if (!scanCode) {
      wx.showToast({
        title: '缺少扫码信息，请重新扫码',
        icon: 'none'
      })
      return
    }

    wx.showLoading({ title: '加载机器信息' })
    getCurrentLocation()
      .then((location) => api.scan.resolve({
        mid: parseMachineMid(scanCode),
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
    this.setData({
      scanInfo,
      mid: scanInfo.mid || scanInfo.qrId,
      qrId: scanInfo.qrId,
      machine: {
        id: scanInfo.machine.machineId,
        siteId: scanInfo.site && (scanInfo.site.siteId || scanInfo.site.id),
        siteName: scanInfo.site.name,
        name: scanInfo.machine.name,
        status: scanInfo.machine.machineStatus,
        onlineStatus: scanInfo.machine.onlineStatus,
        onlineText: toOnlineText(scanInfo.machine.onlineStatus),
        available: scanInfo.machine.available,
        balanceRate: defaultDurationSec ? `${centToYuan(defaultAmountCent)}元/${Math.round(defaultDurationSec / 60)}分钟` : '',
        cardRule: defaultDurationSec ? `${Math.round(defaultDurationSec / 60)}分钟内${centToYuan(defaultAmountCent)}元` : '',
        maxMinutes: Math.round(Number((scanInfo.pricing && scanInfo.pricing.maxDurationSec) || 0) / 60)
      },
      priceText: `${centToYuan(defaultAmountCent)}元`,
      ruleText: defaultDurationSec ? `默认时长${Math.round(defaultDurationSec / 60)}分钟` : '按后台计费规则结算',
      selectedPayMethod: '',
      selectedPayment: null,
      locationConfirmed: false
    })

    this.loadAccountAssets(scanInfo)
  },

  choosePayMethod(event) {
    const key = event.currentTarget.dataset.key
    const target = this.data.payMethods.find((item) => item.key === key)

    if (!target || target.disabled) return

    if (key === 'coupon_pack') {
      this.openAssetPanel('coupon_pack')
      return
    }

    this.setSelectedPayment({
      uiKey: 'wallet',
      payMethod: 'wallet',
      desc: '余额支付'
    })
  },

  loadAccountAssets(scanInfo) {
    this.setData({ paymentSitesLoading: true })

    Promise.all([
      api.coupons.mine({ status: 'available', page: 0, size: 50 }).catch(() => null),
      api.member.cards().catch(() => []),
      api.member.temporaryCards({ activeOnly: true }).catch(() => []),
      api.recharge.packages().catch(() => []),
      api.payment.sites().catch(() => [])
    ])
      .then(([couponPage, cards, temporaryCards, rechargePackages, paymentSiteItems]) => {
        const couponItems = (couponPage && couponPage.items && couponPage.items.length)
          ? couponPage.items
          : (scanInfo.availableCoupons || [])
        const accountCards = (cards || []).concat(temporaryCards || [])
        const cardItems = accountCards.length ? accountCards : (scanInfo.availableCards || [])
        const coupons = couponItems.map(normalizeCoupon)
        const normalizedCards = cardItems.map(normalizeCard)
        const washCards = normalizedCards.filter((item) => item.cardKind === 'wash_card')
        const memberCards = normalizedCards.filter((item) => item.cardKind !== 'wash_card')
        const monthlyCards = memberCards.filter((item) => item.cardKind !== 'single_card')
        const singleCards = memberCards.filter((item) => item.cardKind === 'single_card')
        const packages = (rechargePackages || [])
          .map(normalizeRechargePackage)
          .filter((item) => !item.disabled)
        const paymentSites = (paymentSiteItems || []).map(normalizePaymentSite).filter((item) => item.siteId)
        const currentSiteId = scanInfo.site && (scanInfo.site.siteId || scanInfo.site.id)
        const rechargeSite = paymentSites.find((item) => String(item.siteId) === String(currentSiteId || '')) || null

        this.setData({
          coupons,
          washCards,
          memberCards,
          monthlyCards,
          singleCards,
          rechargePackages: packages,
          paymentSites,
          rechargeSite,
          paymentSitesLoading: false
        }, () => {
          this.refreshPayMethods()
        })
      })
      .catch(() => {
        const fallbackCards = (scanInfo.availableCards || []).map(normalizeCard)
        this.setData({
          coupons: (scanInfo.availableCoupons || []).map(normalizeCoupon),
          washCards: fallbackCards.filter((item) => item.cardKind === 'wash_card'),
          memberCards: fallbackCards.filter((item) => item.cardKind !== 'wash_card'),
          monthlyCards: fallbackCards.filter((item) => item.cardKind !== 'wash_card' && item.cardKind !== 'single_card'),
          singleCards: fallbackCards.filter((item) => item.cardKind === 'single_card'),
          paymentSitesLoading: false
        }, () => {
          this.refreshPayMethods()
        })
      })
  },

  refreshPayMethods() {
    const selected = this.data.selectedPayment || {}
    const couponCount = this.data.coupons.length + this.data.washCards.length + this.data.monthlyCards.length + this.data.singleCards.length
    this.setData({
      payMethods: [
        {
          key: 'coupon_pack',
          name: '洗车券',
          desc: selected.uiKey === 'coupon_pack'
            ? `已选：${selected.name || '卡券权益'}`
            : (couponCount ? '点击查看并选择可用卡券' : '当前暂无可用卡券'),
          badge: selected.uiKey === 'coupon_pack' ? '已选择' : (couponCount ? `${couponCount}项` : ''),
          active: selected.uiKey === 'coupon_pack'
        },
        {
          key: 'wallet',
          name: '余额支付',
          desc: `余额 ${this.data.walletBalanceText} 元`,
          active: selected.uiKey === 'wallet'
        }
      ]
    })
  },

  getDefaultPriceText() {
    const amountCent = (this.data.scanInfo && this.data.scanInfo.pricing && this.data.scanInfo.pricing.defaultAmountCent) || 0

    return centToYuan(amountCent)
  },

  setSelectedPayment(payment) {
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
    this.setData({
      assetPanelVisible: true,
      assetPanelType: type,
      assetPanelTitle: '选择可用卡券'
    })
  },

  closeAssetPanel() {
    this.setData({
      assetPanelVisible: false,
      assetPanelType: '',
      assetPanelTitle: ''
    })
  },

  chooseCoupon(event) {
    const couponId = event.currentTarget.dataset.id
    const coupon = this.data.coupons.find((item) => String(item.couponId) === String(couponId))

    if (!coupon || !coupon.canUse) return
    if (coupon.preview) {
      wx.showToast({ title: '这是样式预览数据', icon: 'none' })
      return
    }

    this.setSelectedPayment({
      uiKey: 'coupon_pack',
      payMethod: 'coupon',
      couponId: coupon.couponId,
      name: coupon.name,
      desc: coupon.name
    })
  },

  chooseWashCard(event) {
    const cardId = event.currentTarget.dataset.id
    const card = this.data.washCards.find((item) => String(item.cardId) === String(cardId))

    if (!card || !card.canUse) return
    if (card.preview) {
      wx.showToast({ title: '这是样式预览数据', icon: 'none' })
      return
    }

    this.setSelectedPayment({
      uiKey: 'coupon_pack',
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
      wx.showToast({ title: '这是样式预览数据', icon: 'none' })
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
    const scanInfo = this.data.scanInfo
    const method = this.data.selectedPayment

    if (!scanInfo || !method) {
      wx.showModal({
        title: '请选择结算方式',
        content: '请先选择洗车券或余额支付后再开始洗车。',
        showCancel: false
      })
      return
    }

    if (scanInfo.machine && scanInfo.machine.available === false) {
      wx.showToast({
        title: scanInfo.machine.unavailableReason || '机器当前不可用',
        icon: 'none'
      })
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

    this.buildOrderPayload(scanInfo, method)
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

    return getCurrentLocation()
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
    const packages = this.data.rechargePackages
    const rechargeSite = this.data.rechargeSite

    if (this.data.paymentSitesLoading) {
      wx.showToast({
        title: '正在加载支付场地',
        icon: 'none'
      })
      return
    }

    if (!rechargeSite || !rechargeSite.siteId) {
      wx.showModal({
        title: '当前场地暂不支持充值',
        content: '该场地尚未绑定可用的微信支付特约商户，请联系客服或稍后再试。',
        showCancel: false
      })
      return
    }

    if (!packages.length) {
      wx.showToast({
        title: '暂无可用充值套餐',
        icon: 'none'
      })
      return
    }

    if (packages.length === 1) {
      this.createRechargeOrder(packages[0])
      return
    }

    wx.showActionSheet({
      itemList: packages.map((item) => item.actionText).slice(0, 6),
      success: (res) => {
        const target = packages[res.tapIndex]

        if (target) {
          this.createRechargeOrder(target)
        }
      }
    })
  },

  createRechargeOrder(target) {
    wx.showLoading({ title: '创建充值单' })

    api.recharge.createOrder({
      packageId: target.packageId,
      siteId: this.data.rechargeSite.siteId,
      payPlatform: 'wechat'
    })
      .then((order) => {
        wx.hideLoading()

        if (order && order.wxPayParams) {
          return requestPayment(order.wxPayParams, order).then((payment) => Object.assign({}, order, {
            paymentConfirmPending: payment && payment.confirmPending
          }))
        }

        return order
      })
      .then((order) => this.reloadWallet().then(() => order))
      .then((order) => {
        if (!order || !order.paymentConfirmPending) {
          wx.showToast({
            title: '充值成功',
            icon: 'success'
          })
        }
      })
      .catch((err) => {
        if (!String(err.errMsg || '').includes('cancel')) {
          wx.showModal({
            title: '充值失败',
            content: err.code === 'SITE_SUB_MERCHANT_REQUIRED'
              ? '当前场地暂未开通微信充值收款。'
              : (err.message || '充值订单创建失败'),
            showCancel: false
          })
        }
      })
      .finally(() => {
        wx.hideLoading()
      })
  },

  reloadWallet() {
    return api.wallet.get()
      .then((wallet) => {
        this.setData({
          user: Object.assign({}, this.data.user, {
            balance: centToYuan(wallet.balanceCent)
          }),
          walletBalanceCent: Number(wallet.balanceCent || 0),
          walletBalanceText: centToYuan(wallet.balanceCent)
        }, () => this.refreshPayMethods())
      })
  }
})
