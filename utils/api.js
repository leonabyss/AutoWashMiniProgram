const { request, ensureLogin } = require('./request')
const { isReviewOrder, registerOrder } = require('./review-mode')

function queryString(params) {
  return Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')
}

function withQuery(url, params) {
  const query = queryString(params)
  return query ? `${url}?${query}` : url
}

const api = {
  review: {
    status() { return request({ url: '/mini/review/status' }) },
    claim(code) { return request({ url: '/mini/review/claim', method: 'POST', data: { code } }) },
    scan() { return request({ url: '/mini/review/scan/resolve', method: 'POST' }) },
    createOrder() { return request({ url: '/mini/review/wash/orders', method: 'POST' }) },
    orderStatus(orderNo) { return request({ url: `/mini/review/wash/orders/${encodeURIComponent(orderNo)}/status` }) },
    start(orderNo) { return request({ url: `/mini/review/wash/orders/${encodeURIComponent(orderNo)}/start`, method: 'POST' }) },
    control(orderNo, functionName) { return request({ url: `/mini/review/wash/orders/${encodeURIComponent(orderNo)}/remote-control`, method: 'POST', data: { function: functionName } }) },
    pause(orderNo) { return request({ url: `/mini/review/wash/orders/${encodeURIComponent(orderNo)}/pause`, method: 'POST' }) },
    stop(orderNo) { return request({ url: `/mini/review/wash/orders/${encodeURIComponent(orderNo)}/stop`, method: 'POST' }) },
    exit() { return request({ url: '/mini/review/exit', method: 'POST' }) }
  },
  cms: {
    home() {
      return request({ url: '/mini/cms/home', auth: false })
    },
    homeCarousels(params) {
      return request({ url: withQuery('/mini/cms/home-carousels', params), auth: false })
    }
  },

  auth: {
    wechatLogin(data) {
      return request({ url: '/mini/auth/wechat-login', method: 'POST', auth: false, data })
    },
    refresh(data) {
      return request({ url: '/mini/auth/refresh', method: 'POST', auth: false, data })
    },
    logout() {
      return request({ url: '/mini/auth/logout', method: 'POST' })
    }
  },

  users: {
    me() {
      return request({ url: '/mini/users/me' })
    },
    summary() {
      return request({ url: '/mini/users/me/summary' })
    },
    updateMe(data) {
      return request({ url: '/mini/users/me', method: 'PUT', data })
    },
    uploadAvatar(filePath) {
      return require('./avatar-upload')(filePath)
    },
    bindPhone(data) {
      return request({ url: '/mini/users/me/phone', method: 'POST', data })
    }
  },

  wallet: {
    get() {
      return request({ url: '/mini/wallet' })
    },
    transactions(params) {
      return request({ url: withQuery('/mini/wallet/transactions', params) })
    }
  },

  recharge: {
    packages() {
      return request({ url: '/mini/recharge/packages' })
    },
    createOrder(data) {
      return request({ url: '/mini/recharge/orders', method: 'POST', data })
    },
    getOrder(orderNo) {
      return request({ url: `/mini/recharge/orders/${orderNo}` })
    }
  },

  payment: {
    sites(params) {
      return request({ url: withQuery('/mini/payment/sites', params) })
    }
  },

  member: {
    cards() {
      return request({ url: '/mini/member/cards' })
    },
    temporaryCards(params) {
      return request({ url: withQuery('/mini/temporary-cards', params) })
    },
    activeCards(params) {
      return request({ url: withQuery('/mini/member/cards/active', params) })
    },
    products(params) {
      return request({ url: withQuery('/mini/member/products', params) })
    },
    createOrder(data) {
      return request({ url: '/mini/member/orders', method: 'POST', data })
    },
    cancelPeriodicOrder(orderNo, data) {
      return request({ url: `/mini/member/periodic-orders/${orderNo}/cancel`, method: 'POST', data })
    }
  },

  sites: {
    nearby(params) {
      return request({ url: withQuery('/mini/sites/nearby', params) })
    },
    search(params) {
      return request({ url: withQuery('/mini/sites/search', params) })
    },
    recent(params) {
      return ensureLogin().then(() => request({ url: withQuery('/mini/sites/recent', params) }))
    },
    mapMarkers(params) {
      return request({ url: withQuery('/mini/sites/map-markers', params) })
    },
    detail(siteId) {
      return request({ url: `/mini/sites/${siteId}`, auth: false })
    },
    machines(siteId) {
      return request({ url: `/mini/sites/${siteId}/machines` })
    }
  },

  regions: {
    cities() {
      return request({ url: '/mini/regions/cities', auth: false })
    },
    districts(cityId) {
      return request({ url: withQuery('/mini/regions/districts', { cityId }), auth: false })
    }
  },

  groupBuy: {
    entries(siteId) {
      return request({ url: `/mini/sites/${encodeURIComponent(siteId)}/group-buy`, auth: false })
    },
    redeem(data) {
      return request({ url: '/mini/group-buy/redemptions', method: 'POST', data })
    }
  },

  scan: {
    resolve(data) {
      return request({ url: '/mini/scan/resolve', method: 'POST', data })
    }
  },

  wash: {
    createOrder(data) {
      return request({ url: '/mini/wash/orders', method: 'POST', data })
    },
    currentOrder() {
      return request({ url: '/mini/wash/orders/current' })
    },
    resume() {
      return request({ url: '/mini/wash/resume' })
    },
    detail(orderNo) {
      if (isReviewOrder(orderNo)) return api.review.orderStatus(orderNo).then(registerOrder)
      return request({ url: `/mini/wash/orders/${orderNo}` })
    },
    pay(orderNo, data) {
      if (isReviewOrder(orderNo)) return Promise.reject(new Error('审核体验不需要真实支付'))
      return request({ url: `/mini/wash/orders/${orderNo}/pay`, method: 'POST', data })
    },
    start(orderNo, data) {
      if (isReviewOrder(orderNo)) return api.review.start(orderNo).then(registerOrder)
      return request({ url: `/mini/wash/orders/${orderNo}/start`, method: 'POST', data })
    },
    remoteControl(orderNo, data) {
      if (isReviewOrder(orderNo)) {
        const action = data && data.action
        if (action === 'stop') return api.review.pause(orderNo).then(registerOrder)
        const functionName = action === 'clean_water' ? 'water' : action
        if (['water', 'foam', 'vacuum', 'air', 'wax', 'glass_water'].indexOf(functionName) < 0) {
          return Promise.reject(new Error('请选择有效的洗车功能'))
        }
        return api.review.control(orderNo, functionName).then(registerOrder)
      }
      return request({ url: `/mini/wash/orders/${orderNo}/remote-control`, method: 'POST', data })
    },
    control(orderNo, data) {
      if (isReviewOrder(orderNo)) return api.wash.remoteControl(orderNo, data)
      return request({ url: `/mini/wash/orders/${orderNo}/start`, method: 'POST', data })
    },
    water(orderNo, data) {
      if (isReviewOrder(orderNo)) return api.review.control(orderNo, 'water').then(registerOrder)
      return request({ url: `/mini/wash/orders/${orderNo}/start`, method: 'POST', data })
    },
    foam(orderNo, data) {
      if (isReviewOrder(orderNo)) return api.review.control(orderNo, 'foam').then(registerOrder)
      return request({ url: `/mini/wash/orders/${orderNo}/start`, method: 'POST', data })
    },
    stop(orderNo, data) {
      if (isReviewOrder(orderNo)) return api.review.stop(orderNo).then(registerOrder)
      return request({ url: `/mini/wash/orders/${orderNo}/stop`, method: 'POST', data })
    },
    status(orderNo) {
      if (isReviewOrder(orderNo)) return api.review.orderStatus(orderNo).then(registerOrder)
      return request({ url: `/mini/wash/orders/${orderNo}/status` })
    },
    flows(orderNo) {
      if (isReviewOrder(orderNo)) return Promise.reject(new Error('模拟订单不提供真实设备流水'))
      return request({ url: `/mini/wash/orders/${orderNo}/flows` })
    },
    list(params) {
      return request({ url: withQuery('/mini/wash/orders', params) })
    }
  },

  machines: {
    status(machineId) {
      return request({ url: `/mini/machines/${machineId}/status` })
    }
  },

  faultReports: {
    create(data) {
      return request({ url: '/mini/fault-complaints', method: 'POST', data })
    }
  },

  glassWater: {
    createOrder(data) {
      return request({ url: '/mini/glass-water/orders', method: 'POST', data })
    },
    start(orderNo) {
      return request({ url: `/mini/glass-water/orders/${orderNo}/start`, method: 'POST' })
    },
    status(orderNo) {
      return request({ url: `/mini/glass-water/orders/${orderNo}/status` })
    }
  },

  foamBrush: {
    createOrder(data) {
      return request({ url: '/mini/foam-brush/orders', method: 'POST', data })
    },
    unlock(orderNo) {
      return request({ url: `/mini/foam-brush/orders/${orderNo}/unlock`, method: 'POST' })
    },
    returnBrush(orderNo) {
      return request({ url: `/mini/foam-brush/orders/${orderNo}/return`, method: 'POST' })
    },
    status(orderNo) {
      return request({ url: `/mini/foam-brush/orders/${orderNo}/status` })
    }
  },

  coupons: {
    mine(params) {
      return request({ url: withQuery('/mini/coupons', params) })
    },
    available(params) {
      return request({ url: withQuery('/mini/coupons/available', params) })
    }
  },

  messages: {
    list(params) {
      return request({ url: withQuery('/mini/messages', params) })
    },
    unreadSummary() {
      return request({ url: '/mini/messages/unread-summary' })
    },
    read(messageId) {
      return request({ url: `/mini/messages/${messageId}/read`, method: 'POST' })
    }
  },

  promotions: {
    detail(code) {
      return request({ url: `/public/promotion-codes/${encodeURIComponent(code)}`, auth: false })
    },
    claim(code) {
      return request({ url: `/promotion-codes/${encodeURIComponent(code)}/claim`, method: 'POST' })
    }
  },

  orders: {
    productOrders(params) {
      return request({ url: withQuery('/mini/product-orders', params) })
    },
    payments(params) {
      return request({ url: withQuery('/mini/payments', params) })
    },
    payment(payOrderNo) {
      return request({ url: `/mini/payments/${payOrderNo}` })
    },
    confirmPayment(payOrderNo) {
      return request({ url: `/mini/payments/${payOrderNo}/confirm`, method: 'POST' })
    }
  }
}

module.exports = api
