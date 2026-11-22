const { STORAGE_KEYS } = require('./config')

const SNAPSHOT_KEY = 'reviewOrderSnapshots'
const MAX_FINISHED_PER_OWNER = 30
const MAX_FINISHED_PER_DEVICE = 100
const FINISHED_TTL_MS = 30 * 24 * 60 * 60 * 1000
let pendingSnapshots = {}

function readStorage(key) {
  try { return wx.getStorageSync(key) } catch (_) { return null }
}

function ownerKey() {
  const user = readStorage(STORAGE_KEYS.user) || {}
  return String(user.userId || user.id || user.openid || user.openId || '')
}

function pruneSnapshots(snapshots, now = Date.now()) {
  const result = {}
  const perOwner = new Map()
  let finished = 0
  Object.entries(snapshots).sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
    .forEach(([number, record]) => {
      if (!isReviewOrder(number) || !record?.owner || !record.order) return
      if (record.order.status === 'finished') {
        const count = perOwner.get(record.owner) || 0
        if (now - Number(record.updatedAt || 0) >= FINISHED_TTL_MS ||
            count >= MAX_FINISHED_PER_OWNER || finished >= MAX_FINISHED_PER_DEVICE) return
        perOwner.set(record.owner, count + 1)
        finished++
      }
      result[number] = record
    })
  return result
}

function getOrderSnapshots() {
  return pruneSnapshots(Object.assign({}, readStorage(SNAPSHOT_KEY), pendingSnapshots))
}

function registerOrder(order) {
  if (!order || order.reviewMode !== true || order.simulated !== true || !order.orderNo) {
    throw new Error('模拟订单信息不完整，请重新扫码')
  }
  const owner = ownerKey()
  if (owner) {
    const snapshots = getOrderSnapshots()
    const events = Array.isArray(order.events) ? order.events : []
    const historyEvents = [events.find(event => event.action === 'start'), events.find(event => event.action === 'stop')].filter(Boolean)
    snapshots[order.orderNo] = { owner, order: Object.assign({}, order, { events: historyEvents }), updatedAt: Date.now() }
    const bounded = pruneSnapshots(snapshots)
    try {
      wx.setStorageSync(SNAPSHOT_KEY, bounded)
      pendingSnapshots = {}
    } catch (_) {
      pendingSnapshots = bounded
    }
    try { wx.removeStorageSync('reviewOrderRegistry') } catch (_) {}
  }
  return normalizeOrder(order)
}

function isReviewOrder(orderNo) {
  // DEMO is a server-reserved namespace. Ownership is enforced by the review API.
  return /^DEMO[0-9a-f]{32}$/.test(String(orderNo || ''))
}

function normalizeOrder(order) {
  const active = order.activeFunction || ''
  const finished = order.status === 'finished'
  return Object.assign({}, order, {
    washStatus: order.status,
    orderStatus: finished ? 'finished' : 'paid',
    payMethod: 'wallet',
    siteName: order.developerMode ? '开发测试模拟场地' : '审核体验模拟场地',
    machineName: `模拟洗车机 ${order.machineCode || '30002018'}`,
    machine: { machineStatus: active ? 'running' : 'paused' },
    buttonState: active ? 'running' : 'paused',
    accepted: order.deviceAcknowledged === true,
    action: active === 'water' ? 'clean_water' : (active || 'stop'),
    controlType: active === 'water' ? 1 : (active === 'foam' ? 2 : 0),
    feedbackText: active ? '模拟功能已开启' : '模拟功能已停止',
    suggestedPollMs: 2000
  })
}

module.exports = { registerOrder, isReviewOrder, normalizeOrder, ownerKey, getOrderSnapshots, pruneSnapshots }
