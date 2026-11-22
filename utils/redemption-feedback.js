const knownFailures = {
  DOUYIN_REJECTED: '平台拒绝了这次核销，请确认券状态和使用门店后再试',
  DOUYIN_PRODUCT_NOT_MAPPED: '该团购券未匹配本场地的洗车商品，未消券，请联系门店',
  DOUYIN_PREPARE_INCOMPLETE: '平台返回的验券信息不完整，未消券，请联系门店',
  DOUYIN_API_FAILED: '验券准备未完成，未消券，请稍后再试'
}

function redemptionFeedback(error, submitted) {
  const code = error && error.code
  if (code === 'DOUYIN_DUPLICATE') {
    return { hold: true, message: '这张券已有核销记录，请回首页查看能否继续原洗车订单，或联系门店' }
  }
  if (code === 'DOUYIN_VERIFY_UNKNOWN' || (submitted && (!code ||
    ['INTERNAL_ERROR', 'NETWORK_ERROR', 'AUTH_REQUIRED'].includes(code) || Number(error.statusCode) >= 500))) {
    return { hold: true, message: '本次核销结果待核实，请勿重复提交。请回首页查看原洗车订单，或联系门店' }
  }
  return { hold: false, message: knownFailures[code] || '' }
}

module.exports = { redemptionFeedback }
