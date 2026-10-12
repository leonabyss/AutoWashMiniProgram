const api = require('../../utils/api')
const { STORAGE_KEYS } = require('../../utils/config')
const { centToYuan, secToText } = require('../../utils/format')
const { isReviewOrder } = require('../../utils/review-mode')

const FINISH_POLL_MS = 3000

function payMethodText(method) {
  const map = {
    wechat: '微信支付',
    wallet: '余额支付',
    member_card: '洗车卡',
    coupon: '洗车券'
  }

  return map[String(method || '').toLowerCase()] || '结算方式待确认'
}

function normalizeCards(cards) {
  if (Array.isArray(cards)) return cards
  return (cards && (cards.items || cards.list || cards.activeCards)) || []
}

function inferCardKind(card) {
  const cardKind = String((card && card.cardKind) || '').toLowerCase()
  const productType = String((card && (card.productType || card.productTypeCode)) || '').toLowerCase()
  const name = String((card && card.name) || '')

  if (cardKind) return cardKind
  if (productType.indexOf('wash_card') >= 0 || name.indexOf('洗车卡') >= 0) return 'wash_card'
  if (productType.indexOf('single_card') >= 0 || name.indexOf('次卡') >= 0) return 'single_card'
  if (productType.indexOf('member_') >= 0 || productType === 'month_card' || name.indexOf('会员') >= 0 || name.indexOf('月卡') >= 0) return 'monthly_member'

  return ''
}

function getCouponTotal(coupons) {
  if (!coupons) return null
  if (typeof coupons.total === 'number') return coupons.total
  if (typeof coupons.totalElements === 'number') return coupons.totalElements
  if (typeof coupons.availableCount === 'number') return coupons.availableCount
  if (Array.isArray(coupons)) return coupons.length

  const items = coupons.items || coupons.list
  return Array.isArray(items) ? items.length : null
}

function findPaymentCard(cards, payment) {
  const list = normalizeCards(cards)
  const cardId = payment && payment.cardId

  if (isPresent(cardId)) {
    const selected = list.find((card) => String(card.cardId) === String(cardId))
    if (selected) return selected
  }

  const cardKind = String((payment && payment.cardKind) || '').toLowerCase()
  return list.find((card) => inferCardKind(card) === cardKind) || null
}

