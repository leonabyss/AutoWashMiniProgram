function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: ({ latitude, longitude }) => {
        resolve({ latitude, longitude })
      },
      fail: (err) => {
        const denied = /auth\s*deny|auth\s*denied|permission|authorize|授权|拒绝/i.test(String((err && err.errMsg) || ''))
        const error = Object.assign(new Error(denied ? '定位权限未开启，请授权定位后重试' : '暂时无法获取位置，请检查手机定位服务后重试'), err)
        error.code = denied ? 'LOCATION_DENIED' : 'LOCATION_UNAVAILABLE'
        reject(error)
      }
    })
  })
}

module.exports = {
  getCurrentLocation,
  getWashLocation
}

// 洗车与地图定位分开。仅服务端明确暂停保护时不请求定位，不用假坐标替代。
function getWashLocation() {
  return require('./api').scan.policy().then((policy) => {
    if (policy && policy.remoteScanProtectionEnabled === false && policy.locationRequired === false) return {}
    return getCurrentLocation()
  }, () => getCurrentLocation())
}
