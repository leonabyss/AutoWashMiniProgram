const api = require('./api')
const { ownerKey } = require('./review-mode')
const { centToYuan } = require('./format')

const STORAGE_KEY = 'reviewPurchasePreviews'

function records() {
  const owner = ownerKey()
  const saved = wx.getStorageSync(STORAGE_KEY)
  return owner && Array.isArray(saved) ? saved.filter((item) => item.owner === owner) : []
}

function validateStatus(status) {
  if (!status || status.reviewMode !== true || status.enabled === false || status.expired === true) {
    throw new Error('体验资格已失效，请返回首页重新检查')
  }
}

async function purchase(product, site, status) {
  validateStatus(status)
  const owner = ownerKey()
  if (!owner) throw new Error('请先登录')
  const recharge = product.cardKind === 'wash_card'
  const confirmed = await new Promise((resolve, reject) => wx.showModal({
    title: recharge ? '模拟充值确认' : '模拟购卡确认',
    content: `${product.name} · ¥${centToYuan(product.priceCent)}\n不扣真实费用，仅保存本机体验记录。后台暂未提供此模拟接口，不会增加体验余额或发放可结算卡券。`,
    confirmText: '确认模拟',
    success: (result) => resolve(result.confirm),
    fail: reject
  }))
  if (!confirmed) return null
  // Revalidate after the modal; never let an expired or switched account write a receipt.
  validateStatus(await api.review.status())
  if (ownerKey() !== owner) throw new Error('登录账号已变化，请重新操作')
  const saved = wx.getStorageSync(STORAGE_KEY)
  const receipt = {
    id: `preview-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    owner,
    kind: recharge ? 'recharge' : 'member',
    name: product.name,
    priceCent: product.priceCent,
    rightsText: product.rightsText || product.validityText || '',
    siteName: site.siteName,
    createdAt: new Date().toISOString()
  }
  wx.setStorageSync(STORAGE_KEY, [receipt].concat(Array.isArray(saved) ? saved : []))
  return receipt
}

module.exports = { records, purchase }
