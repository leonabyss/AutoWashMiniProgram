const api = require('../../utils/api')
const { ensurePhoneBound } = require('../../utils/auth')
const { ensureLogin, hasStoredSession, login } = require('../../utils/request')

const PAGE = '/pages/free-wash-activities/free-wash-activities'
const TYPE_TEXT = { FREE_WASH: '免费领券', REGISTER_TO_GET_FREE: '新用户专享', SHARE_TO_GET_FREE: '邀请新用户' }

function decodeSiteName(value) {
  const name = String(value || '')
  try { return decodeURIComponent(name) } catch (_) { return name }
}

Page({
  data: { siteId:'', siteName:'', items:[], claimed:{}, shareReady:{}, busy:'', loading:false, error:'', notice:'', phoneAuthVisible:false, invited:false, entryReady:false, accepted:false },

  onLoad(options) {
    this.inviteToken = options.shareToken || ''
    this.setData({ siteId:options.siteId || '', siteName:decodeSiteName(options.siteName), invited:!!this.inviteToken })
    this.load()
  },

  onUnload() { this.disposed = true },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },

  async load() {
    if (this.data.loading || this.data.busy) return
    this.setData({ loading:true, error:'' })
    try {
      // The server must record the invitation before the first WeChat login.
      if (this.inviteToken && !this.entry) {
        this.entry = await api.freeWash.entry(this.inviteToken)
        if (this.disposed) return
        if (!this.entry.entryToken || !this.entry.siteId) throw new Error('分享入口信息不完整')
        this.setData({ siteId:this.entry.siteId, entryReady:true })
      }
      if (!this.data.siteId) throw new Error('未找到活动场地')
      const result = await api.freeWash.list(this.data.siteId)
      if (this.disposed) return
      this.setData({ items:(result.items || []).map(item => ({ ...item,
        typeText:TYPE_TEXT[item.activityType] || '场地活动',
        endText:String(item.endAt || '').replace('T',' ').slice(0,16)
      })) })
    } catch (err) {
      if (!this.disposed) this.setData({ error:err.message || '活动加载失败' })
    } finally { if (!this.disposed) this.setData({ loading:false }) }
  },

  runAction(event) {
    this.perform(event.currentTarget.dataset.kind, event.currentTarget.dataset.id)
  },

  async perform(kind, id, authorized = false) {
    if (this.data.busy || this.data.loading || this.data.phoneAuthVisible) return
    this.setData({ busy:String(id || kind), error:'', notice:'' })
    try {
      if (!authorized) {
        if (kind === 'accept' && !this.data.entryReady) throw new Error('请先重新打开有效的邀请链接')
        const needsPhone = kind === 'accept' || (kind === 'claim' && this.data.items.some(item =>
          String(item.activityId) === String(id) && item.activityType === 'REGISTER_TO_GET_FREE'))
        if (needsPhone) {
          await ensurePhoneBound()
        } else {
          await (hasStoredSession() ? ensureLogin() : login())
        }
      }
      if (this.disposed) return
      if (kind === 'accept') {
        const result = await api.freeWash.accept(this.entry.entryToken)
        if (!this.disposed && result.accepted) this.setData({ accepted:true, notice:'邀请已确认，奖励发给邀请人。' })
      } else if (kind === 'share') {
        const result = await api.freeWash.share(id, this.data.siteId)
        if (!result.shareToken) throw new Error('未能生成活动邀请链接')
        if (!this.disposed) this.setData({ shareReady:{ ...this.data.shareReady, [id]:result.shareToken } })
      } else {
        const result = await api.freeWash.claim(id, this.data.siteId)
        if (!result.couponId) throw new Error('未收到发券结果，请重试')
        if (!this.disposed) {
          this.setData({ claimed:{ ...this.data.claimed, [id]:true }, notice:result.alreadyClaimed ? '您已领过本活动的券，可在「我的洗车券」查看。' : '领取成功。洗车时请选择卡券结算。' })
        }
      }
    } catch (err) {
      if (this.disposed) return
      if (['PHONE_REQUIRED','PHONE_VERIFICATION_REQUIRED','AUTH_REQUIRED'].includes(err.code)) {
        this.pendingAction = { kind, id }
        this.setData({ phoneAuthVisible:true })
      } else {
        this.setData({ error:err.message || '操作失败，请稍后重试' })
      }
    } finally { if (!this.disposed) this.setData({ busy:'' }) }
  },

  onPhoneAuthSuccess() {
    const pending = this.pendingAction
    this.pendingAction = null
    this.setData({ phoneAuthVisible:false }, () => { if (pending) this.perform(pending.kind,pending.id,true) })
  },
  onPhoneAuthCancel() { this.pendingAction = null; this.setData({ phoneAuthVisible:false }) },

  onShareAppMessage(event) {
    const id = event.target && event.target.dataset.id
    const token = this.data.shareReady[id]
    const item = this.data.items.find(row => String(row.activityId) === String(id))
    return token ? { title:item?.title || '邀请你参加场地洗车活动', path:PAGE+'?shareToken='+encodeURIComponent(token) }
      : { title:'场地洗车活动', path:PAGE+'?siteId='+encodeURIComponent(this.data.siteId) }
  }
})
