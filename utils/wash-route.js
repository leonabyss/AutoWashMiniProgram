const { STORAGE_KEYS } = require('./config')

function getOrderNo(order) {
  return order && (order.orderNo || order.washOrderNo || order.washOrderId)
}

function getWashStatus(order) {
  return String((order && order.washStatus) || '').toLowerCase()
}

function getOrderStatus(order) {
  return String((order && order.orderStatus) || '').toLowerCase()
}

function isWashRunning(washStatus) {
  return washStatus === 'running' || washStatus === 'runing'
}

function buildOrderUrl(page, orderNo) {
  return `/pages/${page}/${page}?orderNo=${encodeURIComponent(orderNo)}`
}

function getResumeTarget(order) {
  const orderNo = getOrderNo(order)
  const washStatus = getWashStatus(order)
  const orderStatus = getOrderStatus(order)

  if (!orderNo) return null

  const terminalStatuses = ['finished', 'completed', 'abnormal', 'failed', 'canceled', 'cancelled', 'closed', 'refunded']

  if (terminalStatuses.indexOf(washStatus) >= 0 || terminalStatuses.indexOf(orderStatus) >= 0) {
    return {
      page: 'wash-finish',
      url: buildOrderUrl('wash-finish', orderNo)
    }
  }

  if (isWashRunning(washStatus) || washStatus === 'stopping') {
    return {
      page: 'washing',
      url: buildOrderUrl('washing', orderNo)
    }
  }

  if (washStatus === 'starting' || washStatus === 'created' || orderStatus === 'paid') {
    return {
      page: 'wash-ready',
      url: buildOrderUrl('wash-ready', orderNo)
    }
  }

  return null
}

function redirectToOrder(order) {
  const orderNo = getOrderNo(order)
  const target = getResumeTarget(order)

  if (orderNo) {
    wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, orderNo)
  }

  if (!target) return false

  wx.redirectTo({
    url: target.url
  })
  return true
}

function navigateToOrder(order) {
  const orderNo = getOrderNo(order)
  const target = getResumeTarget(order)

  if (orderNo) {
    wx.setStorageSync(STORAGE_KEYS.currentWashOrderNo, orderNo)
  }

  if (!target) return false

  wx.navigateTo({
    url: target.url
  })
  return true
}

module.exports = {
  getOrderNo,
  getResumeTarget,
  isWashRunning,
  navigateToOrder,
  redirectToOrder
}
