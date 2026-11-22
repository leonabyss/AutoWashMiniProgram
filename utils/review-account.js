const api = require('./api')
const { ownerKey, registerOrder, getOrderSnapshots, normalizeOrder } = require('./review-mode')

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
  const snapshots = getOrderSnapshots()
  const numbers = new Set(Object.keys(snapshots).filter((key) => snapshots[key].owner === owner))
  if (status.currentOrderNo) numbers.add(status.currentOrderNo)
  let stale = false
  const items = await Promise.all(Array.from(numbers).map(async (number) => {
    const saved = snapshots[number] && snapshots[number].owner === owner ? snapshots[number].order : null
    // Completed order fields are immutable; no need to re-read every historical order on each visit.
    if (saved && saved.status === 'finished') return asRecord(normalizeOrder(saved))
    if ((!status.enabled || status.expired) && saved) { stale = true; return asRecord(normalizeOrder(saved)) }
    try {
      return asRecord(registerOrder(await api.review.orderStatus(number)))
    } catch (err) {
      if (!saved) throw err
      stale = true
      return asRecord(normalizeOrder(saved))
    }
  }))
  items.sort((a, b) => String(b.createdAt || b.finishedAt || '').localeCompare(String(a.createdAt || a.finishedAt || '')))
  return { items, stale }
}

module.exports = { history }
