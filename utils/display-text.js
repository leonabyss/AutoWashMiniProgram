function chineseText(value, fallback) {
  const text = String(value || '').trim()
  if (!text) return fallback
  if (/timeout|timed out/i.test(text)) return '请求超时，请检查网络后重试'
  if (/request:fail|network|fetch|socket|connection/i.test(text)) return '网络连接异常，请检查网络后重试'
  return /[a-z]/i.test(text) ? fallback : text
}

module.exports = { chineseText }
