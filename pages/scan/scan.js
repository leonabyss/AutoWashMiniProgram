const api = require('../../utils/api')
const { ensurePhoneBound } = require('../../utils/auth')
const { STORAGE_KEYS } = require('../../utils/config')
const { getCurrentLocation } = require('../../utils/location')
const { parseMachineMid, parsePromotionCode } = require('../../utils/format')
const { redirectToOrder } = require('../../utils/wash-route')

Page({
  data: {
    resolving: false,
    cameraReady: false,
    canScan: false,
    errorText: '',
    flashMode: 'off',
    torchOn: false,
    manualQrText: 'AWQ7-F4X9K2M8P6R1T3V5',
    manualPanelExpanded: true,
    phoneAuthVisible: false,
    cameraTop: 98,
    cameraHeight: 569,
    frameLeft: 24,
    frameTop: 150,
    frameBottom: 450,
    scanSize: 300,
    maskTopHeight: 52,
    tipTop: 462,
    actionHeight: 82,
    scanLineTop: 12
  },

  onLoad() {
    this.updateScanLayout()
    this._windowResizeHandler = () => this.updateScanLayout()
    if (wx.onWindowResize) {
      wx.onWindowResize(this._windowResizeHandler)
    }
    this.guardScanAccess()
  },

  onUnload() {
    this.stopScanAnimation()
    if (wx.offWindowResize && this._windowResizeHandler) {
      wx.offWindowResize(this._windowResizeHandler)
    }
  },

  onShow() {
    this.scanVisible = true
    this.startScanAnimation()
  },

  onHide() {
    this.scanVisible = false
    this.stopScanAnimation()
    this.setData({ torchOn: false, flashMode: 'off' })
  },

  startScanAnimation() {
    this.stopScanAnimation()
    if (!this.scanVisible || !this.data.canScan) return
    const startedAt = Date.now()
    this.scanAnimationTimer = setInterval(() => {
      const phase = ((Date.now() - startedAt) % 4400) / 4400
      const progress = (1 - Math.cos(phase * Math.PI * 2)) / 2
      const scanLineTop = 12 + Math.max(0, this.data.scanSize - 26) * progress
      this.setData({ scanLineTop: Number(scanLineTop.toFixed(2)) })
    }, 16)
  },

  stopScanAnimation() {
    if (this.scanAnimationTimer) clearInterval(this.scanAnimationTimer)
    this.scanAnimationTimer = null
  },

  getWindowMetrics() {
    if (wx.getWindowInfo) {
      return wx.getWindowInfo()
    }

    return wx.getSystemInfoSync()
  },

  updateScanLayout() {
    const info = this.getWindowMetrics()
    const windowWidth = Number(info.windowWidth) || 375
    const windowHeight = Number(info.windowHeight) || 667
    const safeBottom = info.safeArea
      ? Math.max(0, windowHeight - Number(info.safeArea.bottom || windowHeight))
      : 0
    const rpx = windowWidth / 750
    const cameraTop = Math.round((this.data.manualPanelExpanded ? 190 : 108) * rpx)
    const actionHeight = Math.round((windowHeight <= 680 ? 156 : 180) * rpx) + safeBottom
    const actionTop = windowHeight - actionHeight
    const cameraSpace = Math.max(0, actionTop - cameraTop)
    const scanSize = Math.round(Math.min(
      windowWidth - 48,
      Math.max(80, cameraSpace - Math.max(110, cameraSpace * 0.26))
    ))
    const statusSpace = Math.max(90, Math.round(140 * rpx))
    const topGap = Math.max(16, Math.round((cameraSpace - scanSize - statusSpace) / 2))
    const frameTop = cameraTop + topGap
    const frameBottom = frameTop + scanSize

    this.setData({
      cameraTop,
      cameraHeight: cameraSpace,
      actionHeight,
      frameLeft: Math.round((windowWidth - scanSize) / 2),
      frameTop,
      frameBottom,
      scanSize,
      maskTopHeight: Math.max(0, frameTop - cameraTop),
      tipTop: frameBottom + Math.max(10, Math.round(18 * rpx))
    })
  },

  toggleManualPanel() {
    this.setData({
      manualPanelExpanded: !this.data.manualPanelExpanded
    }, () => this.updateScanLayout())
  },

  guardScanAccess() {
    ensurePhoneBound()
      .then(() => {
        this.setData({
          canScan: true,
          phoneAuthVisible: false
        }, () => this.startScanAnimation())
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
        this.leaveScanPage()
      })
  },

  onCameraInit() {
    this.setData({
      cameraReady: true,
      errorText: ''
    })
  },

  onCameraError(event) {
    this.setData({
      errorText: (event.detail && event.detail.errMsg) || '无法打开摄像头，请检查权限'
    })
  },

  onScanCode(event) {
    if (!this.data.canScan) return

    const result = event.detail && event.detail.result
    this.resolveQr(result)
  },

  toggleTorch() {
    if (!this.data.canScan) return

    const nextOn = !this.data.torchOn

    this.setData({
      torchOn: nextOn,
      flashMode: nextOn ? 'torch' : 'off'
    })
  },

  scanFromAlbum() {
    if (!this.data.canScan || this.data.resolving) return

    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        this.resolveQr(res.result)
      },
      fail: (err) => {
        if (!String(err.errMsg || '').includes('cancel')) {
          wx.showToast({
            title: '扫码失败',
            icon: 'none'
          })
        }
      }
    })
  },

  onManualQrInput(event) {
    this.setData({
      manualQrText: event.detail.value
    })
  },

  submitManualQr() {
    if (!this.data.canScan || this.data.resolving) return

    const value = String(this.data.manualQrText || '').trim()

    if (!value) {
      wx.showToast({
        title: '请输入二维码信息',
        icon: 'none'
      })
      return
    }

    this.resolveQr(value)
  },

  resolveQr(rawResult) {
    if (!this.data.canScan || this.data.resolving) return

    const promotionCode = parsePromotionCode(rawResult)
    if (promotionCode) {
      this.resolvePromotionCode(promotionCode)
      return
    }

    const mid = parseMachineMid(rawResult)

    if (!mid) {
      wx.showToast({
        title: '二维码无效',
        icon: 'none'
      })
      return
    }

    this.setData({ resolving: true })
    wx.showLoading({ title: '识别机器中' })

    getCurrentLocation()
      .then((location) => api.scan.resolve({
        mid,
        lat: location.latitude,
        lng: location.longitude
      }))
      .then((result) => {
        wx.setStorageSync(STORAGE_KEYS.lastScan, Object.assign({}, result, { mid }))

        if (result.resumeOrder && result.resumeOrder.shouldResume && redirectToOrder(result.resumeOrder)) {
          return
        }

        wx.redirectTo({
          url: `/pages/wash-confirm/wash-confirm?mid=${encodeURIComponent(mid)}`
        })
      })
      .catch((err) => {
        if (err.code === 'PHONE_REQUIRED') {
          this.setData({
            phoneAuthVisible: true,
            resolving: false
          })
          return
        }

        wx.showToast({
          title: err.message || '扫码解析失败',
          icon: 'none'
        })
        this.setData({ resolving: false })
      })
      .finally(() => {
        wx.hideLoading()
      })
  },

  resolvePromotionCode(code) {
    this.setData({ resolving: true })
    wx.showLoading({ title: '读取领券活动' })

    api.promotions.detail(code)
      .then((activity) => {
        wx.hideLoading()
        return new Promise((resolve) => {
          const couponName = activity.couponName || `${activity.couponMinutes || 0}分钟洗车券`
          const countText = Number(activity.couponCount || 1) > 1 ? ` × ${activity.couponCount}` : ''
          wx.showModal({
            title: activity.siteName || '洗车券领取活动',
            content: `${couponName}${countText}\n有效期：${activity.validDaysText || `${activity.couponValidDays || 1}天`}`,
            confirmText: '立即领取',
            cancelText: '暂不领取',
            success: (res) => resolve(!!res.confirm),
            fail: () => resolve(false)
          })
        })
      })
      .then((confirmed) => {
        if (!confirmed) return null
        wx.showLoading({ title: '正在领取' })
        return api.promotions.claim(code)
      })
      .then((result) => {
        if (!result) return
        wx.hideLoading()
        wx.showModal({
          title: '领取成功',
          content: `${result.couponName || '洗车券'}已放入你的账户`,
          showCancel: false,
          confirmText: '查看洗车券',
          success: () => wx.redirectTo({ url: '/pages/coupons/coupons' })
        })
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '活动领取失败', icon: 'none' })
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ resolving: false })
      })
  },

  onPhoneAuthSuccess() {
    this.setData({
      canScan: true,
      phoneAuthVisible: false
    })
  },

  onPhoneAuthCancel() {
    this.setData({ phoneAuthVisible: false })
    this.leaveScanPage()
  },

  leaveScanPage() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/home/home'
        })
      }
    })
  }
})
