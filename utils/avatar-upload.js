const { API_BASE_URL, STORAGE_KEYS } = require('./config')
const { ensureLogin, refreshOrLogin } = require('./request')
const { chineseText } = require('./display-text')

function validateImage(filePath) {
  return Promise.all([
    new Promise((resolve, reject) => wx.getImageInfo({ src: filePath, success: resolve, fail: () => reject(new Error('无法读取头像图片，请重新选择')) })),
    new Promise((resolve, reject) => wx.getFileSystemManager().getFileInfo({ filePath, success: resolve, fail: () => reject(new Error('无法读取头像文件，请重新选择')) }))
  ]).then(([image, file]) => {
    if (!['png', 'jpg', 'jpeg'].includes(String(image.type || '').toLowerCase())) throw new Error('头像仅支持PNG或JPG图片')
    if (file.size > 5 * 1024 * 1024) throw new Error('头像不能超过5MB，请选择较小的图片')
    if (image.width * image.height > 16000000) throw new Error('头像尺寸过大，请选择较小的图片')
  })
}

function upload(filePath, retried) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}/mini/users/me/avatar`,
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${wx.getStorageSync(STORAGE_KEYS.accessToken)}` },
      success(res) {
        let body
        try { body = JSON.parse(res.data) } catch (err) {
          reject(new Error('头像上传失败，请稍后重试'))
          return
        }
        if (res.statusCode === 401 || body.code === 'UNAUTHORIZED') {
          reject(Object.assign(new Error('登录已过期'), { code: 'UNAUTHORIZED' }))
        } else if (res.statusCode >= 200 && res.statusCode < 300 && body.success && body.data) {
          resolve(body.data)
        } else {
          reject(new Error(chineseText(body.message, '头像上传失败，请重试')))
        }
      },
      fail() { reject(new Error('头像上传失败，请检查网络后重试')) }
    })
  }).catch((err) => {
    if (err.code !== 'UNAUTHORIZED' || retried) throw err
    return refreshOrLogin().then(() => upload(filePath, true))
  })
}

module.exports = function uploadAvatar(filePath) {
  return validateImage(filePath).then(() => ensureLogin()).then(() => upload(filePath, false))
}
