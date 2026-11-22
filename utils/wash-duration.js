function backendWorkSeconds(...sources) {
  for (const source of sources) {
    if (!source) continue
    const duration = source.duration || {}
    const values = [duration.usedDurationSec, source.usedDurationSec,
      duration.machineStartSec, source.machineStartSec]
    // Review orders have a separate server-calculated duration contract.
    if (source.reviewMode === true && source.simulated === true) values.push(source.washDurationSec)
    for (const value of values) {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds)
    }
  }
  return null
}

module.exports = { backendWorkSeconds }
