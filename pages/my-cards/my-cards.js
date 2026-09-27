const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/request')
const { centToYuan, secToText } = require('../../utils/format')

function formatDate(value) {
  if (!value) return '--'

  const raw = String(value)
  let date = new Date(raw)

  if (Number.isNaN(date.getTime())) {
    date = new Date(raw.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:?\d{2}|Z)$/i, '').replace(/-/g, '/'))
  }

  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16)

  const pad = (number) => String(number).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function statusText(status, fallback) {
  const map = {
    available: '可用',
    active: '可用',
    enabled: '可用',
    normal: '可用',
    unused: '未使用',
    expired: '已过期',
    disabled: '不可用',
    unavailable: '不可用',
    used: '已用完',
    exhausted: '已用完',
    depleted: '已用完',
    frozen: '已冻结',
    locked: '使用中',
    using: '使用中',
    in_use: '使用中',
    reserved: '已锁定',
    pending: '待生效',
    inactive: '未激活',
    not_started: '未生效',
    pending_activation: '待激活',
    cancelled: '已取消',
    canceled: '已取消',
    refunded: '已退款',
    invalid: '已失效',
    revoked: '已作废',
    deleted: '已删除'
  }

  const value = String(status || '').trim()
  return map[value.toLowerCase()] || (/^[^a-zA-Z]*[\u4e00-\u9fff]/.test(value) ? value : (fallback || '状态待确认'))
}

function kindText(card) {
  const kind = String(card.cardKind || '').toLowerCase()
  const productType = String(card.productType || '').toLowerCase()

  if (kind === 'wash_card' || productType.indexOf('wash_card') >= 0) return '洗车卡'
  if (kind === 'single_card' || productType.indexOf('single') >= 0) return '次卡'
  return '包月会员'
}

function cardCategory(card) {
  const kind = String(card.cardKind || '').toLowerCase()
  const productType = String(card.productType || '').toLowerCase()

  if (kind === 'wash_card' || productType.indexOf('wash_card') >= 0) return 'washCard'
  if (kind === 'single_card' || productType.indexOf('single') >= 0) return 'coupon'
  return 'member'
}

function normalizeCard(card) {
  const amountCent = Number(card.remainingAmountCent || 0)
  const durationSec = Number(card.remainingDurationSec || 0)
  const times = Number(card.remainingTimes || 0)
  let remainText = '暂无可用额度'

  if (amountCent > 0) {
    remainText = `余额 ¥${centToYuan(amountCent)}`
  } else if (durationSec > 0) {
    remainText = `剩余 ${secToText(durationSec)}`
  } else if (times > 0) {
    remainText = `剩余 ${times} 次`
  }

  return {
    type: 'card',
    uniqueId: `card-${card.cardId}`,
    category: cardCategory(card),
    cardId: card.cardId,
    name: card.name || kindText(card),
    kindText: kindText(card),
    statusText: card.canUse === false
      ? statusText(card.unavailableReason, statusText(card.status, '不可用'))
      : statusText(card.status),
    statusClass: card.canUse === false ? 'disabled' : String(card.status || '').toLowerCase(),
    remainText,
    totalDurationText: Number(card.totalDurationSec || 0) ? secToText(card.totalDurationSec) : '',
    totalTimesText: Number(card.totalTimes || 0) ? `${card.totalTimes} 次` : '',
    validFromText: formatDate(card.validFrom),
    validToText: formatDate(card.validTo),
    productOrderNo: card.productOrderNo || '--'
  }
}

function normalizeCoupons(list) {
  return (list || []).map((coupon) => ({
    type: 'coupon',
    uniqueId: `coupon-${coupon.couponId || coupon.id}`,
    couponId: coupon.couponId || coupon.id,
    name: coupon.name || '洗车券',
    kindText: coupon.detailText || '洗车券',
    statusText: statusText(coupon.status || 'active'),
    statusClass: String(coupon.status || 'active').toLowerCase(),
    remainText: Number(coupon.minutes || 0) ? `${coupon.minutes}分钟` : '可用洗车券',
    validFromText: '--',
    validToText: formatDate(coupon.expireAt),
    productOrderNo: coupon.detailText || '赠送/购买获得'
  }))
}

function getTabIndex(key) {
  const map = {
    member: 0,
    washCard: 1,
    coupon: 2
  }

  return map[key] || 0
}

Page({
  data: {
    tabs: [
      { key: 'member', label: '包月会员' },
      { key: 'washCard', label: '洗车卡' },
      { key: 'coupon', label: '洗车券' }
    ],
    activeTab: 'member',
    activeTabIndex: 0,
    memberCards: [],
    washCards: [],
    coupons: [],
    currentItems: [],
    loading: false
  },

  onLoad(options) {
    const activeTab = options && ['member', 'washCard', 'coupon'].indexOf(options.tab) >= 0
      ? options.tab
      : 'member'
    this.setData({ activeTab, activeTabIndex: getTabIndex(activeTab) })
    this.loadCards()
  },

  onPullDownRefresh() {
    this.loadCards().finally(() => wx.stopPullDownRefresh())
  },

  loadCards() {
    this.setData({ loading: true })

    return ensureLogin()
      .then(() => Promise.all([
        api.member.cards().catch(() => []),
        api.member.temporaryCards({ activeOnly: false }).catch(() => []),
        api.coupons.mine({ page: 0, size: 50 }).catch(() => null)
      ]))
      .then(([cards, temporaryCards, couponPage]) => {
        const normalizedCards = (cards || []).concat(temporaryCards || []).map(normalizeCard)
        const memberCards = normalizedCards.filter((card) => card.category === 'member')
        const washCards = normalizedCards.filter((card) => card.category === 'washCard')
        const coupons = normalizedCards
          .filter((card) => card.category === 'coupon')
          .concat(normalizeCoupons((couponPage && couponPage.items) || couponPage || []))

        this.setData({
          memberCards,
          washCards,
          coupons
        })

        this.refreshCurrentItems()
      })
      .catch((err) => {
        wx.showToast({
          title: err.message || '洗车卡加载失败',
          icon: 'none'
        })
      })
      .finally(() => {
        this.setData({ loading: false })
      })
  },

  switchTab(event) {
    const activeTab = event.currentTarget.dataset.key

    this.setData({
      activeTab,
      activeTabIndex: getTabIndex(activeTab)
    })
    this.refreshCurrentItems()
  },

  refreshCurrentItems() {
    const map = {
      member: this.data.memberCards,
      washCard: this.data.washCards,
      coupon: this.data.coupons
    }

    this.setData({
      currentItems: map[this.data.activeTab] || []
    })
  }
})
