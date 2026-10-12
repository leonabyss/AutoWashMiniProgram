function messagePresentation(message) {
  const type = String(message.messageType || '').toLowerCase()
  const biz = String(message.bizType || '').toLowerCase()
  let kind = 'notice'
  let category = '系统通知'
  let icon = 'circle-info-blue'

  if (type === 'wash_connection') {
    kind = 'connection'
    category = '设备连接通知'
    icon = 'remote-control'
  } else if (type.indexOf('coupon') >= 0 || biz.indexOf('coupon') >= 0) {
    kind = 'coupon'
    category = '洗车券通知'
    icon = 'ticket-blue'
  } else if (type.indexOf('recharge') >= 0 || biz === 'recharge' || biz === 'wallet') {
    kind = 'recharge'
    category = '余额通知'
    icon = 'wallet-orange'
  } else if (type.indexOf('member') >= 0 || biz === 'member_order' || biz === 'product_order' || type.indexOf('card') >= 0) {
    kind = 'card'
    category = '洗车卡通知'
    icon = 'credit-card'
  } else if (biz === 'wash_order' || type.indexOf('wash') >= 0) {
    kind = 'wash'
    category = '洗车订单通知'
    icon = 'droplets-blue'
  }

  return { iconKind: kind, iconUrl: `/assets/icons/lucide-${icon}.png`, category }
}

module.exports = { messagePresentation }
