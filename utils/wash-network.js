const OFFLINE = '网络已断开，状态暂未更新。请使用设备实体按钮，订单是否结束以联网后的结果为准。'

module.exports = Behavior({
  data: { networkOffline: false, networkNotice: '' },
  methods: {
    startNetworkWatch() {
      this.networkWatchActive = true
      this.networkChangeHandler = (result) => {
        if (!this.networkWatchActive) return
        const wasOffline = this.data.networkOffline
        this.setData({
          networkOffline: !result.isConnected,
          networkNotice: result.isConnected ? (wasOffline ? '网络已恢复，正在同步订单状态' : this.data.networkNotice) : (this.data.reviewMode ? '网络已断开，模拟订单状态暂未更新，请联网后再操作。' : OFFLINE)
        })
        if (result.isConnected && wasOffline) this.refreshNetworkOrder()
      }
      wx.onNetworkStatusChange(this.networkChangeHandler)
      wx.getNetworkType({
        success: (result) => this.networkChangeHandler({ isConnected: result.networkType !== 'none' }),
        fail: () => {}
      })
    },
    stopNetworkWatch() {
      this.networkWatchActive = false
      if (this.networkChangeHandler) wx.offNetworkStatusChange(this.networkChangeHandler)
    },
    refreshNetworkOrder() {
      if (this.pollStatus) this.pollStatus()
      else if (this.pollRemoteStatus) this.pollRemoteStatus()
    },
    markNetworkSynced() {
      if (this.networkWatchActive && !this.data.networkOffline) this.setData({ networkNotice: '' })
    },
    markNetworkFailure(err) {
      if (!this.networkWatchActive) return
      if (this.data.reviewMode && err && String(err.code || '').indexOf('REVIEW_') === 0) {
        this.setData({ networkNotice: `${err.message}。请返回首页退出体验模式。` })
        return
      }
      this.setData({ networkNotice: this.data.networkOffline ? OFFLINE : '订单状态同步失败，正在重试。设备可能仍在运行，请勿将此提示视为洗车已结束。' })
    },
    canSendWashCommand() {
      if (!this.data.networkOffline) return true
      wx.showModal({ title: '网络已断开', content: this.data.reviewMode ? '暂时无法发送模拟指令，请联网后重试。订单状态以服务端返回为准。' : '暂时无法发送指令，请使用设备实体按钮。订单是否结束以联网后的结果为准。', showCancel: false })
      return false
    }
  }
})
