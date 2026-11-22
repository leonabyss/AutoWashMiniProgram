function machineAvailability(machine) {
  const online = String(machine.onlineStatus || '').trim().toLowerCase()
  const state = String(machine.machineStatus || '').trim().toLowerCase()
  const pause = String(machine.pauseStatus || '').toLowerCase()
  const maintenance = String(machine.maintenanceStatus || '').toLowerCase()
  const onlineText = online === 'online' ? '在线' : (online === 'offline' ? '离线' : '连接未知')
  let statusText = '状态待确认'
  let statusClass = 'unknown'
  if (online === 'offline') {
    statusText = '不可用'; statusClass = 'offline'
  } else if (['maintenance', 'repair', 'fault', 'error'].includes(state)
    || ['maintenance', 'repair', 'fault'].includes(maintenance)) {
    statusText = '维护中'; statusClass = 'maintenance'
  } else if (['paused', 'pause', 'stopped', 'disabled'].includes(pause)) {
    statusText = '暂停服务'; statusClass = 'maintenance'
  } else if (machine.occupied === true || ['busy', 'running', 'runing', 'washing', 'working', 'occupied', 'glass_water', 'foam_brush'].includes(state)) {
    statusText = '忙碌'; statusClass = 'busy'
  } else if (machine.available === false) {
    statusText = '暂不可用'
  } else if (online === 'online' && machine.available === true) {
    statusText = '空闲'; statusClass = 'online'
  }
  return { onlineStatus: online, onlineText, statusText, statusClass,
    available: machine.available === true && statusClass === 'online' }
}

module.exports = { machineAvailability }
