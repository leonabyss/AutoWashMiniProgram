# 新版购卡页面接口核对

入口：旧购卡页面顶部“新版购卡页面”，路径 pages/buy-card-new/buy-card-new。旧版路径及其他页面入口未替换。

## 确认支付页

新版选择套餐后进入 pages/card-checkout/card-checkout，只传 siteId/productId，不通过页面参数传价格或权益。
确认页重新读取该场地商品、场地详情和体验状态，显示价格、有效期、额度、赠券、场地及规则；购买须知为本地文案。
进入页面不创建订单、不拉起支付。点击确认支付时再次获取商品和规则；发生变化先更新页面并要求重新确认。后台创建订单返回金额不同时再次要求确认，缺少支付单号、金额或支付参数不冒充支付成功。
付款取消后保留当前支付单供重试，不再次创建新单；支付结果待确认时阻止重复付款，提供后台确认刷新及订单中心入口。
后台确认成功后提供返回使用按钮，优先返回原 wash-confirm 页面，由该页重新读取余额与卡券。
旧购卡页面仍沿用原支付交互；新页面未新增后台支付接口。

## 已接接口

- 场地、城市、区县、模糊搜索：复用原购卡控制器。
- 商品：GET /mini/member/products?siteId=实际场地ID&bizCategory=wash_rights。
- 标题、价格、额度、有效期、次数、到账金额：name、priceCent、rightsDurationSec/totalDurationSec、validDays/durationDays、usageTimes、faceValueCent。缺少售价、名称或商品ID时不可购买，不按套餐名字推算权益。
- 分类：cardKind 的 monthly_member、wash_card、single_card；分类是客户端类型映射，不生成不存在的商品。
- 优惠：badgeText/promotionText/cornerText、badgeImageUrl/promotionBadgeImageUrl。没有则不显示，无默认折扣或赠券。
- 分类标题右侧：包月会员与洗车卡使用固定规则句式，仅蓝色数字读取场地详情 purchaseRules；次卡仍使用商品 description。每日上限未配置时显示待配置，价格未获取时显示待确认。
- 支付：复用原 createMemberOrder/payIfNeeded；正式支付必须经后台确认，审核购买仍明确标记本机模拟。

## 需要后台确认或新增

1. 每日会员时长上限：尚无明确场地配置，新增响应字段 membershipDailyLimitMinutes 当前为 null；客户端显示待配置，不假定30分钟，也不拿设备 vipDailyLimitMin 代替场地上限。
2. 已扩展 GET /mini/sites/{siteId} 的 purchaseRules：priceConfigured、priceSource、startMinutes、startPriceCent、minutePriceCent、membershipDailyLimitMinutes。优先读取 merchant_site_wash_price，无场地覆盖则读取所属加盟商 merchant_default_wash_price。没有配置时不套用后台洗车流程的默认数值。部署新版后台后前端生效，不需要数据库迁移。此响应仅展示价格，不改变实际洗车计费。
3. 购卡条款/退款与跨场地规则：需有可配置正文及版本；新版目前只提供由商品 description 汇总的“套餐说明”，不继续展示旧版写死的全国通用/不退款承诺。
4. 最大商品数量与长描述：后台商品数量不固定。新版所有类别同时呈现；小屏、长说明或大量套餐时允许自然纵向滚动，不能为一屏强制裁掉商品、规则或缩小文字至不可读。

没有加入示例场地、示例价格或示例套餐。原购卡组件逻辑抽为同目录控制器，旧版布局保留。
