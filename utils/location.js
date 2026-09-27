function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: ({ latitude, longitude }) => {
        resolve({ latitude, longitude })
      },
      fail: (err) => {
        reject(Object.assign(new Error('无法获取当前位置，请授权定位后重试'), err))
      }
    })
  })
}

module.exports = {
  getCurrentLocation
}
