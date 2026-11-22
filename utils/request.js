const { API_BASE_URL, STORAGE_KEYS } = require('./config')
const { chineseText } = require('./display-text')
const maintenance = require('./system-maintenance')

let refreshingPromise = null
let loginPromise = null
let recoveryPromise = null
let sessionVersion = 0

function getAccessToken() {
  return wx.getStorageSync(STORAGE_KEYS.accessToken)
}

function setSession(session) {
  if (!session) return

  if (session.accessToken) {
    wx.setStorageSync(STORAGE_KEYS.accessToken, session.accessToken)
  }
  if (session.refreshToken) {
    wx.setStorageSync(STORAGE_KEYS.refreshToken, session.refreshToken)
  }
  if (session.expiresIn) {
    wx.setStorageSync(STORAGE_KEYS.tokenExpireAt, Date.now() + Number(session.expiresIn) * 1000)
  }
  if (session.user) {
    wx.setStorageSync(STORAGE_KEYS.user, session.user)
  }
}

function clearSession() {
  sessionVersion += 1
  wx.removeStorageSync('reviewOrderRegistry')
  wx.removeStorageSync('reviewScanInfo')
  wx.removeStorageSync('reviewMineSummary')
  wx.removeStorageSync(STORAGE_KEYS.accessToken)
  wx.removeStorageSync(STORAGE_KEYS.refreshToken)
  wx.removeStorageSync(STORAGE_KEYS.tokenExpireAt)
  wx.removeStorageSync(STORAGE_KEYS.user)
  wx.removeStorageSync(STORAGE_KEYS.mineSummary)
  wx.removeStorageSync(STORAGE_KEYS.currentMessage)
  wx.removeStorageSync(STORAGE_KEYS.shownMessageIds)
}

function createAuthRequiredError() {
  return Object.assign(new Error('请先登录'), { code: 'AUTH_REQUIRED' })
}

function hasStoredSession() {
  return !!(
    wx.getStorageSync(STORAGE_KEYS.accessToken)
    || wx.getStorageSync(STORAGE_KEYS.refreshToken)
  )
}

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }) => {
        if (code) {
          resolve(code)
        } else {
          reject(new Error('登录失败：未获取到登录凭证'))
        }
      },
      fail: () => reject(new Error('登录失败，请稍后重试'))
    })
  })
}

function request(options) {
  const version = sessionVersion
  const token = getAccessToken()
  const header = Object.assign(
    {
      'Content-Type': 'application/json'
    },
    options.header || {}
  )

  if (options.auth !== false && token) {
    header.Authorization = `Bearer ${token}`
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data || {},
      header,
      success: (res) => {
        if (options.auth !== false && version !== sessionVersion) {
          reject(createAuthRequiredError())
          return
        }
        const body = res.data
        maintenance.handleResponse(body)

        if (res.statusCode === 401 || (body && body.code === 'UNAUTHORIZED')) {
          reject(Object.assign(new Error('登录已过期'), { code: 'UNAUTHORIZED', response: body }))
          return
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const reason = [body?.message, body?.detail].find(value => typeof value === 'string' && /[\u3400-\u9fff]/.test(value))
          const fallback = res.statusCode === 400 ? '请求参数不正确，请检查后重试' : `接口请求失败（HTTP ${res.statusCode}）`
          reject(Object.assign(new Error(reason || fallback), {
            code: body && body.code,
            response: body,
            statusCode: res.statusCode
          }))
          return
        }

        if (body && Object.prototype.hasOwnProperty.call(body, 'success')) {
          if (body.success) {
            resolve(body.data)
          } else {
            reject(Object.assign(new Error(typeof body.message === 'string' && /[\u3400-\u9fff]/.test(body.message) ? body.message : '接口请求失败，请稍后重试'), {
              code: body.code,
              response: body
            }))
          }
          return
        }

        resolve(body)
      },
      fail: (err) => {
        reject(Object.assign(new Error('网络请求失败，请检查网络后重试'), err, { code: 'NETWORK_ERROR' }))
      }
    })
  }).catch((err) => {
    if (options.auth !== false && version !== sessionVersion) throw createAuthRequiredError()
    err.message = chineseText(err.message, '操作失败，请稍后重试')
    if (options.auth !== false && options._retried && err.code === 'UNAUTHORIZED') clearSession()
    if (options.auth === false || options._retried || err.code !== 'UNAUTHORIZED') {
      throw err
    }

    return refreshOrLogin().then(() => request(Object.assign({}, options, { _retried: true })))
  })
}

function login(payload) {
  if (loginPromise) return loginPromise
  const version = sessionVersion

  loginPromise = wxLogin()
    .then((code) => request({
      url: '/mini/auth/wechat-login',
      method: 'POST',
      auth: false,
      data: Object.assign({ code }, payload || {})
    }))
    .then((session) => {
      if (version !== sessionVersion) throw createAuthRequiredError()
      setSession(session)
      return session
    })
    .finally(() => {
      loginPromise = null
    })

  return loginPromise
}

function refreshOrLogin() {
  if (!hasStoredSession()) return Promise.reject(createAuthRequiredError())
  if (recoveryPromise) return recoveryPromise
  const version = sessionVersion
  const pending = refreshSession().catch((err) => {
    if (version !== sessionVersion) throw createAuthRequiredError()
    if (err.code !== 'UNAUTHORIZED' && err.code !== 'AUTH_REQUIRED') throw err
    return login()
  }).catch((err) => {
    if (version === sessionVersion && (err.code === 'UNAUTHORIZED' || err.code === 'AUTH_REQUIRED')) clearSession()
    throw err
  }).finally(() => { if (recoveryPromise === pending) recoveryPromise = null })
  recoveryPromise = pending
  return pending
}

function refreshSession() {
  if (refreshingPromise) return refreshingPromise
  const version = sessionVersion

  const refreshToken = wx.getStorageSync(STORAGE_KEYS.refreshToken)

  if (!refreshToken) {
    return Promise.reject(createAuthRequiredError())
  }

  refreshingPromise = request({
    url: '/mini/auth/refresh',
    method: 'POST',
    auth: false,
    data: { refreshToken }
  })
    .then((session) => {
      if (version !== sessionVersion) throw createAuthRequiredError()
      setSession(session)
      return session
    })
    .finally(() => {
      refreshingPromise = null
    })

  return refreshingPromise
}

function restoreSession() {
  if (!hasStoredSession()) return Promise.reject(createAuthRequiredError())
  const token = getAccessToken()
  const expireAt = Number(wx.getStorageSync(STORAGE_KEYS.tokenExpireAt) || 0)

  if (token && expireAt && expireAt - Date.now() > 60000) {
    return Promise.resolve(wx.getStorageSync(STORAGE_KEYS.user))
  }

  return refreshOrLogin()
    .then((session) => session.user || wx.getStorageSync(STORAGE_KEYS.user))
}

function ensureLogin() {
  return restoreSession()
}

module.exports = {
  request,
  login,
  ensureLogin,
  refreshOrLogin,
  restoreSession,
  hasStoredSession,
  setSession,
  clearSession
}