function buildSettlementDisplay(payMethod, payment, card, wallet, coupons, cost, displayTime) {
  const method = String(payMethod || '').toLowerCase()
  const cardKind = inferCardKind(card) || String((payment && payment.cardKind) || '').toLowerCase()
  const cardName = (card && card.name) || (payment && payment.cardName) || ''
  const walletBalanceCent = pickNestedNumber([wallet], ['balanceCent'])
  const amountPrefix = cost === '--' ? '' : '¥'

  if (method === 'wallet') {
    return {
      payMethodText: '余额支付',
      settlementSummary: { label: '本次扣费', prefix: amountPrefix, value: cost, unit: '', tone: 'blue' },
      remainingSummary: {
        label: '账户余额', prefix: walletBalanceCent === null ? '' : '¥', value: walletBalanceCent === null ? '--' : centToYuan(walletBalanceCent), unit: '', tone: '',
        icon: '/assets/icons/lucide-wallet-orange.svg'
      }
    }
  }

  if (method === 'member_card' && cardKind === 'wash_card') {
    const remainingAmountCent = pickNestedNumber([card], ['remainingAmountCent'])

    return {
      payMethodText: cardName || '洗车卡',
      settlementSummary: { label: '本次扣费', prefix: amountPrefix, value: cost, unit: '', tone: 'blue' },
      remainingSummary: {
        label: '洗车卡余额', prefix: remainingAmountCent === null ? '' : '¥', value: remainingAmountCent === null ? '--' : centToYuan(remainingAmountCent), unit: '', tone: '',
        icon: '/assets/icons/lucide-credit-card.svg'
      }
    }
  }

  if (method === 'member_card' && cardKind === 'monthly_member') {
    const remainingDurationSec = pickNestedNumber([card], ['remainingDurationSec'])

    return {
      payMethodText: cardName || '包月会员',
      settlementSummary: { label: '本次消耗', prefix: '', value: displayTime, unit: '', tone: 'blue' },
      remainingSummary: {
        label: '会员剩余时间', prefix: '', value: remainingDurationSec === null ? '--' : secToText(remainingDurationSec), unit: '', tone: 'green',
        icon: '/assets/icons/lucide-crown-active.svg'
      }
    }
  }

  if (method === 'member_card' && cardKind === 'single_card') {
    const remainingTimes = pickNestedNumber([card, payment], ['remainingTimes'])

    return {
      payMethodText: cardName || '次卡',
      settlementSummary: { label: '本次消耗', prefix: '', value: '1', unit: '次', tone: 'blue' },
      remainingSummary: {
        label: '次卡剩余', prefix: '', value: remainingTimes === null ? '--' : String(remainingTimes), unit: remainingTimes === null ? '' : '次', tone: 'green',
        icon: '/assets/icons/lucide-ticket-blue.svg'
      }
    }
  }

  if (method === 'coupon') {
    const couponTotal = getCouponTotal(coupons)

    return {
      payMethodText: '洗车券',
      settlementSummary: { label: '本次消耗', prefix: '', value: '1', unit: '张', tone: 'blue' },
      remainingSummary: {
        label: '可用洗车券', prefix: '', value: couponTotal === null ? '--' : String(couponTotal), unit: couponTotal === null ? '' : '张', tone: 'green',
        icon: '/assets/icons/lucide-ticket-blue.svg'
      }
    }
  }

  if (method === 'wechat') {
    return {
      payMethodText: '微信支付',
      settlementSummary: { label: '本次支付', prefix: amountPrefix, value: cost, unit: '', tone: 'blue' },
      remainingSummary: {
        label: '支付状态', prefix: '', value: '支付完成', unit: '', tone: 'green',
        icon: '/assets/icons/lucide-circle-check-blue.svg'
      }
    }
  }

  return {
    payMethodText: payMethodText(method),
    settlementSummary: { label: '本次扣费', prefix: amountPrefix, value: cost, unit: '', tone: 'blue' },
    remainingSummary: {
      label: '结算状态', prefix: '', value: '已完成', unit: '', tone: 'green',
      icon: '/assets/icons/lucide-circle-check-blue.svg'
    }
  }
}

function getFinishSizeClass(heightRpx) {
  if (heightRpx <= 1080) return 'finish-tight'
  if (heightRpx <= 1220) return 'finish-compact'
  return 'finish-normal'
}

const faultOptions = [
  { key: 'no_water', label: '没有水了' },
  { key: 'no_foam', label: '没有泡沫了' },
  { key: 'weak_pressure', label: '水压太小' },
  { key: 'machine_stopped', label: '机器停了' },
  { key: 'payment_issue', label: '扣费异常' },
  { key: 'other', label: '其他问题' }
]

function markFaultOptions(selectedKeys) {
  return faultOptions.map((item) => Object.assign({}, item, {
    active: selectedKeys.indexOf(item.key) >= 0
  }))
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== ''
}

function pickNumber(source, keys) {
  if (!source) return null

  for (let i = 0; i < keys.length; i += 1) {
    const value = source[keys[i]]

    if (isPresent(value)) {
      const number = Number(value)

      if (!Number.isNaN(number)) return number
    }
  }

  return null
}

function pickNestedNumber(sources, keys) {
  const list = []

  sources.forEach((source) => {
    if (!source) return

    list.push(source)
    ;['payment', 'settlement', 'billing', 'duration'].forEach((key) => {
      if (source[key]) list.push(source[key])
    })
    if (source.device) {
      list.push(source.device)
      if (source.device.payment) list.push(source.device.payment)
    }
  })

  for (let i = 0; i < list.length; i += 1) {
    const value = pickNumber(list[i], keys)

    if (value !== null) return value
  }

  return null
}

function getDurationSec(order, status) {
  return pickNestedNumber([status, order], [
    'washDurationSec',
    'usedDurationSec',
    'machineStartSec',
    'durationSec',
    'totalDurationSec'
  ]) || 0
}

