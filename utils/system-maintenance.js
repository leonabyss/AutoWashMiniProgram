const config = require('./config')
const endpoint = config.API_BASE_URL
  ? `${config.API_BASE_URL}/mini/system/maintenance`
  : `${config.BASE_URL}${config.API_PREFIX}/system/maintenance`

let timer = null
let foreground = false
let checking = false
let modalOpen = false
let lastShownVersion = ''
let lastShownAt = 0
let state = { phase: 'normal', blockNewOrders: false }
const listeners = new Set()

function notify() {
  listeners.forEach((listener) => listener({ visible: modalOpen, state }))
}

function subscribe(listener) {
  listeners.add(listener)
  listener({ visible: modalOpen, state })
  return () => listeners.delete(listener)
}

function dismiss() {
  modalOpen = false
  notify()
}

function present() {
  if (!foreground || modalOpen || state.phase === 'normal') return
  const version = state.version || state.phase
  if (version === lastShownVersion || Date.now() - lastShownAt < 60000) return
  modalOpen = true
  lastShownVersion = version
  lastShownAt = Date.now()
  notify()
}

function accept(next) {
  if (!next || typeof next !== 'object' || !next.phase) return
  const wasBlocked = state.blockNewOrders
  state = next
  if (next.phase === 'normal') {
    dismiss()
    lastShownVersion = ''
    if (wasBlocked && foreground) wx.showToast({ title: '维护已结束，可以正常使用', icon: 'none' })
    return
  }
  if (modalOpen) notify()
  present()
}

function check() {
  if (!foreground || checking) return
  checking = true
  // 独立请求，不经过登录刷新或支付重试逻辑；服务停机时由Nginx返回状态文件。
  wx.request({
    url: endpoint,
    method: 'GET',
    timeout: 10000,
    header: { 'Cache-Control': 'no-cache' },
    success: (response) => {
      if (response.statusCode === 200 && response.data && response.data.success) accept(response.data.data)
    },
    complete: () => { checking = false }
  })
}

function start() {
  foreground = true
  present()
  check()
  if (!timer) timer = setInterval(check, 30000)
}

function stop() {
  foreground = false
  if (timer) clearInterval(timer)
  timer = null
}

function handleResponse(body) {
  if (!body || body.code !== 'SYSTEM_MAINTENANCE') return false
  // 普通业务请求只作为兜底，避免覆盖维护接口的恢复时间和通知内容。
  if (state.phase === 'normal') {
    accept({ phase: 'deploying', blockNewOrders: true, version: 'maintenance-response', message: body.message })
  }
  check()
  return true
}

module.exports = { start, stop, handleResponse, subscribe, dismiss, getStatus: () => state }
