const api = require('../../utils/api')
const { STORAGE_KEYS } = require('../../utils/config')
const { ensureLogin } = require('../../utils/request')
const { messagePresentation } = require('../../utils/message-presentation')

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
    benefit: messageType === 'coupon_issued' ? '洗车券已存入账户' : '',
    source: item.bizType || '泡泡洗车'
  }, messagePresentation(item))
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
    unreadCount: 0,
    markingAllRead: false,
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
        this.setData({ messages: ((page && page.items) || []).map(normalizeMessage), unreadCount: Number(summary.unreadCount || 0) })
        syncBadge(summary)
      })
      .catch(() => this.setData({ loadError: true }))
      .finally(() => this.setData({ loading: false }))
  },

  openMessage(event) {
    if (this.data.markingAllRead) return
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
        .then((summary) => {
          this.setData({ unreadCount: Number(summary.unreadCount || 0) })
          syncBadge(summary)
        })
        .catch(() => {})
    }

    wx.navigateTo({
      url: `/pages/message-detail/message-detail?messageId=${encodeURIComponent(messageId)}`
    })
  },

  async markAllRead() {
    if (this.data.markingAllRead || !this.data.unreadCount) return
    this.setData({ markingAllRead: true })
    let failed = false
    try {
      await ensureLogin()
      const ids = new Set()
      // Fetch every page before marking: unread pagination changes after each read.
      for (let page = 0; ; page += 1) {
        const result = await api.messages.list({ status: 'unread', page, size: 100 })
        const items = (result && result.items) || []
        const before = ids.size
        items.forEach((item) => {
          const id = item.messageId || item.id
          if (id) ids.add(id)
        })
        if (items.length < 100 || (result.totalPages && page + 1 >= result.totalPages)) break
        if (ids.size === before) throw new Error('消息列表未能完整加载，请稍后重试')
      }
      const pending = Array.from(ids)
      for (let i = 0; i < pending.length; i += 4) {
        await Promise.all(pending.slice(i, i + 4).map(async (id) => {
          try {
            await api.messages.read(id)
            this.setData({ messages: this.data.messages.map((item) => String(item.messageId) === String(id)
              ? Object.assign({}, item, { unread: false, status: 'read' }) : item) })
          } catch (err) {
            failed = true
          }
        }))
      }
      const summary = await api.messages.unreadSummary()
      this.setData({ unreadCount: Number(summary.unreadCount || 0) })
      syncBadge(summary)
      wx.showToast({ title: failed ? '部分消息未能标记，请重试' : (this.data.unreadCount ? '已处理，新消息仍待阅读' : '全部消息已读'), icon: 'none' })
    } catch (err) {
      wx.showToast({ title: '标记未完成，请检查网络后重试', icon: 'none' })
    } finally {
      this.setData({ markingAllRead: false })
    }
  },

  retry() {
    this.loadMessages()
  }
})