function getAmountUsedCent(order, status) {
  const amount = pickNestedNumber([status, order], [
    'amountUsedCent',
    'usedAmountCent',
    'deductAmountCent',
    'deductedAmountCent',
    'actualAmountCent',
    'settleAmountCent',
    'settlementAmountCent',
    'finalAmountCent',
    'payAmountCent',
    'feeCent',
    'costCent',
    'amountCent'
  ])

  if (amount !== null) return Math.max(0, Math.round(amount))

  return calculateAmountByDuration(order, status)
}

function calculateAmountByDuration(order, status) {
  const seconds = getDurationSec(order, status)

  if (!seconds) return null

  const baseDurationSec = pickNestedNumber([order, status], [
    'baseDurationSec',
    'defaultDurationSec',
    'includedDurationSec',
    'minimumDurationSec'
  ]) || 360
  const baseAmountCent = pickNestedNumber([order, status], [
    'baseAmountCent',
    'defaultAmountCent',
    'minimumAmountCent',
    'startAmountCent'
  ]) || 600
  const extraMinuteCent = pickNestedNumber([order, status], [
    'extraMinuteCent',
    'extraPricePerMinuteCent',
    'pricePerMinuteCent',
    'unitPriceCent'
  ]) || 50

  if (seconds <= baseDurationSec) return baseAmountCent

  return baseAmountCent + Math.ceil((seconds - baseDurationSec) / 60) * extraMinuteCent
}

