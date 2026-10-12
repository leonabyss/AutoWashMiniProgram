const { API_BASE_URL, STORAGE_KEYS } = require('./config')
const { chineseText } = require('./display-text')

let refreshingPromise = null
let loginPromise = null

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
          reject(new Error('微信登录失败：未获取到登录凭证'))
        }
      },
      fail: () => reject(new Error('微信登录失败，请稍后重试'))
    })
  })
}

function request(options) {
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
        const body = res.data

        if (res.statusCode === 401 || (body && body.code === 'UNAUTHORIZED')) {
          reject(Object.assign(new Error('登录已过期'), { code: 'UNAUTHORIZED', response: body }))
          return
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(Object.assign(new Error((body && body.message) || `接口请求失败(${res.statusCode})`), {
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
            reject(Object.assign(new Error(body.message || '接口请求失败'), {
              code: body.code,
              response: body
            }))
          }
          return
        }

        resolve(body)
      },
      fail: (err) => {
        reject(Object.assign(new Error(err.errMsg || '网络请求失败'), err, { code: 'NETWORK_ERROR' }))
      }
    })
  }).catch((err) => {
    err.message = chineseText(err.message, '操作失败，请稍后重试')
    if (options.auth === false || options._retried || err.code !== 'UNAUTHORIZED') {
      throw err
    }

    return refreshOrLogin().then(() => request(Object.assign({}, options, { _retried: true })))
  })
}

function login(payload) {
  if (loginPromise) return loginPromise

  loginPromise = wxLogin()
    .then((code) => request({
      url: '/mini/auth/wechat-login',
      method: 'POST',
      auth: false,
      data: Object.assign({ code }, payload || {})
    }))
    .then((session) => {
      setSession(session)
      return session
    })
    .finally(() => {
      loginPromise = null
    })

  return loginPromise
}

function refreshOrLogin() {
  return refreshSession().catch(() => login())
}

function refreshSession() {
  if (refreshingPromise) return refreshingPromise

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
      setSession(session)
      return session
    })
    .catch((err) => {
      clearSession()
      throw err
    })
    .finally(() => {
      refreshingPromise = null
    })

  return refreshingPromise
}

function restoreSession() {
  const token = getAccessToken()
  const expireAt = Number(wx.getStorageSync(STORAGE_KEYS.tokenExpireAt) || 0)

  if (token && expireAt && expireAt - Date.now() > 60000) {
    return Promise.resolve(wx.getStorageSync(STORAGE_KEYS.user))
  }

  return refreshSession()
    .then((session) => session.user || wx.getStorageSync(STORAGE_KEYS.user))
}

function ensureLogin() {
  const token = getAccessToken()
  const expireAt = Number(wx.getStorageSync(STORAGE_KEYS.tokenExpireAt) || 0)

  if (token && expireAt && expireAt - Date.now() > 60000) {
    return Promise.resolve(wx.getStorageSync(STORAGE_KEYS.user))
  }

  return refreshOrLogin().then((session) => session.user || wx.getStorageSync(STORAGE_KEYS.user))
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
