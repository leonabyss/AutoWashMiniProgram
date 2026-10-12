const api = require('../../utils/api')
const { STORAGE_KEYS } = require('../../utils/config')
const { makeClientRequestId } = require('../../utils/format')
const { chineseText } = require('../../utils/display-text')
const { isReviewOrder } = require('../../utils/review-mode')
const { redirectToOrder } = require('../../utils/wash-route')

const ACTIONS = {
  water: {
    title: '冲水',
    loading: '正在下发冲水指令',
    success: '冲水指令已下发',
    requestId: 'mini-water',
    action: 'clean_water',
    controlType: 1
  },
  foam: {
    title: '泡沫',
    loading: '正在下发泡沫指令',
    success: '泡沫指令已下发',
    requestId: 'mini-foam',
    action: 'foam',
    controlType: 2
  },
  stop: {
    title: '停止',
    loading: '正在停止当前功能',
    success: '停止指令已下发',
    requestId: 'mini-stop',
    action: 'stop',
    controlType: 0
  }
}

function isAckSuccess(result) {
  if (!result) return false

  const commandStatus = String(result.commandStatus || '').toLowerCase()
  const responseCode = result.responseCode

  return result.accepted === true || (commandStatus === 'ack_success' && Number(responseCode) === 0)
}

function isWaitingAck(result) {
  const buttonState = String((result && result.buttonState) || '').toLowerCase()
  const commandStatus = String((result && result.commandStatus) || '').toLowerCase()

  return buttonState === 'waiting_ack' || commandStatus === 'sent' || commandStatus === 'unknown'
}

function isFailedAck(result) {
  const buttonState = String((result && result.buttonState) || '').toLowerCase()

  return buttonState === 'failed' || (result && result.responseCode !== undefined && Number(result.responseCode) !== 0)
}

function shouldStopByRemoteResult(result) {
  const buttonState = String((result && result.buttonState) || '').toLowerCase()
  const action = String((result && result.action) || '').toLowerCase()
  const controlType = Number(result && result.controlType)

  return (
    action === 'stop'
    || controlType === 0
    || buttonState === 'paused'
    || buttonState === 'pause'
    || buttonState === 'stopped'
    || buttonState === 'stop'
    || buttonState === 'idle'
  )
}

function shouldResetRemoteControl(status) {
  const washStatus = String((status && status.washStatus) || '').toLowerCase()
  const machine = (status && status.machine) || {}
  const device = (status && status.device) || {}
  const values = [
    status && status.buttonState,
    status && status.remoteButtonState,
    status && status.controlState,
    status && status.functionState,
    machine.pauseStatus,
    machine.machineStatus,
    device.buttonState,
    device.controlState,
    device.functionState
  ].map((item) => String(item || '').toLowerCase())

  return (
    washStatus === 'finished'
    || washStatus === 'stopping'
    || values.some((value) => (
      value === 'paused'
      || value === 'pause'
      || value === 'stopped'
      || value === 'stop'
      || value === 'idle'
    ))
  )
}

