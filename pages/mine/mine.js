const api = require('../../utils/api')
const { STORAGE_KEYS } = require('../../utils/config')
const { ensureLogin, clearSession, hasStoredSession } = require('../../utils/request')
const { ensurePhoneBound, updateStoredUser } = require('../../utils/auth')
const { centToYuan, secToText } = require('../../utils/format')
const { ownerKey } = require('../../utils/review-mode')
const { history: reviewHistory } = require('../../utils/review-account')

function formatDate(value) {
  if (!value) return '--'

  const raw = String(value)
  let date = new Date(raw)

  if (Number.isNaN(date.getTime())) {
    date = new Date(raw.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:?\d{2}|Z)$/i, '').replace(/-/g, '/'))
  }

  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16)

  const pad = (number) => String(number).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusText(status) {
  const map = {
    normal: '正常',
    enabled: '可用',
    active: '可用',
    paid: '已支付',
    success: '成功',
    recharge: '充值',
    wash_order: '洗车订单',
    member_order: '购卡订单',
    pending: '待支付',
    finished: '已完成',
    running: '进行中',
    runing: '进行中',
    starting: '启动中',
    failed: '失败',
    expired: '已过期',
    disabled: '不可用',
    cancelled: '已取消',
    canceled: '已取消'
  }

  return map[String(status || '').toLowerCase()] || '状态待确认'
}

function cardTypeText(summary) {
  const memberCards = (summary && summary.memberCards) || {}
  const temporaryCards = (summary && summary.temporaryCards) || {}
  const pieces = []

  if (memberCards.monthlyMemberCount) pieces.push(`包月${memberCards.monthlyMemberCount}`)
  if (memberCards.washCardCount) pieces.push(`洗车卡${memberCards.washCardCount}`)
  if (temporaryCards.activeCount) pieces.push(`次卡${temporaryCards.activeCount}`)

  return pieces.length ? pieces.join(' / ') : '暂无可用卡'
}

function normalizeActiveCards(list) {
  return (list || []).slice(0, 2).map((card) => {
    let value = ''

    if (Number(card.remainingAmountCent || 0) > 0) {
      value = `余额 ¥${centToYuan(card.remainingAmountCent)}`
    } else if (Number(card.remainingDurationSec || 0) > 0) {
      value = `剩余 ${secToText(card.remainingDurationSec)}`
    } else if (Number(card.remainingTimes || 0) > 0) {
      value = `剩余 ${card.remainingTimes} 次`
    } else {
      value = statusText(card.status)
    }

    return {
      cardId: card.cardId,
      name: card.name || '洗车卡',
      value,
      validTo: formatDate(card.validTo)
    }
  })
}

