const api = require('./api')
const { ownerKey, registerOrder } = require('./review-mode')

function asRecord(order) {
  const events = order.events || []
  const start = events.find((event) => event.action === 'start')
  const stop = events.find((event) => event.action === 'stop')
  return Object.assign({}, order, {
    amountUsedCent: order.amountCent,
    payMethod: 'review_wallet',
    createdAt: order.createdAt || (start && start.createdAt),
    finishedAt: order.finishedAt || (stop && stop.createdAt)
  })
}

async function history(status) {
  if (!status || !status.reviewMode) return { items: [], stale: false }
  const owner = ownerKey()
  const snapshots = wx.getStorageSync('reviewOrderSnapshots') || {}
  const registry = wx.getStorageSync('reviewOrderRegistry') || {}
  const numbers = new Set(Object.keys(snapshots).filter((key) => snapshots[key].owner === owner))
  Object.keys(registry).filter((key) => registry[key] === owner).forEach((key) => numbers.add(key))
  if (status.currentOrderNo) numbers.add(status.currentOrderNo)
  let stale = false
  const items = await Promise.all(Array.from(numbers).map(async (number) => {
    const saved = snapshots[number] && snapshots[number].owner === owner ? snapshots[number].order : null
    // Completed order fields are immutable; no need to re-read every historical order on each visit.
    if (saved && saved.status === 'finished') return asRecord(registerOrder(saved))
    if ((!status.enabled || status.expired) && saved) { stale = true; return asRecord(registerOrder(saved)) }
    try {
      return asRecord(registerOrder(await api.review.orderStatus(number)))
    } catch (err) {
      if (!saved) throw err
      stale = true
      return asRecord(registerOrder(saved))
    }
  }))
  items.sort((a, b) => String(b.createdAt || b.finishedAt || '').localeCompare(String(a.createdAt || a.finishedAt || '')))
  return { items, stale }
}

module.exports = { history }
