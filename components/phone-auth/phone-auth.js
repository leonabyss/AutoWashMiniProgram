const { bindPhoneWithCode } = require('../../utils/auth')

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: '微信手机号登录'
    },
    desc: {
      type: String,
      value: '为了识别会员、余额和洗车订单，请先授权手机号。'
    }
  },

  data: {
    loading: false
  },

  methods: {
    noop() {},

    onGetPhoneNumber(event) {
      const detail = event.detail || {}

      if (!detail.code) {
        wx.showToast({
          title: '未完成手机号授权',
          icon: 'none'
        })
        return
      }

      this.setData({ loading: true })

      bindPhoneWithCode(detail.code)
        .then((user) => {
          wx.showToast({
            title: '登录成功',
            icon: 'success'
          })
          this.triggerEvent('success', { user })
        })
        .catch((err) => {
          wx.showToast({
            title: err.message || '手机号授权失败',
            icon: 'none'
          })
        })
        .finally(() => {
          this.setData({ loading: false })
        })
    },

    onCancel() {
      this.triggerEvent('cancel')
    }
  }
})
