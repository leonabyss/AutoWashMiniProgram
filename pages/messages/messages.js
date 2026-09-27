const api = require('../../utils/api')
const { STORAGE_KEYS } = require('../../utils/config')
const { ensureLogin } = require('../../utils/request')

function formatDate(value) {
  if (!value) return '--'
  const raw = String(value)
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16)
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeMessage(item) {
  const messageId = item.messageId || item.id
  const messageType = String(item.messageType || '')
  return Object.assign({}, item, {
    id: messageId,
    messageId,
    messageType,
    desc: item.content || '你有一条新的账户通知',
    time: formatDate(item.pushedAt),
    unread: String(item.status || '').toLowerCase() === 'unread',
    category: messageType === 'coupon_issued' ? '权益到账' : '系统通知',
    benefit: messageType === 'coupon_issued' ? '洗车券已存入账户' : '',
    source: item.bizType || '泡泡洗车'
  })
}

function syncBadge(summary) {
  const count = Number((summary && summary.unreadCount) || 0)
  if (count > 0) {
    wx.setTabBarBadge({ index: 2, text: count > 99 ? '99+' : String(count), fail: () => {} })
  } else {
    wx.removeTabBarBadge({ index: 2, fail: () => {} })
  }
}

Page({
  data: {
    messages: [],
    loading: true,
    loadError: false
  },

  onShow() {
    this.loadMessages()
  },

  onPullDownRefresh() {
    this.loadMessages().finally(() => wx.stopPullDownRefresh())
  },

  loadMessages() {
    this.setData({ loading: true, loadError: false })
    return ensureLogin()
      .then(() => Promise.all([
        api.messages.list({ page: 0, size: 50 }),
        api.messages.unreadSummary()
      ]))
      .then(([page, summary]) => {
        this.setData({ messages: ((page && page.items) || []).map(normalizeMessage) })
        syncBadge(summary)
      })
      .catch(() => this.setData({ loadError: true }))
      .finally(() => this.setData({ loading: false }))
  },

  openMessage(event) {
    const messageId = event.currentTarget.dataset.id
    const message = this.data.messages.find((item) => String(item.messageId) === String(messageId))
    if (!message) return

    wx.setStorageSync(STORAGE_KEYS.currentMessage, message)
    if (message.unread) {
      this.setData({
        messages: this.data.messages.map((item) => String(item.messageId) === String(messageId)
          ? Object.assign({}, item, { unread: false, status: 'read' })
          : item)
      })
      api.messages.read(messageId)
        .then(() => api.messages.unreadSummary())
        .then(syncBadge)
        .catch(() => {})
    }

    wx.navigateTo({
      url: `/pages/message-detail/message-detail?messageId=${encodeURIComponent(messageId)}`
    })
  },

  retry() {
    this.loadMessages()
  }
})
