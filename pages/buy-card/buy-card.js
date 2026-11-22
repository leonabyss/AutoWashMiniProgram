Page({
  data: { legacyHidden: true },
  onLoad(options) {
    const query = Object.keys(options || {}).map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`).join('&')
    wx.redirectTo({ url: `/pages/buy-card-new/buy-card-new${query ? '?' + query : ''}` })
  }
})
