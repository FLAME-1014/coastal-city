# 栖潮 TIDELINE · 未来海滨城市数字孪生

在线演示：https://flame-1014.github.io/coastal-city/

栖潮是一座可操作的合成海滨城市。场景使用本地米制坐标（X 向东、Z 向南）；道路、建筑、气象、事件和光伏遥测均为规划与模拟设定。应用只从当前站点加载资源，不依赖 CDN、高德凭据、地形服务或后端。

## 运行与构建

Node.js 22.18+。在工作区根目录执行：

```powershell
npm --prefix coastal-city ci
npm run dev:coastal
```

打开 [http://127.0.0.1:4246/](http://127.0.0.1:4246/)。端口占用时，可在子目录运行 `npx vite --host 127.0.0.1 --port 4251 --strictPort`。默认服务器仅监听本机。

```powershell
npm run build:coastal                   # tsc --noEmit + Vite 构建到 coastal-city/dist/
npm --prefix coastal-city run preview  # 本机预览生产包，端口 4247
npm run test:coastal                    # Vitest
npm run verify:coastal                  # 单测 + 构建 + Chromium 生产页面验收
```

`dist/` 是独立静态站点，可挂载在子路径；需由 HTTP(S) 服务提供，不能双击 HTML。脚本优先使用 Playwright Chromium，Windows 其次用本机 Chrome。没有浏览器时，在 `coastal-city/` 下执行 `npx playwright install chromium`。可设 `TIDELINE_BROWSER_PATH` 指定 Chromium 系浏览器，`TIDELINE_GPU=software` 强制 SwiftShader，`TIDELINE_REPORT_DIR` 自定义输出路径。验收报告和截图默认写到 `test-results/`，该目录不进入 Git。额外设 `TIDELINE_SOAK_SECONDS=75` 可在硬件加速路径上执行多模拟日稳定性检查。

## 操作

| 操作 | 方式 |
|---|---|
| 旋转、缩放、平移 | 左键拖拽、滚轮、右键拖拽；触屏用单指旋转、双指缩放和平移 |
| 自由移动 | 点一下场景后用 `W A S D` 或方向键移动，`Q/E` 降低或升高，`Shift` 加速 |
| 切换机位 | 全景、俯瞰、海岸、街道；「回到全域」复位 |
| 查看城市资产 | 点击建筑，或按名称、编号、片区和类型检索。可试 `QL-001` 潮汐之门、`QL-003` 环湾渡运站 |
| 定位 | 片区按钮、小地图、建筑详情内「定位建筑」。`Esc` 关闭检索或清除选择 |
| 时间和天气 | 播放按钮或场景中的 `Space` 暂停；滑杆、时间预设和 1×/6×/24×/60× 速率；自动、晴、雨、雪 |
| 观察事件 | 09:12 默认早高峰；11:30–13:00 港区检修；16:30–20:30 滨海市集。单击当前事件可定位 |
| 调整性能 | 「运行统计」切换流畅、均衡、精细。检测到软件渲染时从流畅档启动 |

1× 表示每个参与模拟的真实秒前进一个城市分钟；车辆、行人的视觉移动倍率上限为 3.2×。暂停后时钟及运动冻结，仍可选楼、操作相机，或者改变时间/天气查看静态情景。隐藏页面会停止渲染；返回后从原时刻继续。WebGL 2 不可用时仍能查看地图、建筑资料、情景时间和事件。

## 架构

```text
城市数据与模拟状态                 界面
src/city/layout.ts  ───────┬───── Dashboard / MiniMap ── 用户操作
src/city/simulation.ts ────┤                ↑ ↓
                     main.ts  装配状态、UI 与渲染
                           ↓                ↑
                      SceneManager ─── 实际渲染遥测
                           ├─ CameraController / InteractionSystem
                           ├─ BuildingSystem / Infrastructure
                           ├─ Environment / WeatherSystem / TrafficSystem
                           └─ PerformanceMonitor / resources
```

- **城市模型**：`layout.ts` 从固定种子生成地块和有地址的建筑；空间、拾取 ID、小地图、车辆与行人路径共用原始坐标。`geometry.ts` 提供米制路径采样和几何工具。
- **模拟**：`simulation.ts` 管理分钟、日次、播放、倍率、天气计划、光伏与活动配置。AM 通勤、港区检修和湿地市集会改变对应片区车辆或行人的数量及速度。运动沿确定的本地路径推进，时间跳转更新情景规则，不回放历史位置。
- **呈现**：`scene.ts` 管唯一的 renderer/RAF、渲染尺寸和状态恢复；世界各模块只拥有自身对象，不订阅全局 DOM。图形资源由 `resources.ts` 统一去重释放。暂停且交互结束时，帧循环会休眠；切换时钟、相机、天气等才唤醒。
- **性能**：建筑分片区批处理，立面共享两套带占用遮罩的程序纹理；道路、树、远岛和参与者使用实例化。天气一个 `Points` 批次，粒子位置在 GPU 计算。移动实例最多约 30 次/秒更新；光位变化达到阈值才重绘静态阴影贴图。面板独立节流，帧间隔、CPU 帧处理 P95 和可用时的异步 GPU 时间分开显示。
- **状态与失效**：`main.ts` 把操作传到一个 `Simulation` 实例及当前 `SceneManager`。上下文丢失会 suspend，同一 canvas 可自动恢复或手动重建。失败、重建、页面离开分别处理 observer、监听、缓冲区与活动上下文。`?qa=1` 仅提供只读的状态和可点击屏幕坐标，用于验收。

目前道路流量是轻量街区环路，车辆无信号灯优先权、车辆间避让或跨片区路径规划。没有实时 GIS/IoT、真实天气预报、用户账号与状态持久化。性能记录基于本机 Radeon / Chromium 及软件回退路径，手机部分为 Chromium 移动视口与触控仿真。

工程审计见 [AUDIT.md](docs/AUDIT.md)，测量口径与结果见 [VALIDATION.md](docs/VALIDATION.md)。
