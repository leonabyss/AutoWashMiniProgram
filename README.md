# 泡泡洗车用户端小程序

这是一个原生微信小程序原型工程，当前根据目录内 `1.jpg` 到 `5.jpg` 的流程图搭建了用户端主流程。

## 页面

- `pages/home/home`：首屏，包含余额、CMS 轮播位、加盟广告位、分享、购买洗车卡、扫码洗车入口。
- `pages/map/map`：附近洗车点地图与网点列表。
- `pages/mine/mine`：用户信息、卡类型、余额、洗车券等基础资料。
- `pages/scan/scan`：摄像头扫码页，使用原生 `camera` 组件识别洗车机二维码。
- `pages/wash-confirm/wash-confirm`：扫码识别机器后的价格和结算方式确认页。
- `pages/wash-ready/wash-ready`：点击开始洗车后，等待后台确认机器启动的提示页。
- `pages/washing/washing`：后台确认洗车开始后的洗车中页面。
- `pages/wash-finish/wash-finish`：洗车完成页。

底部导航使用小程序原生 `tabBar` 配置，入口为 `pages/home/home`、`pages/map/map`、`pages/mine/mine`，图标资源在 `assets/tabbar`。

## 数据接口

当前接口配置在 `utils/config.js`：

- `API_BASE_URL`：用户端业务后台地址，当前为 `https://www.raywaysmart.com/api`。

`utils/api.js` 已按接口文档封装用户、钱包、会员卡、附近洗车点、扫码解析、洗车订单、机器状态、玻璃水、泡沫刷、优惠券、支付记录等接口。

页面不再内置模拟业务数据，接口失败或暂无数据时展示对应的加载、错误或空状态。

## 洗车流程

1. 打开小程序后自动调用 `wx.login` 和 `POST /mini/auth/wechat-login`。
2. 首页加载 `GET /mini/users/me`、`GET /mini/wallet`、`GET /mini/wash/orders/current`。
3. 点击“开始洗车”调用 `wx.scanCode`，解析二维码后请求 `POST /mini/scan/resolve`。
4. 确认页选择支付方式，点击“开始洗车”后调用 `POST /mini/wash/orders`。
5. 如果后台返回 `payRequired=true`，小程序会拉起 `wx.requestPayment`。
6. 支付或权益扣减完成后调用 `POST /mini/wash/orders/{orderNo}/start`。
7. 启动页轮询 `GET /mini/wash/orders/{orderNo}/status`，进入 `running` 后跳到洗车中。
8. 洗车中每 3 秒轮询状态；点击结束调用 `POST /mini/wash/orders/{orderNo}/stop`。
9. 完成页调用 `GET /mini/wash/orders/{orderNo}` 和 `GET /mini/wallet` 回显用时、消费和余额。

## 运行

使用微信开发者工具导入本目录：

`D:\Works\backend\洗车机管理系统\AutoWashMiniProgram`

`project.config.json` 已配置当前小程序 AppID。