function normalizeSummary(summary) {
  const profile = summary.user || {}
  const review = summary.review || {}
  const reviewMode = review.reviewMode === true
  const wallet = reviewMode ? { balanceCent: review.balanceCent } : (summary.wallet || {})
  const coupons = summary.coupons || {}
  const memberCards = summary.memberCards || {}
  const temporaryCards = summary.temporaryCards || {}
  const messages = summary.messages || {}
  const name = profile.nickname || profile.maskedPhone || profile.phone || '微信用户'
  const accountType = profile.accountType || summary.accountType || ''
  const accountTypeName = profile.accountTypeName || summary.accountTypeName || ''
  const isTest = profile.isTest === true || summary.isTest === true
  const accountLabel = accountTypeName || ({
    wash_user: '洗车用户',
    server_developer: '服务端开发',
    dev_test: '开发测试',
    test_account: '测试账号',
    hardware_log: '硬件联调'
  }[String(accountType).toLowerCase()] || statusText(profile.accountStatus))
  const user = {
    name,
    phone: profile.maskedPhone || profile.phone || '',
    avatarUrl: profile.avatarUrl || '',
    memberLevel: isTest || ['server_developer', 'dev_test', 'test_account', 'hardware_log'].indexOf(String(accountType).toLowerCase()) >= 0 ? '洗车用户' : accountLabel,
    accountType,
    accountTypeName,
    isTest,
    balance: centToYuan(wallet.balanceCent),
    coupons: Number(coupons.availableCount || 0),
    cardType: cardTypeText(summary)
  }

  return {
    reviewMode,
    reviewStatus: review,
    reviewOrderCount: reviewMode && summary.reviewOrderCount != null ? Number(summary.reviewOrderCount) : null,
    reviewRecordsUnavailable: summary.reviewRecordsUnavailable === true,
    summary,
    user,
    avatarText: name.slice(0, 1),
    stats: [
      { label: reviewMode ? '体验余额' : '余额', value: `¥${user.balance}` },
      { label: reviewMode ? '真实洗车券' : '洗车券', value: `${user.coupons}张` },
      { label: reviewMode ? '真实可用卡' : '可用卡', value: `${Number(memberCards.activeCount || 0) + Number(temporaryCards.activeCount || 0)}张` }
    ],
    activeCards: normalizeActiveCards((memberCards.activeCards || []).concat(temporaryCards.activeCards || [])),
    unreadInfoCount: Number(messages.unreadCount || 0),
    hasMineData: true,
    loadError: false,
    profileEditorVisible: false,
    profileSaving: false,
    draftNickname: '',
    draftAvatarPath: '',
    profileError: ''
  }
}