Page({
  behaviors: [require('../../utils/wash-network')],
  data: {
    orderNo: '',
    reviewMode: false,
    operatingKey: '',
    isOperating: false,
    activeControlKey: '',
    controlFeedback: '',
    waitingActionKey: ''
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

    wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, orderNo)
    this.setData({ orderNo, reviewMode: isReviewOrder(orderNo) })
    this.startNetworkWatch()
    this.startStatusPolling(this.data.reviewMode ? 2000 : 3000)
    this.pollRemoteStatus()
  },

  onUnload() {
    this.stopNetworkWatch()
    this.clearStatusPollTimer()
    this.clearWaitingTimer()
  },

  tapWater() {
    this.sendWashAction('water')
  },

  tapFoam() {
    this.sendWashAction('foam')
  },

  tapStop() {
    this.sendWashAction('stop')
  },

  sendWashAction(actionKey) {
    if (!this.data.orderNo || this.data.operatingKey) return
    if (!this.canSendWashCommand()) return

    const action = ACTIONS[actionKey]
    if (!action) return

    this.setData({ operatingKey: actionKey, isOperating: true })
    wx.showLoading({ title: action.loading })

    api.wash.remoteControl(this.data.orderNo, {
      clientRequestId: makeClientRequestId(action.requestId),
      action: action.action,
      controlType: action.controlType
    })
      .then((result) => {
        wx.hideLoading()
        if (this.data.reviewMode && result.washStatus === 'finished') {
          this.clearStatusPollTimer()
          redirectToOrder(result)
          return
        }

        if (isFailedAck(result)) {
          wx.showModal({
            title: `${action.title}未确认`,
            content: chineseText(result.feedbackText, '设备未确认执行，请检查设备状态'),
            showCancel: false
          })
          return
        }

        if (actionKey === 'stop' || shouldStopByRemoteResult(result)) {
          this.resetActiveControl()
        } else if (isAckSuccess(result) || (result && result.buttonState === 'running')) {
          this.startActiveControl(actionKey, result)
        } else if (isWaitingAck(result)) {
          this.markWaitingAction(actionKey, result)
        }

        wx.showToast({
          title: chineseText(result.feedbackText, action.success),
          icon: 'none'
        })
      })
      .catch((err) => {
        wx.hideLoading()
        if (err.code === 'NETWORK_ERROR') this.markNetworkFailure()
        wx.showModal({
          title: `${action.title}失败`,
          content: err.message || '后台指令下发失败，请稍后再试。',
          showCancel: false
        })
      })
      .finally(() => {
        this.setData({ operatingKey: '', isOperating: false })
      })
  },

  markWaitingAction(actionKey, result) {
    const pollMs = Math.max(1000, Number((result && result.suggestedPollMs) || 1000))

    this.clearWaitingTimer()
    this.setData({
      waitingActionKey: actionKey,
      controlFeedback: chineseText(result && result.feedbackText, '确认中')
    })
    this.startStatusPolling(pollMs)
    this.waitingTimer = setTimeout(() => {
      if (this.data.waitingActionKey === actionKey) {
        this.setData({ waitingActionKey: '', controlFeedback: '' })
      }
    }, pollMs * 3)
  },

  startActiveControl(actionKey, result) {
    this.clearWaitingTimer()
    this.setData({
      activeControlKey: actionKey,
      waitingActionKey: '',
      controlFeedback: chineseText(result && result.feedbackText, `${ACTIONS[actionKey].title}已开始`)
    })
    this.startStatusPolling(Math.max(1000, Number((result && result.suggestedPollMs) || 1000)))
  },

  resetActiveControl() {
    this.clearWaitingTimer()
    this.setData({
      activeControlKey: '',
      waitingActionKey: '',
      controlFeedback: ''
    })
  },

  clearWaitingTimer() {
    if (this.waitingTimer) {
      clearTimeout(this.waitingTimer)
      this.waitingTimer = null
    }
  },

  startStatusPolling(intervalMs) {
    this.clearStatusPollTimer()
    this.statusPollTimer = setInterval(() => {
      this.pollRemoteStatus()
    }, intervalMs || 1000)
  },

  clearStatusPollTimer() {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer)
      this.statusPollTimer = null
    }
  },

  pollRemoteStatus() {
    if (!this.data.orderNo || this.data.networkOffline || this.statusRefreshing) return
    this.statusRefreshing = true

    api.wash.status(this.data.orderNo)
      .then((status) => {
        this.markNetworkSynced()
        if (this.data.reviewMode) {
          if (status.washStatus === 'finished') {
            this.clearStatusPollTimer()
            redirectToOrder(status)
            return
          }
          this.setData({ activeControlKey: status.activeFunction || '', waitingActionKey: '' })
        }
        if (shouldResetRemoteControl(status)) {
          this.resetActiveControl()
        }
      })
      .catch((err) => this.markNetworkFailure(err))
      .finally(() => { this.statusRefreshing = false })
  },

  backToWashing() {
    if (!this.data.orderNo) {
      wx.redirectTo({ url: '/pages/washing/washing' })
      return
    }

    wx.redirectTo({
      url: `/pages/washing/washing?orderNo=${encodeURIComponent(this.data.orderNo)}`
    })
  }
})
