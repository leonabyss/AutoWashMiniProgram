const createHomePage = require('./home-controller')

Page(createHomePage({
  loginNow() {
    this.requirePhone(() => {
      if (!this.data.isLoggedIn) {
        this.loadHomeData()
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
