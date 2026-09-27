const api = require('./api')
const { STORAGE_KEYS } = require('./config')
const { ensureLogin } = require('./request')

function isPhoneBound(user) {
  return !!(user && user.phone)
}

function createPhoneRequiredError() {
  return Object.assign(new Error('请先完成手机号授权'), { code: 'PHONE_REQUIRED' })
}

function updateStoredUser(nextUser) {
  if (!nextUser) return wx.getStorageSync(STORAGE_KEYS.user)

  const currentUser = wx.getStorageSync(STORAGE_KEYS.user) || {}
  const mergedUser = Object.assign({}, currentUser, nextUser)

  wx.setStorageSync(STORAGE_KEYS.user, mergedUser)
  return mergedUser
}

function normalizeBindPhoneResult(result) {
  if (!result) return null

  if (result.user) {
    return result.user
  }

  return {
    phone: result.maskedPhone || result.phone
  }
}

function ensurePhoneBound() {
  return ensureLogin()
    .then((loginUser) => {
      if (isPhoneBound(loginUser)) {
        return loginUser
      }

      return api.users.me()
        .then((profile) => {
          const user = updateStoredUser(profile)

          if (isPhoneBound(user)) {
            return user
          }

          throw createPhoneRequiredError()
        })
    })
}

function bindPhoneWithCode(code) {
  if (!code) {
    return Promise.reject(createPhoneRequiredError())
  }

  return ensureLogin()
    .then(() => api.users.bindPhone({ code }))
    .then((result) => updateStoredUser(normalizeBindPhoneResult(result)))
}

module.exports = {
  bindPhoneWithCode,
  ensurePhoneBound,
  isPhoneBound,
  updateStoredUser
}
