const { STORAGE_KEYS } = require('./config')

const ORDER_KEY = 'reviewOrderRegistry'

function ownerKey() {
  const user = wx.getStorageSync(STORAGE_KEYS.user) || {}
  return String(user.userId || user.id || user.openid || user.openId || wx.getStorageSync(STORAGE_KEYS.accessToken) || '')
}

function registerOrder(order) {
  if (!order || order.reviewMode !== true || order.simulated !== true || !order.orderNo) {
    throw new Error('模拟订单信息不完整，请重新扫码')
  }
  const registry = wx.getStorageSync(ORDER_KEY) || {}
  registry[order.orderNo] = ownerKey()
  wx.setStorageSync(ORDER_KEY, registry)
  const snapshots = wx.getStorageSync('reviewOrderSnapshots') || {}
  snapshots[order.orderNo] = { owner: ownerKey(), order, updatedAt: Date.now() }
  wx.setStorageSync('reviewOrderSnapshots', snapshots)
  return normalizeOrder(order)
}

function isReviewOrder(orderNo) {
  const registry = wx.getStorageSync(ORDER_KEY) || {}
  return !!orderNo && Object.prototype.hasOwnProperty.call(registry, orderNo)
    && registry[orderNo] === ownerKey()
}

function normalizeOrder(order) {
  const active = order.activeFunction || ''
  const finished = order.status === 'finished'
  return Object.assign({}, order, {
    washStatus: order.status,
    orderStatus: finished ? 'finished' : 'paid',
    payMethod: 'wallet',
    siteName: '审核体验模拟场地',
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

module.exports = { registerOrder, isReviewOrder, normalizeOrder, ownerKey }
