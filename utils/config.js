const API_BASE_URL = 'https://www.raywaysmart.com/api'
const IMAGE_BASE_URL = `${API_BASE_URL}/image`

module.exports = {
  API_BASE_URL,
  IMAGE_BASE_URL,
  STORAGE_KEYS: {
    accessToken: 'AUTO_WASH_ACCESS_TOKEN',
    refreshToken: 'AUTO_WASH_REFRESH_TOKEN',
    tokenExpireAt: 'AUTO_WASH_TOKEN_EXPIRE_AT',
    user: 'AUTO_WASH_USER',
    mineSummary: 'AUTO_WASH_MINE_SUMMARY',
    lastScan: 'AUTO_WASH_LAST_SCAN',
    paymentSiteId: 'AUTO_WASH_PAYMENT_SITE_ID',
    currentWashOrderNo: 'AUTO_WASH_CURRENT_ORDER_NO',
    currentMessage: 'AUTO_WASH_CURRENT_MESSAGE',
    shownMessageIds: 'AUTO_WASH_SHOWN_MESSAGE_IDS',
    faultReports: 'AUTO_WASH_FAULT_REPORTS'
  }
}
