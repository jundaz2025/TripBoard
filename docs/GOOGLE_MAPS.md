# Google Maps 与本次改进（2026-09-23）

你的代码已直接更新在 `/Users/jdz/Documents/TripBoard`。网站固定文案为英文。
浏览器打开 http://127.0.0.1:5176/ 后刷新一次，加载新版地图模块。

## 已完成

- 新账号密码要求 12–128 位，包含 A–Z、a–z、数字和至少一个符号；前后端均校验。
- 注册要求再次输入密码，两栏都能单独显示／隐藏。密码不会被自动去掉首尾空格。
- 已有账号保留原密码，仍可登录；没有强迫重设密码。
- 重新设计注册页面，调整卡片、对比度、表单间距和移动端布局。
- 地图上可以直接搜索地址或地名，选择匹配结果后立即显示红点；点击 Save place 保存。
- 地图、活动、收藏地点和酒店的地址搜索都限制在旅行已保存的 Destination 范围内。后端使用城市的地理边界框和国家过滤，并再次检查结果坐标；边界框可能包含邻近区域，并非精确行政区多边形。没有本地匹配项时返回空结果，不会扩大到全球。无法识别目的地时，请在 Trip settings 将 Destination 改成明确的城市和国家。
- 空旅行的地图会根据已保存的 Destination 自动显示对应城市，例如 New York；修改目的地后会更新。已有景点或酒店时优先显示这些地点，手动搜索预览优先定位到搜索结果。城市定位用于地图视野，不会自动创建活动或收藏地点。
- 活动编辑顶部也能搜索地址。直接填写 Address or place name 后点击 Save activity，会查找匹配结果；选择正确地点，再保存。活动和新地点通过同一版本检查、同一事务保存。
- 已存在但没有坐标的活动：点击 Locate on map，搜索并选择位置，再保存。
- 新搜索的地点不会被当作已经核实营业时间；默认显示 Opening hours not set。可以在 Saved places 编辑中设置时间并勾选使用营业时间约束。
- Account settings → Delete my account：先列出受影响旅行，再输入当前密码与 DELETE。自己的旅行会对所有成员删除；别人的旅行保留，仅移除自己的成员身份。所有登录会话和自己的通知都会撤销／删除。

## 为什么现在还不是 Google Maps

本地尚未设置 Google Maps Key。代码已经提供 Google Maps 渲染器，配置后自动使用 Google Maps，语言参数固定为 `en`；加载或授权失败时回退到备用地图。

无 Key 时使用 MapLibre + OpenFreeMap 的 OpenStreetMap 数据，优先显示英文／拉丁字母地名。地址搜索使用 Nominatim，结果请求英文。网站不会翻译用户自己输入的内容，外部地址数据也不保证每个街道都有英文译名。

Google 官方目前提供标准 API Key 和用于有限原型功能的 Maps Demo Key。标准接入需启用 Maps JavaScript API 和计费。未配置有效 Key，因此 Google Maps 真正加载和计费尚未实测；备用地图、真实地址搜索、红点和保存已实测。

官方说明：https://developers.google.com/maps/documentation/javascript/get-api-key
英文地图说明：https://developers.google.com/maps/documentation/javascript/localization

## 在 VS Code 配置标准 Google Maps Key

1. 在 Google Cloud 的项目中启用计费与 **Maps JavaScript API**，创建一个用于网站的 Key。
2. 给 Key 添加 **Websites / HTTP referrers** 限制，允许你的本地网站：
   - `http://127.0.0.1:5176/*`
   - `http://localhost:5176/*`
3. API 限制选择 **Maps JavaScript API**。本项目仍通过 Nominatim 搜索地址，因此这版不需要额外启用 Google Geocoding API 或 Places API。
4. VS Code 左侧打开 `frontend` 文件夹，在里面新建 `.env.local`。也可以复制 `frontend/.env.example` 后改名。文件放在 `/Users/jdz/Documents/TripBoard/frontend/.env.local`。
5. 写入下面一行，把等号右边换成你自己的浏览器 Key；不要把 Key 发到聊天里。

   ```dotenv
   VITE_GOOGLE_MAPS_API_KEY=your_browser_restricted_key
   ```

   本地高级标记默认使用 Google 的 `DEMO_MAP_ID`。正式部署可另建自己的 Map ID，增加 `VITE_GOOGLE_MAPS_MAP_ID=your_map_id`。
6. 保存文件。在运行 `bash scripts/dev.sh` 的 VS Code Terminal 按 `Control+C`，再输入：

   ```bash
   cd /Users/jdz/Documents/TripBoard
   bash scripts/dev.sh
   ```

7. 刷新 http://127.0.0.1:5176/。地图右上角的供应商标签应显示 **Google Maps**。

VITE_ 变量会进入浏览器代码，所以这里必须是限制了网站来源和 API 的 Google 浏览器 Key。OpenAI 的私密 Key 仍然只能放在 `backend/.env`，不能放在前端。`.env.local` 已被 `.gitignore` 排除。

如果仍出现备用地图，检查 Key 是否有效、Maps JavaScript API 是否启用、计费是否启用，以及允许的网站来源是否包含当前地址。

## 验证与备份

32 项后端测试分别在 SQLite 和独立 PostgreSQL 测试数据库通过。前端 TypeScript + Vite 构建通过。浏览器实测注册显示／隐藏控件、登录、删除前预览、真实地址搜索、地点保存、活动地址选择及 390px 宽度布局。

删除账号的真正执行通过隔离 API 测试验证；没有删除你的真实账号。你的原始源码及数据库备份位于：
`/Users/jdz/Documents/TripBoard/.backups/20260923-0338-account-map/`
