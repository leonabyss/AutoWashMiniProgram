const createHomePage = require('../home/home-controller')

Page(createHomePage({
  loginNow() {
    this.requirePhone(() => {
      if (!this.data.isLoggedIn) {
        this.loadHomeData()
      }
    })
  },

  openAccountDetail(event) {
    const url = event.currentTarget.dataset.url
    if (!url) return

    wx.navigateTo({
      url,
      fail: () => {
        wx.showToast({ title: '页面打开失败', icon: 'none' })
      }
    })
  },

  openFranchise() {
    const badge = (this.data.badgeImages || [])[0]

    if (badge) {
      this.openCmsLink(badge)
      return
    }

    wx.showToast({
      title: '加盟内容配置中',
      icon: 'none'
    })
  }
}))
