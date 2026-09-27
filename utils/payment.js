const { request } = require('./request')

function normalizeWxPayParams(wxPayParams) {
  if (!wxPayParams) return null

  return {
    timeStamp: String(wxPayParams.timeStamp || wxPayParams.timestamp || ''),
    nonceStr: wxPayParams.nonceStr || '',
    package: wxPayParams.package || wxPayParams.payPackage || '',
    signType: wxPayParams.signType || 'RSA',
    paySign: wxPayParams.paySign || ''
  }
}

function getPayOrderNo(source) {
  if (!source) return ''

  if (typeof source === 'string') return source

  return source.payOrderNo ||
    source.paymentOrderNo ||
    source.paymentNo ||
    source.payNo ||
    source.wxPayParams && getPayOrderNo(source.wxPayParams) ||
    source.payment && getPayOrderNo(source.payment) ||
    source.payOrder && getPayOrderNo(source.payOrder) ||
    ''
}

function confirmPayment(payOrderNo) {
  if (!payOrderNo) return Promise.resolve(null)

  return request({
    url: `/mini/payments/${payOrderNo}/confirm`,
    method: 'POST'
  })
}

function mockConfirmPayment(payOrderNo) {
  if (!payOrderNo) {
    return Promise.reject(new Error('模拟支付缺少支付订单号'))
  }

  return request({
    url: `/mini/payments/${payOrderNo}/mock-confirm`,
    method: 'POST'
  })
}

function getPayment(payOrderNo) {
  if (!payOrderNo) return Promise.resolve(null)

  return request({
    url: `/mini/payments/${payOrderNo}`
  })
}

function isPaymentSuccess(result) {
  const status = String((result && result.payStatus) || '').toLowerCase()
  return status === 'success' || status === 'paid'
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pollPaymentStatus(payOrderNo, attempts) {
  const remaining = Number(attempts || 0)

  if (!payOrderNo || remaining <= 0) return Promise.resolve(null)

  return wait(1200)
    .then(() => getPayment(payOrderNo).catch(() => null))
    .then((result) => {
      if (isPaymentSuccess(result) || remaining <= 1) return result
      return pollPaymentStatus(payOrderNo, remaining - 1)
    })
}

function confirmAfterPayment(payOrderNo) {
  if (!payOrderNo) return Promise.resolve(null)

  return confirmPayment(payOrderNo)
    .then((result) => {
      if (result && result.confirmed === false && !isPaymentSuccess(result)) {
        wx.showToast({
          title: '支付确认中',
          icon: 'none'
        })
        return pollPaymentStatus(payOrderNo, 4).then((payment) => payment || result)
      }

      return result
    })
    .catch(() => {
      wx.showToast({
        title: '支付确认中',
        icon: 'none'
      })
      return pollPaymentStatus(payOrderNo, 4)
    })
}

function isConfirmPending(confirmResult, payOrderNo) {
  if (!payOrderNo) return false
  if (!confirmResult) return true
  if (confirmResult.confirmed === false) return true

  return !isPaymentSuccess(confirmResult)
}

function requestMockPayment(wxPayParams, payOrderNo) {
  if (!payOrderNo) {
    return Promise.reject(new Error('模拟支付缺少支付订单号'))
  }

  return new Promise((resolve, reject) => {
    wx.showModal({
      title: wxPayParams.confirmTitle || '模拟微信支付',
      content: wxPayParams.confirmContent || '当前账号为测试账号，确认后将模拟支付成功。',
      confirmText: '确认支付',
      success: (modalResult) => {
        if (!modalResult.confirm) {
          reject({ errMsg: 'requestPayment:fail cancel' })
          return
        }

        mockConfirmPayment(payOrderNo)
          .then((confirmResult) => {
            resolve({
              paymentResult: { errMsg: 'requestPayment:ok', mock: true },
              confirmResult,
              payOrderNo,
              confirmPending: !isPaymentSuccess(confirmResult),
              mock: true
            })
          })
          .catch(reject)
      },
      fail: reject
    })
  })
}

function requestPayment(wxPayParams, paymentSource) {
  const payOrderNo = getPayOrderNo(paymentSource) || getPayOrderNo(wxPayParams)
  const mockPayment = !!(
    (wxPayParams && (wxPayParams.mock === true || String(wxPayParams.mock).toLowerCase() === 'true'))
    || (paymentSource && (paymentSource.mock === true || String(paymentSource.mock).toLowerCase() === 'true'))
  )

  if (mockPayment) {
    return requestMockPayment(wxPayParams || {}, payOrderNo)
  }

  const payParams = normalizeWxPayParams(wxPayParams)

  if (!payParams) return Promise.resolve()

  const missingKey = ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign'].find((key) => !payParams[key])
  if (missingKey) {
    return Promise.reject(new Error(`微信支付参数缺少${missingKey}`))
  }

  return new Promise((resolve, reject) => {
    wx.requestPayment(Object.assign({}, payParams, {
      success: (paymentResult) => {
        confirmAfterPayment(payOrderNo)
          .then((confirmResult) => {
            const confirmPending = isConfirmPending(confirmResult, payOrderNo)

            resolve({
              paymentResult,
              confirmResult,
              payOrderNo,
              confirmPending
            })
          })
      },
      fail: reject
    }))
  })
}

module.exports = {
  confirmPayment,
  getPayment,
  getPayOrderNo,
  isConfirmPending,
  mockConfirmPayment,
  normalizeWxPayParams,
  requestPayment
}
