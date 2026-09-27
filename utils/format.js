function centToYuan(cent) {
  const value = Number(cent || 0) / 100
  return value.toFixed(2).replace(/\.00$/, '')
}

function secToText(sec) {
  const seconds = Math.max(0, Number(sec || 0))

  if (seconds < 60) {
    return `${seconds}秒`
  }

  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}分${rest}秒` : `${minutes}分钟`
}

function meterToDistance(distanceM) {
  const meters = Number(distanceM || 0)

  if (!meters) return '未知'
  if (meters < 1000) return `${Math.round(meters)}m`

  return `${(meters / 1000).toFixed(1)}km`
}

function makeClientRequestId(prefix) {
  return `${prefix || 'mini'}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || '').replace(/\+/g, '%20'))
  } catch (err) {
    return ''
  }
}

function normalizeMachineMid(value) {
  const mid = String(value || '').trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(mid) ? mid : ''
}

function parseMachineMid(scanResult) {
  const raw = String(scanResult || '').trim()
  if (!raw) return ''

  const queryIndex = raw.indexOf('?')
  if (queryIndex >= 0) {
    const query = raw.slice(queryIndex + 1).split('#')[0]
    const pairs = query.split('&')
    const supportedKeys = ['mid', 'qrId', 'qr_id']

    for (let i = 0; i < pairs.length; i += 1) {
      const separatorIndex = pairs[i].indexOf('=')
      const key = safeDecode(separatorIndex >= 0 ? pairs[i].slice(0, separatorIndex) : pairs[i])
      const value = safeDecode(separatorIndex >= 0 ? pairs[i].slice(separatorIndex + 1) : '')

      if (supportedKeys.indexOf(key) >= 0 && value) {
        return normalizeMachineMid(value)
      }
    }

    return ''
  }

  if (/^https?:\/\//i.test(raw)) return ''

  return normalizeMachineMid(raw)
}

function parsePromotionCode(scanResult) {
  const raw = String(scanResult || '').trim()
  const match = raw.match(/\/public\/promotion-codes\/([^/?#]+)/i)
  return match ? normalizeMachineMid(safeDecode(match[1])) : ''
}

const parseQrId = parseMachineMid

module.exports = {
  centToYuan,
  secToText,
  meterToDistance,
  makeClientRequestId,
  parseMachineMid,
  parsePromotionCode,
  parseQrId
}
