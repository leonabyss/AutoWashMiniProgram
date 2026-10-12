module.exports = Behavior({
  data: {
    faultSheetOffset: 0,
    faultSheetDragging: false
  },

  lifetimes: {
    detached() {
      if (this.faultSheetTimer) clearTimeout(this.faultSheetTimer)
    }
  },

  methods: {
    resetFaultSheet() {
      if (this.faultSheetTimer) clearTimeout(this.faultSheetTimer)
      this.faultSheetTimer = null
      this.faultSheetClosing = false
      this.faultSheetTouch = null
      this.setData({ faultSheetOffset: 0, faultSheetDragging: false })
    },

    onFaultSheetStart(event) {
      if (this.data.reporting || this.faultSheetClosing) return
      const touch = event.touches && event.touches[0]
      if (!touch || event.touches.length !== 1) return
      this.faultSheetTouch = { x: touch.clientX, y: touch.clientY, time: Date.now(), direction: '' }
    },

    onFaultSheetMove(event) {
      const start = this.faultSheetTouch
      const touch = event.touches && event.touches[0]
      if (!start || !touch || this.data.reporting || event.touches.length !== 1) return
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (!start.direction && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
        start.direction = dy > 0 && dy > Math.abs(dx) ? 'down' : 'other'
      }
      if (start.direction === 'down') {
        this.setData({ faultSheetOffset: Math.max(0, dy), faultSheetDragging: true })
      }
    },

    onFaultSheetEnd() {
      const start = this.faultSheetTouch
      this.faultSheetTouch = null
      if (!start || !this.data.faultSheetDragging) return
      const distance = this.data.faultSheetOffset
      const elapsed = Math.max(1, Date.now() - start.time)
      if (!this.data.reporting && (distance >= 100 || (distance >= 40 && distance / elapsed > 0.6))) {
        this.dismissFaultSheet()
      } else {
        this.setData({ faultSheetOffset: 0, faultSheetDragging: false })
      }
    },

    onFaultSheetCancel() {
      this.faultSheetTouch = null
      if (!this.faultSheetClosing) this.setData({ faultSheetOffset: 0, faultSheetDragging: false })
    },

    dismissFaultSheet() {
      if (this.data.reporting || !this.data.faultPanelVisible || this.faultSheetClosing) return
      this.faultSheetClosing = true
      this.faultSheetTouch = null
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.setData({ faultSheetOffset: info.windowHeight || 800, faultSheetDragging: false })
      this.faultSheetTimer = setTimeout(() => {
        this.faultSheetTimer = null
        this.faultSheetClosing = false
        this.setData({ faultPanelVisible: false, faultSheetOffset: 0, faultSheetDragging: false })
      }, 240)
    }
  }
})
