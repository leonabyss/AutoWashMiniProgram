const api = require('../../utils/api')
const { IMAGE_BASE_URL, STORAGE_KEYS } = require('../../utils/config')
const { makeClientRequestId } = require('../../utils/format')
const { isWashRunning, redirectToOrder } = require('../../utils/wash-route')
const { isReviewOrder } = require('../../utils/review-mode')

Page({
  behaviors: [require('../../utils/wash-network')],
  data: {
    orderNo: '',
    reviewMode: false,
    statusText: '等待机器启动确认',
    remoteStarting: false,
    controlPanelImageUrl: `${IMAGE_BASE_URL}/wash-ready-control-panel.png`
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

    this.setData({ orderNo, reviewMode: isReviewOrder(orderNo) })
    this.startNetworkWatch()
    this.pollStatus()
    this.statusTimer = setInterval(() => {
      this.pollStatus()
    }, this.data.reviewMode ? 2000 : 3000)
  },

  onUnload() {
    this.stopNetworkWatch()
    this.clearStatusTimer()
  },

  clearStatusTimer() {
    if (this.statusTimer) {
      clearInterval(this.statusTimer)
      this.statusTimer = null
    }
  },

  pollStatus() {
    if (!this.data.orderNo || this.data.networkOffline || this.statusRefreshing) return
    this.statusRefreshing = true

    api.wash.status(this.data.orderNo)
      .then((status) => {
        this.markNetworkSynced()
        const washStatus = String((status && status.washStatus) || '').toLowerCase()
        const routeOrder = Object.assign({ orderNo: this.data.orderNo }, status || {})

        this.setData({
          statusText: this.statusText(washStatus)
        })

        if (isWashRunning(washStatus) || washStatus === 'stopping' || washStatus === 'finished') {
          this.clearStatusTimer()
          redirectToOrder(routeOrder)
        }

        if (washStatus === 'failed') {
          this.clearStatusTimer()
          wx.showToast({
            title: '机器启动失败',
            icon: 'none'
          })
        }
      })
      .catch((err) => this.markNetworkFailure(err))
      .finally(() => { this.statusRefreshing = false })
  },

  statusText(washStatus) {
    if (this.data.reviewMode && washStatus === 'starting') return '模拟设备准备就绪'
    const map = {
      created: '等待机器启动确认',
      paid: '等待机器启动确认',
      starting: '启动中',
      running: '机器已启动',
      runing: '机器已启动',
      stopping: '停止中',
      finished: '洗车已完成',
      failed: '机器启动失败'
    }

    return map[washStatus] || '拿起水枪 开始洗车'
  },

  openRemoteControl() {
    if (!this.data.orderNo || this.data.remoteStarting) return
    if (!this.canSendWashCommand()) return

    this.setData({ remoteStarting: true })
    this.clearStatusTimer()
    wx.showLoading({ title: '正在进入远程控制' })

    this.ensureRemoteReady()
      .then(() => {
        wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, this.data.orderNo)
        wx.redirectTo({
          url: `/pages/device-control/device-control?orderNo=${encodeURIComponent(this.data.orderNo)}`
        })
      })
      .catch((err) => {
        this.statusTimer = setInterval(() => {
          this.pollStatus()
        }, 3000)
        wx.showModal({
          title: '进入失败',
          content: err.message || '远程控制启动失败，请稍后再试。',
          showCancel: false
        })
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ remoteStarting: false })
      })
  },

  ensureRemoteReady() {
    if (this.data.reviewMode) return api.wash.start(this.data.orderNo)
    return api.wash.status(this.data.orderNo)
      .catch(() => null)
      .then((status) => {
        const washStatus = String((status && status.washStatus) || '').toLowerCase()
        const orderStatus = String((status && status.orderStatus) || '').toLowerCase()

        if (washStatus === 'starting' || isWashRunning(washStatus) || washStatus === 'stopping') {
          return status
        }

        if (washStatus === 'created' || washStatus === 'paid' || orderStatus === 'paid' || !washStatus) {
          return api.wash.start(this.data.orderNo, {
            clientRequestId: makeClientRequestId('mini-remote-start')
          })
        }

        return status
      })
  },

  backHome() {
    wx.reLaunch({
      url: '/pages/home/home'
    })
  }
})
