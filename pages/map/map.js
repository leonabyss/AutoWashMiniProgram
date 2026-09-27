const api = require('../../utils/api')
const { ensurePhoneBound } = require('../../utils/auth')
const { ensureLogin } = require('../../utils/request')
const { API_BASE_URL } = require('../../utils/config')
const { meterToDistance } = require('../../utils/format')

const STATUS_COLORS = {
  closed: '#2f73f6',
  idle: '#18a91e',
  busy: '#ff7a1f',
  maintenance: '#7b78e8',
  offline: '#777777'
}

const PIN_ICONS = {
  closed: '/assets/map/pin_close.png',
  idle: '/assets/map/pin_idle.png',
  busy: '/assets/map/pin_busy.png',
  maintenance: '/assets/map/pin_repair.png',
  offline: '/assets/map/pin_stop.png'
}

function getApiOrigin() {
  const match = String(API_BASE_URL || '').match(/^https?:\/\/[^/]+/)

  return match ? match[0] : ''
}

function normalizeImageUrl(url) {
  if (!url) return ''

  const value = String(url)

  if (/^https?:\/\//.test(value) || value.charAt(0) !== '/') {
    return value
  }

  if (value.indexOf('/image/') === 0 || value.indexOf('/uploads/') === 0) {
    return `${API_BASE_URL}${value}`
  }

  return `${getApiOrigin()}${value}`
}

function getImageValue(image) {
  if (!image) return ''

  if (typeof image === 'string') {
    return image
  }

  return image.originUrl || image.originalUrl || image.url || image.imageUrl || image.photoUrl || image.coverImageUrl || ''
}

function toNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function calcDistanceM(from, to) {
  if (!from || !to || !from.latitude || !from.longitude || !to.latitude || !to.longitude) return 0

  const rad = Math.PI / 180
  const earthRadius = 6378137
  const lat1 = from.latitude * rad
  const lat2 = to.latitude * rad
  const deltaLat = (to.latitude - from.latitude) * rad
  const deltaLng = (to.longitude - from.longitude) * rad
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function normalizeMachine(machine) {
  const onlineStatus = String(machine.onlineStatus || '').toLowerCase()
  const machineStatus = String(machine.machineStatus || machine.status || '').toLowerCase()
  const pauseStatus = String(machine.pauseStatus || '').toLowerCase()
  const maintenanceStatus = String(machine.maintenanceStatus || '').toLowerCase()
  const isOffline = (
    onlineStatus === 'offline'
    || machineStatus === 'offline'
    || machineStatus === 'stopped'
    || machineStatus === 'shutdown'
    || machineStatus === 'disabled'
  )
  const isMaintenance = (
    pauseStatus === 'paused'
    || maintenanceStatus === 'maintenance'
    || maintenanceStatus === 'repair'
    || machineStatus === 'maintenance'
    || machineStatus === 'repair'
  )
  const isBusy = (
    machine.occupied
    || machine.available === false
    || machineStatus === 'busy'
    || machineStatus === 'running'
    || machineStatus === 'washing'
    || machineStatus === 'working'
    || machineStatus === 'occupied'
  )

  let state = 'idle'
  let stateText = '空闲'

  if (isOffline) {
    state = 'offline'
    stateText = '停机'
  } else if (isMaintenance) {
    state = 'maintenance'
    stateText = '维修中'
  } else if (isBusy) {
    state = 'busy'
    stateText = '忙碌'
  }

  return Object.assign({}, machine, {
    machineId: machine.machineId || machine.id,
    name: machine.name || machine.machineName || '洗车机',
    state,
    stateText,
    available: state === 'idle'
  })
}

function buildMachineSummary(machines, fallbackAvailable, fallbackTotal, fallbackBusy, fallbackMaintenance, fallbackOffline) {
  const machineList = (machines || []).map(normalizeMachine)
  const hasMachines = machineList.length > 0
  const idle = hasMachines ? machineList.filter((item) => item.state === 'idle').length : toNumber(fallbackAvailable, 0)
  const fallbackBusyCount = toNumber(fallbackBusy, 0)
  const fallbackMaintenanceCount = toNumber(fallbackMaintenance, 0)
  const fallbackOfflineCount = toNumber(fallbackOffline, 0)
  const hasFallbackBreakdown = [fallbackBusy, fallbackMaintenance, fallbackOffline]
    .some((value) => value !== undefined && value !== null)
  const total = machineList.length || toNumber(
    fallbackTotal,
    idle + fallbackBusyCount + fallbackMaintenanceCount + fallbackOfflineCount
  )
  const busy = hasMachines
    ? machineList.filter((item) => item.state === 'busy').length
    : (hasFallbackBreakdown ? fallbackBusyCount : Math.max(0, total - idle))
  const maintenance = hasMachines
    ? machineList.filter((item) => item.state === 'maintenance').length
    : fallbackMaintenanceCount
  const offline = hasMachines
    ? machineList.filter((item) => item.state === 'offline').length
    : fallbackOfflineCount
  let statusClass = 'offline'
  let statusText = total ? '停机' : '暂无设备'

  if (idle > 0) {
    statusClass = 'idle'
    statusText = `空闲${idle}台`
  } else if (busy > 0) {
    statusClass = 'busy'
    statusText = '忙碌'
  } else if (maintenance > 0) {
    statusClass = 'maintenance'
    statusText = '维修中'
  }

  return {
    machines: machineList,
    total,
    idle,
    busy,
    maintenance,
    offline,
    statusText,
    statusClass
  }
}

function getStationStatus(site, machineSummary, openingText) {
  const businessStatus = String(site.businessStatus || site.openStatus || '').toLowerCase()
  const isClosed = (
    businessStatus === 'closed'
    || businessStatus === 'close'
    || businessStatus === 'non_business'
    || businessStatus === 'off_hours'
    || String(openingText || '').indexOf('暂停') >= 0
    || String(openingText || '').indexOf('非营业') >= 0
  )

  if (isClosed) {
    return {
      statusClass: 'closed',
      statusText: '非营业时间'
    }
  }

  return {
    statusClass: machineSummary.statusClass,
    statusText: machineSummary.statusText
  }
}

function getSiteImages(site) {
  const images = []
  const imageSources = [
    site.coverImageUrl,
    site.coverUrl,
    site.imageUrl,
    site.photoUrl
  ]

  ;[
    site.images,
    site.imageUrls,
    site.photos,
    site.photoUrls,
    site.siteImages,
    site.pictureUrls,
    site.pictures
  ].forEach((list) => {
    if (Array.isArray(list)) {
      imageSources.push(...list.map(getImageValue))
    }
  })

  imageSources.forEach((url) => {
    if (!url) return

    const normalizedUrl = normalizeImageUrl(url)

    if (normalizedUrl && images.indexOf(normalizedUrl) < 0) {
      images.push(normalizedUrl)
    }
  })

  return images
}

function getSiteImage(site) {
  return getSiteImages(site)[0]
}

function getPaySources(site) {
  const pricing = site.pricing || {}
  const sources = []

  ;[
    pricing.supportPayMethods,
    site.supportPayMethods,
    site.payMethods,
    site.supportBillingMethods,
    site.billingMethods,
    site.supportCards,
    site.supportServices
  ].forEach((list) => {
    if (Array.isArray(list)) {
      sources.push(...list.map((item) => String(item).toLowerCase()))
    }
  })

  ;(site.availableCards || []).forEach((card) => {
    sources.push(String(card.cardKind || card.productType || card.productTypeCode || card.name || '').toLowerCase())
  })

  if ((site.availableCoupons || []).length) {
    sources.push('coupon')
  }

  return sources
}

function hasAny(source, keywords) {
  return source.some((item) => keywords.some((keyword) => item.indexOf(keyword) >= 0))
}

function buildPaySupports(site) {
  const source = getPaySources(site)

  return [
    {
      key: 'wash_card',
      label: '洗车卡',
      supported: hasAny(source, ['wash_card', 'wallet', 'balance', 'recharge_card', 'stored'])
    },
    {
      key: 'coupon',
      label: '洗车券',
      supported: hasAny(source, ['coupon', 'ticket'])
    },
    {
      key: 'single_card',
      label: '单次卡',
      supported: hasAny(source, ['single_card', 'single'])
    },
    {
      key: 'member',
      label: '包月会员',
      supported: hasAny(source, ['member', 'month', 'monthly', 'season', 'year', 'vip'])
    }
  ]
}

function normalizeStation(site, userLocation) {
  const latitude = toNumber(site.lat || site.latitude, 0)
  const longitude = toNumber(site.lng || site.longitude, 0)
  const distanceM = Number(site.distanceM || 0) || calcDistanceM(userLocation, { latitude, longitude })
  const machineSummary = buildMachineSummary(
    site.machines,
    site.availableMachineCount || site.idleMachineCount || site.available,
    site.totalMachineCount || site.total,
    site.busyMachineCount || site.workingMachineCount || site.occupiedMachineCount || site.working || site.busy,
    site.maintenanceMachineCount || site.repairMachineCount || site.maintenanceCount || site.maintenance,
    site.offlineMachineCount || site.stoppedMachineCount || site.offlineCount || site.offline
  )
  const openingText = site.openingText || site.businessHours || site.openingHours || (site.businessStatus === 'closed' ? '暂停营业' : '24小时')
  const stationStatus = getStationStatus(site, machineSummary, openingText)
  const imageUrls = getSiteImages(site)

  return Object.assign({}, site, machineSummary, stationStatus, {
    id: site.siteId || site.id,
    siteId: site.siteId || site.id,
    name: site.name || site.siteName || '洗车点',
    address: site.address || site.location || '暂无地址',
    latitude,
    longitude,
    imageUrls,
    coverImageUrl: imageUrls[0] || getSiteImage(site),
    distanceM,
    distance: site.distance || meterToDistance(distanceM),
    openingText,
    paySupports: buildPaySupports(site)
  })
}

Page({
  data: {
    stations: [],
    latitude: 0,
    longitude: 0,
    userLocation: null,
    markers: [],
    statusLegends: [
      { key: 'closed', label: '非营业时间', color: STATUS_COLORS.closed },
      { key: 'idle', label: '空闲', color: STATUS_COLORS.idle },
      { key: 'busy', label: '忙碌', color: STATUS_COLORS.busy },
      { key: 'maintenance', label: '维修中', color: STATUS_COLORS.maintenance },
      { key: 'offline', label: '停机', color: STATUS_COLORS.offline }
    ],
    filters: [
      { key: 'all', label: '全部' },
      { key: 'member', label: '我的会员场地' }
    ],
    activeFilter: 'all',
    cityOptions: [{ cityId: '', cityName: '全部城市' }],
    cityIndex: 0,
    districtOptions: [{ districtCode: '', districtName: '全部区域' }],
    districtIndex: 0,
    siteKeyword: '',
    searchVisible: false,
    searchLoading: false,
    searchTitle: '搜索结果',
    searchResults: [],
    selectedStation: null,
    photoIndex: 0,
    detailVisible: false,
    phoneAuthVisible: false,
    loading: false
  },

  onLoad(options) {
    this.initialSiteId = options && options.siteId
    this.cityId = options && options.cityId
    this.districtCode = ''
    this.loadRegionOptions()
    this.loadMapPage()
  },

  onUnload() {
    if (this.regionTimer) {
      clearTimeout(this.regionTimer)
      this.regionTimer = null
    }
    if (this.siteSearchTimer) {
      clearTimeout(this.siteSearchTimer)
      this.siteSearchTimer = null
    }
    this.siteSearchRequestId = (this.siteSearchRequestId || 0) + 1
  },

  onReady() {
    this.mapContext = wx.createMapContext('stationMap', this)

    if (!this.data.markers.length) {
      this.setData({
        markers: this.buildMarkers(this.getFilteredStations(this.data.stations))
      })
    }
  },

  loadRegionOptions() {
    return api.regions.cities()
      .then((items) => {
        const cities = [{ cityId: '', cityName: '全部城市' }].concat(Array.isArray(items) ? items : [])
        const cityIndex = this.cityId
          ? Math.max(cities.findIndex((item) => String(item.cityId) === String(this.cityId)), 0)
          : 0
        this.cityId = cities[cityIndex].cityId || ''
        this.setData({ cityOptions: cities, cityIndex })
        return this.loadDistrictOptions(this.cityId)
      })
      .catch(() => {
        this.setData({
          cityOptions: [{ cityId: '', cityName: '全部城市' }],
          cityIndex: 0,
          districtOptions: [{ districtCode: '', districtName: '全部区域' }],
          districtIndex: 0
        })
      })
  },

  loadDistrictOptions(cityId) {
    if (!cityId) {
      this.districtCode = ''
      this.setData({
        districtOptions: [{ districtCode: '', districtName: '全部区域' }],
        districtIndex: 0
      })
      return Promise.resolve()
    }

    return api.regions.districts(cityId).then((items) => {
      const districts = [{ districtCode: '', districtName: '全部区域' }].concat(Array.isArray(items) ? items : [])
      const districtIndex = this.districtCode
        ? Math.max(districts.findIndex((item) => String(item.districtCode) === String(this.districtCode)), 0)
        : 0
      this.districtCode = districts[districtIndex].districtCode || ''
      this.setData({ districtOptions: districts, districtIndex })
    })
  },

  onCityChange(event) {
    const cityIndex = Number(event.detail.value || 0)
    const city = this.data.cityOptions[cityIndex] || this.data.cityOptions[0]
    this.cityId = city.cityId || ''
    this.districtCode = ''
    this.setData({ cityIndex, districtIndex: 0 })
    this.loadDistrictOptions(this.cityId).finally(() => {
      this.loadMapMarkers({ useBounds: false })
      if (this.data.siteKeyword) this.scheduleSiteSearch(0)
    })
  },

  onDistrictChange(event) {
    const districtIndex = Number(event.detail.value || 0)
    const district = this.data.districtOptions[districtIndex] || this.data.districtOptions[0]
    this.districtCode = district.districtCode || ''
    this.setData({ districtIndex })
    this.loadMapMarkers({ useBounds: false })
    if (this.data.siteKeyword) this.scheduleSiteSearch(0)
  },

  onSiteKeywordInput(event) {
    const siteKeyword = String(event.detail.value || '')
    this.setData({ siteKeyword, searchVisible: true, searchTitle: '搜索结果' })
    this.scheduleSiteSearch(300)
  },

  onSiteSearchFocus() {
    this.setData({ searchVisible: true })
    if (!this.data.siteKeyword && !this.data.searchResults.length) {
      this.showRecentSites()
    }
  },

  scheduleSiteSearch(delay) {
    if (this.siteSearchTimer) clearTimeout(this.siteSearchTimer)
    this.siteSearchTimer = setTimeout(() => {
      this.siteSearchTimer = null
      this.searchSites()
    }, Number(delay) || 0)
  },

  searchSites() {
    const keyword = String(this.data.siteKeyword || '').trim()
    if (!keyword) {
      this.setData({ searchLoading: false, searchResults: [] })
      return Promise.resolve()
    }
    const requestId = (this.siteSearchRequestId || 0) + 1
    this.siteSearchRequestId = requestId
    const location = this.data.userLocation || {}
    this.setData({ searchLoading: true, searchVisible: true, searchTitle: '搜索结果' })

    return api.sites.search({
      cityId: this.cityId || undefined,
      districtCode: this.districtCode || undefined,
      keyword,
      lat: location.latitude,
      lng: location.longitude,
      sort: 'distance',
      page: 0,
      size: 20
    }).then((page) => {
      if (requestId !== this.siteSearchRequestId) return
      this.setData({ searchResults: this.formatSearchResults((page && page.items) || []) })
    }).catch((err) => {
      if (requestId !== this.siteSearchRequestId) return
      this.setData({ searchResults: [] })
      wx.showToast({ title: err.message || '场地搜索失败', icon: 'none' })
    }).finally(() => {
      if (requestId === this.siteSearchRequestId) this.setData({ searchLoading: false })
    })
  },

  showRecentSites() {
    const requestId = (this.siteSearchRequestId || 0) + 1
    this.siteSearchRequestId = requestId
    const location = this.data.userLocation || {}
    this.setData({ searchVisible: true, searchLoading: true, searchTitle: '近期洗过的场地' })
    return api.sites.recent({
      lat: location.latitude,
      lng: location.longitude,
      page: 0,
      size: 10
    }).then((page) => {
      if (requestId !== this.siteSearchRequestId) return
      this.setData({ searchResults: this.formatSearchResults((page && page.items) || []) })
    }).catch((err) => {
      if (requestId !== this.siteSearchRequestId) return
      this.setData({ searchResults: [] })
      if (err.code !== 'AUTH_REQUIRED') {
        wx.showToast({ title: err.message || '近期场地加载失败', icon: 'none' })
      }
    }).finally(() => {
      if (requestId === this.siteSearchRequestId) this.setData({ searchLoading: false })
    })
  },

  formatSearchResults(items) {
    return items.map((item) => Object.assign({}, item, {
      distanceText: item.distanceM === null || item.distanceM === undefined ? '' : meterToDistance(Number(item.distanceM)),
      regionText: [item.cityName, item.districtName].filter((value) => !!value).join(' ')
    }))
  },

  clearSiteKeyword() {
    if (this.siteSearchTimer) clearTimeout(this.siteSearchTimer)
    this.siteSearchRequestId = (this.siteSearchRequestId || 0) + 1
    this.setData({
      siteKeyword: '',
      searchVisible: false,
      searchLoading: false,
      searchResults: []
    })
    this.loadMapMarkers({ useBounds: true, showLoading: false })
  },

  closeSiteSearch() {
    if (this.data.searchVisible) this.setData({ searchVisible: false })
  },

  selectSearchSite(event) {
    const siteId = event.currentTarget.dataset.siteId
    const raw = this.data.searchResults.find((item) => String(item.siteId) === String(siteId))
    if (!raw) return

    const station = normalizeStation(raw, this.data.userLocation)
    const existingIndex = this.data.stations.findIndex((item) => String(item.siteId) === String(siteId))
    const stations = this.data.stations.slice()
    if (existingIndex >= 0) {
      station.markerId = stations[existingIndex].markerId
      stations[existingIndex] = Object.assign({}, stations[existingIndex], station)
    } else {
      station.markerId = stations.reduce((max, item) => Math.max(max, Number(item.markerId) || 0), 0) + 1
      stations.push(station)
    }
    this.setData({
      stations,
      markers: this.buildMarkers(this.getFilteredStations(stations)),
      siteKeyword: station.name,
      searchVisible: false,
      latitude: station.latitude,
      longitude: station.longitude
    }, () => this.selectStation(siteId, true))
  },

  getFilteredStations(siteList, filterKey) {
    const activeFilter = filterKey || this.data.activeFilter

    if (activeFilter !== 'member') {
      return siteList
    }

    return siteList.filter((station) => station.memberSite === true)
  },

  buildMarkers(siteList) {
    return siteList
      .filter((station) => station.latitude && station.longitude)
      .map((station) => ({
        id: station.markerId,
        latitude: station.latitude,
        longitude: station.longitude,
        iconPath: PIN_ICONS[station.statusClass] || PIN_ICONS.offline,
        width: 58,
        height: 58,
        anchor: {
          x: 0.5,
          y: 1
        },
        callout: {
          content: `${station.name}  ${station.statusText}`,
          color: STATUS_COLORS[station.statusClass] || '#13223a',
          fontSize: 13,
          borderRadius: 8,
          bgColor: '#ffffff',
          padding: 8,
          display: 'BYCLICK'
        }
      }))
  },

  changeFilter(event) {
    const activeFilter = event.currentTarget.dataset.key
    if (activeFilter === this.data.activeFilter) return

    const applyFilter = () => {
      this.setData({
        activeFilter,
        detailVisible: false,
        selectedStation: null
      })
      this.loadMapMarkers({ useBounds: true })
    }

    if (activeFilter === 'member') {
      ensureLogin()
        .then(applyFilter)
        .catch((err) => {
          wx.showToast({
            title: err.message || '请先登录',
            icon: 'none'
          })
        })
      return
    }

    applyFilter()
  },

  moveToCurrentLocation() {
    const focusLocation = (location) => {
      this.setData({
        latitude: location.latitude,
        longitude: location.longitude,
        userLocation: location
      })

      if (!this.mapContext) {
        this.mapContext = wx.createMapContext('stationMap', this)
      }

      this.mapContext.moveToLocation({
        latitude: location.latitude,
        longitude: location.longitude
      })
    }

    if (this.data.userLocation) {
      focusLocation(this.data.userLocation)
      return
    }

    this.getRealLocation()
      .then(focusLocation)
      .catch((err) => {
        wx.showToast({
          title: err.errMsg || err.message || '定位失败',
          icon: 'none'
        })
      })
  },

  getRealLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: ({ latitude, longitude }) => resolve({ latitude, longitude }),
        fail: reject
      })
    })
  },

  loadMapPage() {
    this.setData({ loading: true })

    this.getRealLocation()
      .then((location) => {
        this.setData({
          latitude: location.latitude,
          longitude: location.longitude,
          userLocation: location
        })
      })
      .catch(() => null)
      .then(() => this.loadMapMarkers({ initial: true, showLoading: false }))
      .finally(() => {
        this.setData({ loading: false })
      })
  },

  getMapBounds() {
    if (!this.mapContext) {
      this.mapContext = wx.createMapContext('stationMap', this)
    }

    return new Promise((resolve, reject) => {
      this.mapContext.getRegion({
        success: resolve,
        fail: reject
      })
    })
  },

  buildMarkerQuery(bounds) {
    const params = {}

    if (this.cityId) params.cityId = this.cityId
    if (this.districtCode) params.districtCode = this.districtCode
    if (this.data.activeFilter === 'member') params.isMember = true

    if (bounds && bounds.southwest && bounds.northeast) {
      params.minLat = bounds.southwest.latitude
      params.maxLat = bounds.northeast.latitude
      params.minLng = bounds.southwest.longitude
      params.maxLng = bounds.northeast.longitude
    }

    return params
  },

  loadMapMarkers(options) {
    const settings = options || {}
    const requestId = (this.markerRequestId || 0) + 1
    this.markerRequestId = requestId

    if (settings.showLoading !== false) {
      this.setData({ loading: true })
    }

    const boundsPromise = settings.useBounds
      ? this.getMapBounds().catch(() => null)
      : Promise.resolve(null)

    return boundsPromise
      .then((bounds) => api.sites.mapMarkers(this.buildMarkerQuery(bounds)))
      .then((markerData) => {
        if (requestId !== this.markerRequestId) return

        const source = Array.isArray(markerData)
          ? markerData
          : ((markerData && markerData.items) || [])
        const apiStations = source.map((item) => normalizeStation(item, this.data.userLocation))
        const list = apiStations
          .map((item, index) => Object.assign({}, item, { markerId: index + 1 }))

        const nextData = {
          stations: list,
          markers: this.buildMarkers(this.getFilteredStations(list)),
          selectedStation: null,
          detailVisible: false
        }

        if (!this.data.userLocation && list.length) {
          nextData.latitude = list[0].latitude
          nextData.longitude = list[0].longitude
        }

        this.setData(nextData)

        if (settings.initial && this.initialSiteId) {
          const siteId = this.initialSiteId
          this.initialSiteId = null
          this.selectStation(siteId, true)
        }
      })
      .catch((err) => {
        if (requestId !== this.markerRequestId) return

        if (!this.data.stations.length || settings.initial) {
          this.setData({
            stations: [],
            markers: [],
            selectedStation: null,
            detailVisible: false
          })
        } else {
          this.setData({
            markers: this.buildMarkers(this.getFilteredStations(this.data.stations))
          })
        }

        wx.showToast({
          title: err.message || '地图场地加载失败',
          icon: 'none'
        })
      })
      .finally(() => {
        if (settings.showLoading !== false && requestId === this.markerRequestId) {
          this.setData({ loading: false })
        }
      })
  },

  onRegionChange(event) {
    const detail = event.detail || {}
    const phase = detail.type || event.type
    const causedBy = detail.causedBy

    if (phase !== 'end') return
    if (causedBy && causedBy !== 'gesture' && causedBy !== 'scale') return

    if (this.regionTimer) clearTimeout(this.regionTimer)
    this.regionTimer = setTimeout(() => {
      this.loadMapMarkers({ useBounds: true })
    }, 400)
  },

  onMarkerTap(event) {
    const markerId = event.markerId || event.detail.markerId
    this.selectStation(markerId, true)
  },

  selectStation(id, showDetail) {
    const station = this.data.stations.find((item) => (
      String(item.markerId) === String(id) || String(item.siteId) === String(id)
    ))

    if (!station) return

    this.setData({
      latitude: station.latitude,
      longitude: station.longitude,
      selectedStation: station,
      photoIndex: 0,
      detailVisible: !!showDetail
    })

    this.loadSiteDetail(station.siteId)
  },

  loadSiteDetail(siteId) {
    Promise.all([
      api.sites.detail(siteId).catch(() => null),
      api.sites.machines(siteId).catch(() => [])
    ])
      .then(([detail, machines]) => {
        const previousCoverImageUrl = this.data.selectedStation && this.data.selectedStation.coverImageUrl
        const previousImageUrls = (this.data.selectedStation && this.data.selectedStation.imageUrls) || []
        const base = Object.assign({}, this.data.selectedStation || {}, detail || {})
        const merged = Object.assign({}, base, {
          machines: (machines && machines.length) ? machines : (base.machines || [])
        })
        const normalizedStation = normalizeStation(merged, this.data.userLocation)
        const imageUrls = normalizedStation.imageUrls.length ? normalizedStation.imageUrls : previousImageUrls
        const coverImageUrl = imageUrls[0] || previousCoverImageUrl || ''
        const photoIndex = Math.min(this.data.photoIndex || 0, Math.max(imageUrls.length - 1, 0))
        const station = Object.assign({}, normalizedStation, { coverImageUrl, imageUrls })
        const stations = this.data.stations.map((item) => (
          String(item.siteId) === String(siteId) ? Object.assign({}, item, station, { markerId: item.markerId }) : item
        ))

        this.setData({
          stations,
          selectedStation: station,
          photoIndex,
          markers: this.buildMarkers(this.getFilteredStations(stations))
        })
      })
      .catch((err) => {
        wx.showToast({
          title: err.message || '场地详情加载失败',
          icon: 'none'
        })
      })
  },

  onSitePhotoChange(event) {
    this.setData({
      photoIndex: event.detail.current || 0
    })
  },

  previewSiteImage() {
    const station = this.data.selectedStation

    if (!station) return

    const imageUrls = (station && station.imageUrls) || []
    const current = imageUrls[this.data.photoIndex] || station.coverImageUrl

    if (!current) return

    wx.previewImage({
      current,
      urls: imageUrls.filter((url) => !!url)
    })
  },

  handleSiteImageError(event) {
    const station = this.data.selectedStation

    if (!station) return

    const failedUrl = event.currentTarget.dataset.url

    const imageUrls = (station.imageUrls || []).filter((url) => url && url !== failedUrl)
    const nextImageUrls = imageUrls
    const photoIndex = Math.min(this.data.photoIndex || 0, Math.max(nextImageUrls.length - 1, 0))

    const selectedStation = Object.assign({}, station, {
      imageUrls: nextImageUrls,
      coverImageUrl: nextImageUrls[0]
    })
    const stations = this.data.stations.map((item) => (
      String(item.siteId) === String(station.siteId) ? Object.assign({}, item, {
        imageUrls: nextImageUrls,
        coverImageUrl: nextImageUrls[0]
      }) : item
    ))

    this.setData({
      selectedStation,
      stations,
      photoIndex
    })
  },

  closeDetail() {
    this.setData({ detailVisible: false })
  },

  noop() {},

  navigateStation() {
    const station = this.data.selectedStation

    if (!station) return

    wx.openLocation({
      latitude: station.latitude,
      longitude: station.longitude,
      name: station.name,
      address: station.address,
      scale: 18
    })
  },

  goStation() {
    this.navigateStation()
  },

  requirePhone(action) {
    this.authAfterSuccess = action

    return ensurePhoneBound()
      .then(() => {
        const nextAction = this.authAfterSuccess
        this.authAfterSuccess = null

        if (nextAction) {
          nextAction()
        }
      })
      .catch((err) => {
        if (err.code === 'PHONE_REQUIRED') {
          this.setData({ phoneAuthVisible: true })
          return
        }

        this.authAfterSuccess = null
        wx.showToast({
          title: err.message || '登录失败',
          icon: 'none'
        })
      })
  },

  openScanPage() {
    wx.navigateTo({
      url: '/pages/scan/scan'
    })
  },

  scanMachine() {
    this.requirePhone(() => this.openScanPage())
  },

  onPhoneAuthSuccess() {
    const nextAction = this.authAfterSuccess

    this.setData({ phoneAuthVisible: false })
    this.authAfterSuccess = null

    if (nextAction) {
      nextAction()
    }
  },

  onPhoneAuthCancel() {
    this.authAfterSuccess = null
    this.setData({ phoneAuthVisible: false })
  },

  onShareAppMessage() {
    const station = this.data.selectedStation

    if (station) {
      return {
        title: `${station.name} - 附近自助洗车点`,
        path: `/pages/map/map?siteId=${encodeURIComponent(station.siteId || '')}`,
        imageUrl: station.coverImageUrl || undefined
      }
    }

    return {
      title: '附近自助洗车点',
      path: '/pages/map/map'
    }
  }
})
