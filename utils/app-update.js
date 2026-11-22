const { STORAGE_KEYS } = require('./config')

const WASH_PAGES = new Set([
  'pages/scan/scan', 'pages/wash-confirm/wash-confirm',
  'pages/wash-ready/wash-ready', 'pages/device-control/device-control',
  'pages/washing/washing', 'pages/group-buy-redeem/group-buy-redeem'
])

let manager = null
let initialized = false
let foreground = false
let ready = false
let prompting = false
let deferred = false
let applying = false
let timer = null

function safeToUpdate() {
  if (wx.getStorageSync(STORAGE_KEYS.currentWashOrderNo)) return false
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  if (!page || WASH_PAGES.has(page.route)) return false
  const data = page.data || {}
  if (data.payingId || data.starting || data.stopping || data.remoteStarting || data.submitting || data.profileSaving) return false
  if (page.route === 'pages/wash-finish/wash-finish' && !data.settlementResolved) return false
  return true
}

function present() {
  if (!foreground || !ready || prompting || deferred || applying || !safeToUpdate()) return
  prompting = true
  wx.showModal({
    title: '新版本已就绪',
    content: '新版本已下载完成，重新打开即可使用。是否立即更新？',
    confirmText: '立即更新',
    cancelText: '稍后更新',
    confirmColor: '#1262e8',
    success: (result) => {
      if (!result.confirm) {
        deferred = true
        return
      }
      // State may change while the dialog is open, for example on another device.
      if (!foreground || !safeToUpdate()) return
      applying = true
      try {
        manager.applyUpdate()
      } catch (_) {
        applying = false
        deferred = true
        wx.showToast({ title: '更新暂未完成，请稍后重新打开小程序', icon: 'none' })
      }
    },
    fail: () => { deferred = true },
    complete: () => { prompting = false }
  })
}

function initialize() {
  if (initialized || typeof wx.getUpdateManager !== 'function') return
  initialized = true
  manager = wx.getUpdateManager()
  manager.onUpdateReady(() => { ready = true; present() })
  manager.onUpdateFailed(() => {
    ready = false
    if (foreground && safeToUpdate()) {
      wx.showToast({ title: '新版下载未完成，请检查网络后重新打开小程序', icon: 'none' })
    }
  })
}

function start() {
  foreground = true
  deferred = false
  initialize()
  present()
  if (!timer) timer = setInterval(present, 5000)
}

function stop() {
  foreground = false
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { start, stop }