Page({
  behaviors: [require('../../utils/fault-sheet')],
  data: {
    orderNo: '',
    reviewMode: false,
    seconds: 0,
    displayTime: '--',
    cost: '--',
    remain: '--',
    siteName: '--',
    machineName: '--',
    payMethodText: '--',
    settlementSummary: {
      label: '本次扣费', prefix: '¥', value: '--', unit: '', tone: 'blue'
    },
    remainingSummary: {
      label: '结算结果', prefix: '', value: '--', unit: '', tone: '',
      icon: '/assets/icons/lucide-circle-check-blue.svg'
    },
    machineId: null,
    siteId: null,
    machineStatus: 'finished',
    faultOptions: markFaultOptions([]),
    faultPanelVisible: false,
    selectedFaultKeys: [],
    faultDesc: '',
    reporting: false,
    faultReported: false,
    settlementLoading: true,
    settlementResolved: false,
    finishSizeClass: 'finish-normal',
    finishViewportStyle: '--safe-bottom:0px;'
  },

  onLoad(options) {
    const orderNo = options.orderNo || wx.getStorageSync(STORAGE_KEYS.currentWashOrderNo)

    this.updateFinishViewport()

    if (orderNo) {
      this.setData({ orderNo, reviewMode: isReviewOrder(orderNo) })
      this.loadOrderDetail(orderNo)
      this.startFinishPolling()
      return
    }

    const seconds = Number(options.seconds || 0)
    const cost = Number(options.cost || 0).toFixed(2)
    const remain = isPresent(options.remain) ? Number(options.remain).toFixed(2) : '--'

    this.setData({
      seconds,
      cost,
      remain,
      displayTime: secToText(seconds),
      settlementSummary: { label: '本次扣费', prefix: '¥', value: cost, unit: '', tone: 'blue' },
      remainingSummary: {
        label: '账户余额', prefix: remain === '--' ? '' : '¥', value: remain, unit: '', tone: '',
        icon: '/assets/icons/lucide-wallet-orange.svg'
      },
      settlementLoading: false
    })
  },

  onShow() {
    this.updateFinishViewport()

    if (this.data.orderNo && !this.data.settlementResolved) {
      this.startFinishPolling()
    }
  },

  onHide() {
    this.stopFinishPolling()
  },

  onUnload() {
    this.stopFinishPolling()
  },

  onResize() {
    this.updateFinishViewport()
  },

  noop() {},

  updateFinishViewport() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = info.windowWidth || 375
    const windowHeight = info.windowHeight || 667
    const heightRpx = windowHeight * 750 / windowWidth
    const bottomInset = info.safeArea ? Math.max(0, windowHeight - info.safeArea.bottom) : 0

    this.setData({
      finishSizeClass: getFinishSizeClass(heightRpx),
      finishViewportStyle: `height:${windowHeight}px;--safe-bottom:${bottomInset}px;`
    })
  },

  startFinishPolling() {
    if (this.finishTimer || !this.data.orderNo) return

    this.finishTimer = setInterval(() => {
      this.loadOrderDetail(this.data.orderNo, true)
    }, FINISH_POLL_MS)
  },

  stopFinishPolling() {
    if (!this.finishTimer) return

    clearInterval(this.finishTimer)
    this.finishTimer = null
  },

  loadOrderDetail(orderNo, silent) {
    if (this.data.reviewMode) {
      return api.wash.status(orderNo).then((order) => {
        const resolved = order.washStatus === 'finished'
        this.setData({
          seconds: order.washDurationSec,
          displayTime: secToText(order.washDurationSec),
          cost: centToYuan(order.amountCent), remain: centToYuan(order.balanceCent),
          siteName: order.siteName, machineName: order.machineName,
          payMethodText: '虚拟体验余额',
          settlementSummary: { label: '本次体验扣费', prefix: '¥', value: centToYuan(order.amountCent), unit: '', tone: 'blue' },
          remainingSummary: { label: '剩余体验余额', prefix: '¥', value: centToYuan(order.balanceCent), unit: '', tone: '', icon: '/assets/icons/lucide-wallet-orange.svg' },
          settlementResolved: resolved, settlementLoading: !resolved
        })
        if (resolved) {
          this.stopFinishPolling()
          wx.removeStorageSync(STORAGE_KEYS.currentWashOrderNo)
        }
      }).catch((err) => {
        if (!silent) wx.showModal({ title: '结算信息获取失败', content: err.message || '请稍后重试', showCancel: false })
      })
    }
    api.wash.detail(orderNo)
      .catch(() => null)
      .then((order) => api.wash.status(orderNo)
        .catch(() => null)
        .then((status) => [order, status]))
      .then(([order, status]) => {
        const source = order || status

        if (!source) return null

        const seconds = getDurationSec(order, status)
        const amountUsedCent = getAmountUsedCent(order, status)
        const machine = (status && status.machine) || {}
        const payment = (status && status.device && status.device.payment) || (status && status.payment) || {}
        const resolvedCost = amountUsedCent === null ? this.data.cost : centToYuan(amountUsedCent)
        const resolvedTime = secToText(seconds)
        const resolvedPayMethod = (order && order.payMethod) || source.payMethod || payment.payMethod

        return Promise.all([
          api.wallet.get().catch(() => null),
          api.member.cards().catch(() => []),
          api.coupons.mine({ status: 'available', page: 0, size: 1 }).catch(() => null)
        ]).then(([wallet, cards, coupons]) => {
          const card = findPaymentCard(cards, payment)
          const washStatus = String((status && status.washStatus) || (order && order.washStatus) || '').toLowerCase()
          const orderStatus = String((status && status.orderStatus) || (order && order.orderStatus) || '').toLowerCase()
          const terminalStatuses = ['finished', 'completed', 'abnormal', 'failed', 'canceled', 'cancelled', 'closed', 'refunded']
          const settlementResolved = terminalStatuses.indexOf(washStatus) >= 0 || terminalStatuses.indexOf(orderStatus) >= 0
          const display = buildSettlementDisplay(
            resolvedPayMethod,
            payment,
            card,
            wallet,
            coupons,
            resolvedCost,
            resolvedTime
          )

          this.setData({
            seconds,
            cost: resolvedCost,
            remain: display.remainingSummary.value,
            displayTime: resolvedTime,
            siteName: (order && order.siteName) || source.siteName || this.data.siteName,
            machineName: (order && order.machineName) || machine.machineName || source.machineName || this.data.machineName,
            payMethodText: display.payMethodText,
            settlementSummary: display.settlementSummary,
            remainingSummary: display.remainingSummary,
            settlementResolved,
            machineId: source.machineId || machine.machineId || this.data.machineId,
            siteId: source.siteId || machine.siteId || this.data.siteId,
            machineStatus: (
              source.machineStatus
              || machine.machineStatus
              || (status && status.washStatus)
              || (order && order.washStatus)
              || this.data.machineStatus
            )
          })

          wx.removeStorageSync(STORAGE_KEYS.currentWashOrderNo)

          if (settlementResolved) {
            this.stopFinishPolling()
          }
        })
      })
      .catch((err) => {
        if (!silent) {
          wx.showToast({
            title: err.message || '订单详情加载失败',
            icon: 'none'
          })
        }
      })
      .finally(() => {
        if (this.data.settlementLoading) {
          this.setData({ settlementLoading: false })
        }
      })
  },

  backHome() {
    wx.reLaunch({
      url: '/pages/home/home'
    })
  },

  reportFault() {
    this.openFaultReport()
  },

  openFaultReport() {
    if (this.data.reviewMode) {
      wx.showModal({ title: '模拟设备', content: '审核体验不涉及真实机器，故障上报仅用于正式洗车订单。', showCancel: false })
      return
    }
    const reports = wx.getStorageSync(STORAGE_KEYS.faultReports) || []
    const reported = reports.some((item) => String(item.orderNo) === String(this.data.orderNo))
    if (this.data.faultReported || reported) {
      this.setData({ faultReported: true })
      wx.showModal({ title: '已上报', content: '本订单的故障已提交，请等待核查。同一订单仅保留首次上报内容。', showCancel: false })
      return
    }
    this.resetFaultSheet()
    this.setData({ faultPanelVisible: true })
  },

  closeFaultReport() {
    this.dismissFaultSheet()
  },

  toggleFaultOption(event) {
    const key = event.currentTarget.dataset.key
    const selected = this.data.selectedFaultKeys.slice()
    const index = selected.indexOf(key)

    if (index >= 0) {
      selected.splice(index, 1)
    } else {
      selected.push(key)
    }

    this.setData({
      selectedFaultKeys: selected,
      faultOptions: markFaultOptions(selected)
    })
  },

  onFaultDescInput(event) {
    this.setData({ faultDesc: event.detail.value })
  },

  submitFaultReport() {
    if (this.data.reporting) return
    if (!this.data.orderNo) {
      wx.showToast({ title: '缺少洗车订单号', icon: 'none' })
      return
    }
    if (this.data.faultReported) return
    if (String(this.data.faultDesc || '').length > 1000) {
      wx.showToast({ title: '详细描述不能超过1000字', icon: 'none' })
      return
    }
    if (!this.data.selectedFaultKeys.length) {
      wx.showToast({
        title: '请选择故障状态',
        icon: 'none'
      })
      return
    }

    const payload = {
      orderNo: this.data.orderNo,
      faultItems: this.data.selectedFaultKeys.slice(),
      description: String(this.data.faultDesc || '').trim(),
      machineStatus: String(this.data.machineStatus || '').slice(0, 64)
    }

    this.setData({ reporting: true })
    wx.showLoading({ title: '正在上报' })

    api.faultReports.create(payload)
      .then((result) => {
        this.recordFaultReport(Object.assign({}, payload, {
          reportId: result && (result.reportId || result.id),
          status: (result && result.status) || 'submitted'
        }))
        wx.showModal({
          title: '上报成功',
          content: '故障已提交，等待工作人员核查。上报不会自动结束洗车或退款，补偿结果以审核处理为准。',
          showCancel: false
        })
        this.setData({
          faultPanelVisible: false,
          selectedFaultKeys: [],
          faultOptions: markFaultOptions([]),
          faultDesc: '',
          faultReported: true
        })
      })
      .catch((err) => {
        wx.showModal({
          title: '上报失败',
          content: err.message || '故障上报提交失败，请稍后再试。',
          showCancel: false
        })
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ reporting: false })
      })
  },

  recordFaultReport(report) {
    const list = wx.getStorageSync(STORAGE_KEYS.faultReports) || []

    if (list.some((item) => String(item.orderNo) === String(report.orderNo))) return
    list.unshift(report)
    wx.setStorageSync(STORAGE_KEYS.faultReports, list.slice(0, 20))
  }
})
