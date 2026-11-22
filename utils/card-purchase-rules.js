const { centToYuan } = require('./format')

function purchaseRuleParts(kind, rules = {}, description = '') {
  const valid = (key) => rules[key] !== null && rules[key] !== undefined && rules[key] !== '' && Number.isFinite(Number(rules[key])) && Number(rules[key]) >= 0
  if (kind === 'monthly_member') return [
    { text: '当日洗车上限' },
    { text: valid('membershipDailyLimitMinutes') ? `${rules.membershipDailyLimitMinutes}分钟` : '待配置', emphasis: true },
    { text: '，天数或额度消耗完会员将失效；按功能使用时间计时。' }
  ]
  if (kind === 'wash_card') return rules.priceConfigured === true && ['startMinutes', 'startPriceCent', 'minutePriceCent'].every(valid) ? [
    { text: `${rules.startMinutes}分钟内${centToYuan(rules.startPriceCent)}元`, emphasis: true },
    { text: '，超出按' }, { text: `${centToYuan(rules.minutePriceCent)}元/分钟`, emphasis: true },
    { text: '计费；按功能使用时间计费。' }
  ] : [{ text: '场地计费规则暂未获取，请联系场地确认。' }]
  return [{ text: description || '场地暂未提供计费说明' }]
}

module.exports = { purchaseRuleParts }
