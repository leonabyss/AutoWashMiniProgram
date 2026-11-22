const maintenance = require('./utils/system-maintenance')
const appUpdate = require('./utils/app-update')

App({
  onShow() { maintenance.start(); appUpdate.start() },
  onHide() { maintenance.stop(); appUpdate.stop() },
  globalData: {}
})
