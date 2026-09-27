const api = require('../../utils/api')
const { IMAGE_BASE_URL, STORAGE_KEYS } = require('../../utils/config')
const { centToYuan, secToText, makeClientRequestId } = require('../../utils/format')
const { redirectToOrder } = require('../../utils/wash-route')

const guestSummary = {
  icon: 'M',
  prefix: '权益加载中',
  value: '',
  unit: ''
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

function getProductType(card) {
  return String((card && (card.productType || card.productTypeCode || card.type)) || '').toLowerCase()
}

function getCardKind(card) {
  return String((card && card.cardKind) || '').toLowerCase()
}

function getCardName(card) {
  return String((card && card.name) || '')
}

function isActiveCard(card) {
  return card && card.status === 'active'
}

function getExpireDays(validTo) {
  const expireAt = new Date(validTo).getTime()

  if (!expireAt) return 0

  return Math.max(0, Math.ceil((expireAt - Date.now()) / 86400000))
}

function getCouponTotal(coupons) {
  if (!coupons) return 0
  if (typeof coupons.total === 'number') return coupons.total

  return ((coupons.items || coupons.list || [])).length
}

function isSingleCard(card) {
  const cardKind = getCardKind(card)
  const productType = getProductType(card)
  const name = getCardName(card)

  return cardKind === 'single_card' || productType.indexOf('single_card') >= 0 || name.indexOf('次卡') >= 0
}

function isWashCard(card) {
  const cardKind = getCardKind(card)
  const productType = getProductType(card)
  const name = getCardName(card)

  return cardKind === 'wash_card' || productType.indexOf('wash_card') >= 0 || name.indexOf('洗车卡') >= 0
}

function isVipCard(card) {
  const cardKind = getCardKind(card)
  const productType = getProductType(card)
  const name = getCardName(card).toLowerCase()

  return (
    cardKind === 'monthly_member'
    || productType.indexOf('member_') === 0
    || productType === 'month_card'
    || name.indexOf('vip') >= 0
    || name.indexOf('会员') >= 0
    || name.indexOf('月卡') >= 0
  )
}

function buildAccountSummary(wallet, cards, coupons) {
  const couponTotal = getCouponTotal(coupons)

  if (couponTotal > 0) {
    return { icon: '券', prefix: '洗车券剩余', value: String(couponTotal), unit: '张' }
  }

  const activeCards = (cards || []).filter(isActiveCard)
  const singleCard = activeCards.find(isSingleCard)
  const washCard = activeCards.find(isWashCard)
  const vipCard = activeCards.find(isVipCard)

  if (singleCard) {
    return { icon: '次', prefix: '次卡剩余', value: String(singleCard.remainingTimes || singleCard.totalTimes || 0), unit: '次' }
  }

  if (washCard) {
    return { icon: '卡', prefix: '洗车卡余额', value: centToYuan(washCard.remainingAmountCent), unit: '元' }
  }

  if (vipCard) {
    if (Number(vipCard.remainingDurationSec || 0) > 0) {
      return {
        icon: 'VIP',
        prefix: getCardName(vipCard) || '包月会员',
        value: `剩余${secToText(vipCard.remainingDurationSec)}`,
        unit: ''
      }
    }

    return { icon: 'VIP', prefix: 'VIP还剩', value: String(getExpireDays(vipCard.validTo)), unit: '天到期' }
  }

  return {
    icon: 'M',
    prefix: '充值余额还剩',
    value: centToYuan(wallet && wallet.balanceCent),
    unit: '元'
  }
}

function formatClock(seconds) {
  const safeSeconds = Math.max(0, Number(seconds || 0))
  const minute = Math.floor(safeSeconds / 60)
  const second = safeSeconds % 60

  return `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

function getMachineStatusText(machineStatus, washStatus) {
  const status = String(machineStatus || washStatus || '').toLowerCase()

  if (status === 'paused' || status === 'pause' || status === 'idle') return '设备已暂停'
  if (status === 'fault' || status === 'error' || status === 'maintenance') return '设备状态异常'
  if (status === 'starting') return '设备启动中'

  return '设备运行中'
}

function isTerminalOrderStatus(status) {
  const washStatus = String((status && status.washStatus) || '').toLowerCase()
  const orderStatus = String((status && status.orderStatus) || '').toLowerCase()
  const terminalStatuses = ['finished', 'completed', 'abnormal', 'failed', 'canceled', 'cancelled', 'closed', 'refunded']

  return terminalStatuses.indexOf(washStatus) >= 0 || terminalStatuses.indexOf(orderStatus) >= 0
}

function getWashingSizeClass(heightRpx) {
  if (heightRpx <= 1080) return 'washing-tight'
  if (heightRpx <= 1220) return 'washing-compact'
  if (heightRpx >= 1500) return 'washing-tall'
  return 'washing-normal'
}

Page({
  data: {
    orderNo: '',
    accountSummary: guestSummary,
    seconds: 0,
    displayClock: '00:00',
    machineStatus: 'washing',
    machineStatusText: '设备运行中',
    machineId: null,
    siteId: null,
    stopping: false,
    faultOptions: markFaultOptions([]),
    faultPanelVisible: false,
    selectedFaultKeys: [],
    faultDesc: '',
    reporting: false,
    faultReported: false,
    washingImageUrl: `${IMAGE_BASE_URL}/washing-active-comic.webp`,
    washingSizeClass: 'washing-normal',
    washingViewportStyle: '--safe-bottom:0px;'
  },

  onLoad(options) {
    const orderNo = options.orderNo || wx.getStorageSync(STORAGE_KEYS.currentWashOrderNo)

    if (!orderNo) {
      wx.showToast({
        title: '缺少订单号',
        icon: 'none'
      })
      return
    }

    this.setData({ orderNo })
    this.updateWashingViewport()
    this.keepScreenOn(true)
    this.loadAccountSummary()
    this.pollStatus()
    this.timer = setInterval(() => {
      this.pollStatus()
    }, 3000)
  },

  onShow() {
    this.updateWashingViewport()
    this.keepScreenOn(true)
  },

  onResize() {
    this.updateWashingViewport()
  },

  onUnload() {
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.keepScreenOn(false)
  },

  keepScreenOn(enabled) {
    wx.setKeepScreenOn({
      keepScreenOn: enabled,
      fail: () => {}
    })
  },

  noop() {},

  updateWashingViewport() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = info.windowWidth || 375
    const windowHeight = info.windowHeight || 667
    const heightRpx = windowHeight * 750 / windowWidth
    const bottomInset = info.safeArea ? Math.max(0, windowHeight - info.safeArea.bottom) : 0

    this.setData({
      washingSizeClass: getWashingSizeClass(heightRpx),
      washingViewportStyle: `height:${windowHeight}px;--safe-bottom:${bottomInset}px;`
    })
  },

  loadAccountSummary() {
    Promise.all([
      api.wallet.get().catch(() => null),
      api.member.cards().catch(() => []),
      api.coupons.mine({ status: 'available', page: 0, size: 1 }).catch(() => null)
    ])
      .then(([wallet, cards, coupons]) => {
        this.setData({
          accountSummary: buildAccountSummary(wallet, cards, coupons)
        })
      })
      .catch(() => {})
  },

  pollStatus() {
    if (!this.data.orderNo) return

    api.wash.status(this.data.orderNo)
      .then((status) => {
        const washStatus = String((status && status.washStatus) || '').toLowerCase()

        if (washStatus === 'starting') {
          clearInterval(this.timer)
          redirectToOrder(Object.assign({ orderNo: this.data.orderNo }, status || {}))
          return
        }

        const duration = status.duration || {}
        const machine = status.machine || {}
        const usedDurationSec = Number(
          duration.usedDurationSec
          || duration.machineStartSec
          || status.usedDurationSec
          || status.machineStartSec
          || status.washDurationSec
          || 0
        )

        this.setData({
          seconds: usedDurationSec,
          displayClock: formatClock(usedDurationSec),
          machineStatus: machine.machineStatus || status.washStatus || 'running',
          machineStatusText: getMachineStatusText(machine.machineStatus, status.washStatus),
          machineId: machine.machineId || status.machineId || this.data.machineId,
          siteId: status.siteId || machine.siteId || this.data.siteId
        })

        if (isTerminalOrderStatus(status)) {
          this.goToFinishPage()
        }
      })
      .catch((err) => {
        wx.showToast({
          title: err.message || '状态刷新失败',
          icon: 'none'
        })
      })
  },

  openFaultReport() {
    const reports = wx.getStorageSync(STORAGE_KEYS.faultReports) || []
    const reported = reports.some((item) => String(item.orderNo) === String(this.data.orderNo))
    if (this.data.faultReported || reported) {
      this.setData({ faultReported: true })
      wx.showModal({ title: '已上报', content: '本订单的故障已提交，请等待核查。同一订单仅保留首次上报内容。', showCancel: false })
      return
    }
    this.setData({ faultPanelVisible: true })
  },

  openRemoteControl() {
    if (!this.data.orderNo) return

    wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, this.data.orderNo)
    wx.redirectTo({
      url: `/pages/device-control/device-control?orderNo=${encodeURIComponent(this.data.orderNo)}`
    })
  },

  closeFaultReport() {
    if (this.data.reporting) return

    this.setData({ faultPanelVisible: false })
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
  },

  backHome() {
    wx.reLaunch({
      url: '/pages/home/home'
    })
  },

  finishWash() {
    if (!this.data.orderNo || this.data.stopping) return

    this.setData({ stopping: true })
    wx.showLoading({ title: '结束洗车' })

    api.wash.stop(this.data.orderNo, {
      clientRequestId: makeClientRequestId('mini-stop'),
      reason: 'user_stop'
    })
      .then(() => this.waitForFinished())
      .catch((err) => {
        wx.showToast({
          title: err.code === 'SETTLEMENT_PENDING'
            ? '订单正在结束结算，请稍候'
            : (err.message || '结束洗车失败'),
          icon: 'none'
        })
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ stopping: false })
      })
  },

  goToFinishPage() {
    if (this.finishNavigating) return

    this.finishNavigating = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    wx.removeStorageSync(STORAGE_KEYS.currentWashOrderNo)
    wx.redirectTo({
      url: `/pages/wash-finish/wash-finish?orderNo=${encodeURIComponent(this.data.orderNo)}`
    })
  },

  waitForFinished() {
    let tries = 0
    const maxTries = 15

    return new Promise((resolve, reject) => {
      const tick = () => {
        tries += 1

        api.wash.status(this.data.orderNo)
          .then((status) => {
            if (isTerminalOrderStatus(status)) {
              this.goToFinishPage()
              resolve()
              return
            }

            if (tries >= maxTries) {
              reject(Object.assign(new Error('订单仍在结束结算'), { code: 'SETTLEMENT_PENDING' }))
              return
            }

            setTimeout(tick, 2000)
          })
          .catch((err) => {
            if (tries >= maxTries) {
              reject(err)
              return
            }

            setTimeout(tick, 2000)
          })
      }

      tick()
    })
  }
})
