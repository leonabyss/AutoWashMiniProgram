const api = require('../../utils/api')
const { ensurePhoneBound } = require('../../utils/auth')
const { hasStoredSession } = require('../../utils/request')
const { STORAGE_KEYS } = require('../../utils/config')
const { getCurrentLocation } = require('../../utils/location')
const { parseMachineMid, parsePromotionCode } = require('../../utils/format')
const { redirectToOrder } = require('../../utils/wash-route')

Page({
  data: {
    reviewMode: false,
    resolving: false,
    cameraReady: false,
    canScan: false,
    errorText: '',
    scanStatusText: '正在准备摄像头',
    scanStatusTone: 'pending',
    albumSelecting: false,
    flashMode: 'off',
    torchOn: false,
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
    const cameraTop = Math.round((108 + (this.data.reviewMode ? 44 : 0)) * rpx)
    const actionHeight = Math.round(((windowHeight <= 680 ? 156 : 180) + (this.data.reviewMode ? 112 : 0)) * rpx) + safeBottom
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

  guardScanAccess() {
    const checkMode = hasStoredSession() ? api.review.status() : Promise.resolve(null)
    checkMode.then((status) => {
      if (status && status.reviewMode) {
        this.setData({ reviewMode: true })
        if (!status.enabled || status.expired || status.autoScan !== true) {
          throw new Error('审核体验已过期或未开放，请在首页退出体验模式')
        }
        this.updateScanLayout()
        this.setScanStatus('请点击下方审核体验按钮', 'pending')
        return true
      }
      return ensurePhoneBound().then(() => true)
    })
      .then((canScan) => {
        if (!canScan) return
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
    if (!this.data.resolving && !this.data.albumSelecting) this.restoreScanStatus()
  },

  onCameraError(event) {
    this.setData({
      cameraReady: false,
      errorText: '无法打开摄像头，请检查权限'
    })
    if (!this.data.resolving) this.setScanStatus('摄像头不可用', 'error')
  },

  setScanStatus(text, tone) {
    this.setData({ scanStatusText: text, scanStatusTone: tone || 'pending' })
  },

  restoreScanStatus() {
    if (this.data.reviewMode) {
      this.setScanStatus('请点击下方审核体验按钮', 'pending')
      return
    }
    if (this.data.errorText) this.setScanStatus('摄像头不可用', 'error')
    else this.setScanStatus(this.data.cameraReady ? '请对准设备二维码' : '正在准备摄像头', this.data.cameraReady ? 'scanning' : 'pending')
  },

  redirectAfterScan(url) {
    wx.redirectTo({
      url,
      fail: () => {
        this.setData({ resolving: false })
        this.setScanStatus('页面打开失败，请重试', 'error')
      }
    })
  },

  onScanCode(event) {
    if (this.data.reviewMode) return
    if (!this.data.canScan || this.data.albumSelecting) return

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
    if (this.data.reviewMode) {
      wx.showToast({ title: '体验模式请使用下方审核按钮', icon: 'none' })
      return
    }

    this.setData({ albumSelecting: true })
    this.setScanStatus('等待选择二维码图片')

    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        this.setData({ albumSelecting: false })
        this.resolveQr(res.result)
      },
      fail: (err) => {
        this.setData({ albumSelecting: false })
        if (!String(err.errMsg || '').includes('cancel')) {
          this.setScanStatus('图片识别失败，请重试', 'error')
          wx.showToast({
            title: '扫码失败',
            icon: 'none'
          })
        } else this.restoreScanStatus()
      }
    })
  },

  resolveQr(rawResult) {
    if (!this.data.canScan || this.data.resolving) return
    if (this.data.reviewMode) return

    const promotionCode = parsePromotionCode(rawResult)
    if (promotionCode) {
      this.resolvePromotionCode(promotionCode)
      return
    }

    const mid = parseMachineMid(rawResult)

    if (!mid) {
      this.setScanStatus('二维码无效，请重新扫码', 'error')
      wx.showToast({
        title: '二维码无效',
        icon: 'none'
      })
      return
    }

    this.setData({ resolving: true })
    this.setScanStatus('正在获取当前位置')
    wx.showLoading({ title: '识别机器中' })

    getCurrentLocation()
      .then((location) => {
        this.setScanStatus('正在识别设备信息')
        return api.scan.resolve({ mid, lat: location.latitude, lng: location.longitude })
      })
      .then((result) => {
        this.setScanStatus('识别成功，正在进入', 'success')
        wx.setStorageSync(STORAGE_KEYS.lastScan, Object.assign({}, result, { mid }))

        if (result.resumeOrder && result.resumeOrder.shouldResume && redirectToOrder(result.resumeOrder)) {
          return
        }

        this.redirectAfterScan(`/pages/wash-confirm/wash-confirm?mid=${encodeURIComponent(mid)}`)
      })
      .catch((err) => {
        if (err.code === 'PHONE_REQUIRED') {
          this.setScanStatus('请先完成手机号授权')
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
        this.setScanStatus('识别失败，请重试', 'error')
      })
      .finally(() => {
        wx.hideLoading()
      })
  },

  async scanReviewDevice() {
    if (!this.data.reviewMode || !this.data.canScan || this.data.resolving) return
    this.setData({ resolving: true })
    this.setScanStatus('正在识别模拟设备', 'pending')
    try {
      const status = await api.review.status()
      if (!status.reviewMode || !status.enabled || status.expired || status.autoScan !== true) {
        throw new Error('审核体验已过期或未开放，请在首页退出体验模式')
      }
      const result = await api.review.scan()
      if (result.scanSuccess !== true || result.reviewMode !== true || result.simulated !== true) {
        throw new Error('模拟设备识别失败，请重试')
      }
      wx.setStorageSync('reviewScanInfo', result)
      this.setScanStatus('识别成功，正在进入', 'success')
      this.redirectAfterScan('/pages/wash-confirm/wash-confirm?review=1')
    } catch (err) {
      this.setData({ resolving: false })
      this.setScanStatus('模拟识别失败，请重试', 'error')
      wx.showModal({ title: '识别未完成', content: err.message || '请稍后重试', showCancel: false })
    }
  },

  resolvePromotionCode(code) {
    this.setData({ resolving: true })
    this.setScanStatus('正在读取领券活动')
    wx.showLoading({ title: '读取领券活动' })

    api.promotions.detail(code)
      .then((activity) => {
        this.setScanStatus('活动已识别，等待确认')
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
        if (!confirmed) {
          this.restoreScanStatus()
          return null
        }
        this.setScanStatus('正在领取洗车券')
        wx.showLoading({ title: '正在领取' })
        return api.promotions.claim(code)
      })
      .then((result) => {
        if (!result) return
        this.setScanStatus('领取成功', 'success')
        wx.hideLoading()
        wx.showModal({
          title: '领取成功',
          content: `${result.couponName || '洗车券'}已放入你的账户`,
          showCancel: false,
          confirmText: '查看洗车券',
          success: () => this.redirectAfterScan('/pages/coupons/coupons')
        })
      })
      .catch((err) => {
        this.setScanStatus('领取失败，请重试', 'error')
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
    }, () => this.startScanAnimation())
    this.restoreScanStatus()
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