Page({
  data: {
    reviewMode: false,
    reviewOrderCount: 0,
    user: {},
    avatarText: '',
    stats: [],
    statLinks: [
      '/pages/balance/balance',
      '/pages/coupons/coupons',
      '/pages/my-cards/my-cards'
    ],
    menus: [
      { title: '我的信息', url: '/pages/messages/messages', badgeKey: 'unreadInfoCount' },
      { title: '洗车记录', url: '/pages/wash-records/wash-records' },
      { title: '订单中心', url: '/pages/recharge-records/recharge-records' },
      { title: '我的洗车卡', url: '/pages/my-cards/my-cards' },
      { title: '联系客服', action: 'contact' },
      { title: '关于泡泡fight洗车', action: 'about' }
    ],
    summary: null,
    activeCards: [],
    unreadInfoCount: 0,
    isRefreshing: false,
    isPulling: false,
    blueShapeStyle: '',
    headerContentStyle: '',
    phoneAuthVisible: false,
    loading: true,
    hasMineData: false,
    loadError: false
  },

  onLoad() {},

  onShow() {
    this.refreshUnreadMessages()
    this.guardMineAccess()
  },

  refreshUnreadMessages() {
    if (!hasStoredSession()) {
      this.setData({ unreadInfoCount: 0 }, () => this.syncTabBarBadge())
      return Promise.resolve()
    }

    return api.messages.unreadSummary()
      .then((summary) => {
        this.setData({ unreadInfoCount: Number((summary && summary.unreadCount) || 0) }, () => this.syncTabBarBadge())
      })
      .catch(() => {})
  },

  onPullDownRefresh() {
    this.setData({ isRefreshing: true })
    this.loadMineData()
      .finally(() => {
        this.resetPullShape()
        this.setData({ isRefreshing: false })
        wx.stopPullDownRefresh()
      })
  },

  onPageScroll(event) {
    this.pageScrollTop = event.scrollTop || 0
  },

  handleTouchStart(event) {
    if (this.data.profileEditorVisible) return
    const touch = event.touches && event.touches[0]

    if (!touch || (this.pageScrollTop || 0) > 0) return

    this.pullStartY = touch.clientY
    this.pullTracking = true
  },

  handleTouchMove(event) {
    if (!this.pullTracking) return

    const touch = event.touches && event.touches[0]

    if (!touch) return

    const deltaY = touch.clientY - this.pullStartY

    if (deltaY <= 0) {
      this.resetPullShape()
      return
    }

    const pull = Math.min(150, Math.round(deltaY * 0.55))
    const height = 420 + pull
    const radius = Math.min(30, 11 + Math.round(pull / 7))
    const contentOffset = Math.round(pull * 0.18)

    this.setData({
      isPulling: true,
      blueShapeStyle: `height:${height}rpx;border-radius:0 0 50% 50% / 0 0 ${radius}% ${radius}%;transition:none;`,
      headerContentStyle: `transform:translateY(${contentOffset}rpx);transition:none;`
    })
  },

  handleTouchEnd() {
    this.pullTracking = false
    this.resetPullShape()
  },

  resetPullShape() {
    this.setData({
      isPulling: false,
      blueShapeStyle: '',
      headerContentStyle: ''
    })
  },

  guardMineAccess() {
    if (this.data.phoneAuthVisible) return

    if (!hasStoredSession()) {
      this.setData({
        user: {},
        stats: [],
        summary: null,
        activeCards: [],
        hasMineData: false,
        loading: false,
        loadError: false,
        phoneAuthVisible: true
      })
      return
    }

    ensurePhoneBound()
      .then(() => {
        this.loadMineData()
      })
      .catch((err) => {
        if (err.code === 'PHONE_REQUIRED') {
          this.setData({ phoneAuthVisible: true })
          return
        }

        wx.showToast({
          title: err.message || '登录失败',
          icon: 'none'
        })
      })
  },

  restoreMineCache(review) {
    const cached = wx.getStorageSync(review.reviewMode ? 'reviewMineSummary' : STORAGE_KEYS.mineSummary)

    if (!cached || !cached.summary || cached.owner !== ownerKey()) return

    this.setData(normalizeSummary(cached.summary))
  },

  loadMineData() {
    const profileRevision = this.profileRevision || 0
    this.setData({ loading: true, loadError: false })

    return ensureLogin()
      .then(() => api.review.status())
      .then((review) => {
        if (review.reviewMode !== this.data.reviewMode) this.setData({ hasMineData: false })
        this.setData({ reviewMode: review.reviewMode === true })
        this.restoreMineCache(review)
        return api.users.summary().then(async (summary) => {
          if (!review.reviewMode) return summary
          const records = await reviewHistory(review).catch(() => null)
          // A status poll can settle an exhausted order, so refresh the displayed balance afterwards.
          const latest = await api.review.status()
          return Object.assign({}, summary, { review: latest, reviewOrderCount: records ? records.items.length : null, reviewRecordsUnavailable: !records })
        })
      })
      .then((summary) => {
        if (profileRevision !== (this.profileRevision || 0)) {
          summary = Object.assign({}, summary, { user: Object.assign({}, summary.user, wx.getStorageSync(STORAGE_KEYS.user) || {}) })
        }
        this.setData(normalizeSummary(summary), () => this.syncTabBarBadge())
        wx.setStorageSync(this.data.reviewMode ? 'reviewMineSummary' : STORAGE_KEYS.mineSummary, { summary, owner: ownerKey(), updatedAt: Date.now() })
      })
      .catch((err) => {
        if (this.data.hasMineData) return
        this.setData({ loadError: true })
      })
      .finally(() => {
        this.setData({ loading: false })
      })
  },

  retryLoad() {
    this.loadMineData()
  },

  openProfileEditor() {
    if (!this.data.hasMineData || this.data.profileSaving) return
    this.setData({
      profileEditorVisible: true,
      draftNickname: (this.data.summary.user && this.data.summary.user.nickname) || '',
      draftAvatarPath: '',
      profileError: ''
    })
  },

  onChooseProfileAvatar(event) {
    if (this.data.profileSaving) return
    const path = event.detail && event.detail.avatarUrl
    if (!path) return
    if (!this.data.profileEditorVisible) this.openProfileEditor()
    this.setData({ draftAvatarPath: path, profileError: '' })
  },

  inputProfileNickname(event) {
    this.setData({ draftNickname: event.detail.value, profileError: '' })
  },

  closeProfileEditor() {
    if (this.data.profileSaving) return
    this.setData({ profileEditorVisible: false })
  },

  profileNoop() {},

  applySavedProfile(profile) {
    const user = updateStoredUser(profile)
    const summary = Object.assign({}, this.data.summary, { user: Object.assign({}, this.data.summary.user, user) })
    this.profileRevision = (this.profileRevision || 0) + 1
    this.setData(normalizeSummary(summary))
    wx.setStorageSync(this.data.reviewMode ? 'reviewMineSummary' : STORAGE_KEYS.mineSummary, { summary, owner: ownerKey(), updatedAt: Date.now() })
  },

  async saveProfile(event) {
    if (this.data.profileSaving) return
    const nickname = String(event.detail.value.nickname || '').trim()
    if (!nickname || Array.from(nickname).length > 128) {
      this.setData({ profileError: !nickname ? '请填写姓名或昵称' : '姓名或昵称最多128个字符' })
      return
    }
    this.setData({ profileSaving: true, profileError: '', draftNickname: nickname })
    let avatarSaved = false
    try {
      if (this.data.draftAvatarPath) {
        wx.showLoading({ title: '上传头像' })
        const profile = await api.users.uploadAvatar(this.data.draftAvatarPath)
        this.applySavedProfile(profile)
        avatarSaved = true
        this.setData({ draftAvatarPath: '' })
      }
      if (nickname !== this.data.summary.user.nickname) {
        wx.showLoading({ title: '保存资料' })
        const profile = await api.users.updateMe({ nickname })
        this.applySavedProfile(profile)
      }
      this.setData({ profileEditorVisible: false })
      wx.showToast({ title: '资料已更新', icon: 'success' })
    } catch (err) {
      this.setData({ profileError: `${avatarSaved ? '头像已更新，姓名保存失败。' : ''}${err.message || '保存失败，请重试'}` })
    } finally {
      wx.hideLoading()
      this.setData({ profileSaving: false })
    }
  },

  syncTabBarBadge() {
    const count = Number(this.data.unreadInfoCount || 0)

    if (count > 0) {
      wx.setTabBarBadge({
        index: 2,
        text: count > 99 ? '99+' : String(count),
        fail: () => {}
      })
      return
    }

    wx.removeTabBarBadge({
      index: 2,
      fail: () => {}
    })
  },

  handleMenuTap(event) {
    const dataset = event.currentTarget.dataset || {}
    if (dataset.action === 'contact') return

    if (dataset.url) {
      wx.navigateTo({ url: dataset.url })
      return
    }

    wx.showModal({
      title: '关于泡泡fight洗车',
      content: '自助洗车小程序用户端，支持扫码洗车、卡券支付和附近洗车点查询。',
      showCancel: false
    })
  },

  handleContactError(event) {
    const detail = (event && event.detail) || {}
    if (/cancel/i.test(String(detail.errMsg || ''))) return
    wx.showModal({
      title: '暂时无法打开客服',
      content: '请检查微信版本和网络后重试。若仍无法进入，请确认小程序平台客服已开通。',
      showCancel: false
    })
  },

  handleStatTap(event) {
    const index = Number(event.currentTarget.dataset.index)
    const url = this.data.statLinks[index]

    if (url) wx.navigateTo({ url })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新授权手机号才能查看账户信息。',
      confirmText: '退出',
      confirmColor: '#d92d20',
      success: (res) => {
        if (!res.confirm) return

        api.auth.logout().catch(() => null).finally(() => {
          clearSession()
          this.setData({
            user: {},
            stats: [],
            summary: null,
            activeCards: [],
            hasMineData: false,
            loading: false,
            phoneAuthVisible: false
          })
          wx.removeTabBarBadge({
            index: 2,
            fail: () => {}
          })
          wx.switchTab({
            url: '/pages/home/home'
          })
        })
      }
    })
  },

  onPhoneAuthSuccess() {
    this.setData({ phoneAuthVisible: false })
    this.loadMineData()
  },

  onPhoneAuthCancel() {
    this.setData({ phoneAuthVisible: false })
    wx.switchTab({
      url: '/pages/home/home'
    })
  }
})
