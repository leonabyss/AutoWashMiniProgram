const maintenance = require('../../utils/system-maintenance')

Component({
  data: { active: true, visible: false, title: '', message: '', restoreTime: '' },
  lifetimes: {
    attached() {
      this.unsubscribe = maintenance.subscribe(({ visible, state }) => {
        const next = { visible,
          title: state.phase === 'notice' ? '系统维护通知' : '系统维护中',
          message: state.message || '服务正在短暂维护，请稍后再试。',
          restoreTime: state.expectedEndAt ? String(state.expectedEndAt).slice(0, 19).replace('T', ' ') : ''
        }
        const patch = {}
        Object.keys(next).forEach((key) => {
          if (this.data[key] !== next[key]) patch[key] = next[key]
        })
        if (Object.keys(patch).length) this.setData(patch)
      })
    },
    detached() { if (this.unsubscribe) this.unsubscribe() }
  },
  pageLifetimes: {
    show() { this.setData({ active: true }) },
    hide() { this.setData({ active: false }) }
  },
  methods: { noop() {}, dismiss() { maintenance.dismiss() } }
})
