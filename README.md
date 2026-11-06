# 池核飞行 · POOLCORE FLIGHT

一个开阔、无限生成的 **池核（poolcore / liminal-space）飞行游戏**：你驾驶一艘方块星舰，在无边的青碧色瓷砖大海与白色梯田平台上穿梭。纯前端、零依赖、离线可玩。

> 用一个 HTML 页 + 本地 vendored 的 Three.js 组合了**两份素材**：
> - **Poolrooms**（池核审美 / 瓷砖泳池 / 水面 / 雾 / 立柱）
> - **VOXEL ODYSSEY**（程序化方块星舰 `buildShip` + 分块无限地形生成）

---

## 立即开始

**方式 A（推荐，最简单）**：双击 `index.html`，点击画面进入即可。
（浏览器需支持 WebGL2 / WebGL；首次加载约 1-2 秒生成首屏地形。）

**方式 B（本地静态服务器）**：某些浏览器对 `file://` 有脚本限制时可改用：
```powershell
若已安装 Python： python -m http.server 8123
或用 Node：  node lib/serve.js 8123
```
然后打开 `http://127.0.0.1:8123/index.html`。

Windows 用户可直接双击 `play.bat`（会自动尝试用本机静态服务器 + Edge 打开）。

---

## 操作

| 按键 | 功能 |
| --- | --- |
| `W` / `S` | 推力 ↑ / ↓ |
| 鼠标 | 俯仰 + 偏航转向（指针锁定后） |
| `A` / `D` | 滚转（侧倾）|
| `Shift` | 加力 / 脉冲加速 |
| `C` | 追尾视角 ↔ 座舱视角 |
| `F` | 开启/关闭 飞行辅助（自动改平）|
| `R` | 重置（在海上空重生）|
| `P` | 暂停（释放鼠标锁定）|

---

## 特性

- **无限地形**：按玩家位置流式生成/回收地形区块（chunk），飞到哪里生成到哪里。
- **池核地形**：青碧瓷砖海 + 白色梯田平台 + 悬崖台阶 + 平台顶部的下沉泳池。
- **程序化建筑**：瓷砖立柱、矮墙、拱门、平台散布在升起的甲板上。
- **水面着色器**：动态波纹 + 泡沫高光 + 雾，随玩家跨区块无缝铺展。
- **天空穹顶**：青碧渐变 + 太阳光晕 + 漂浮雾带。
- **方块星舰**：源自 Voxel Odyssey 的程序化 `buildShip`（随机配色），带发光引擎、座舱、尾鳍与收放尾迹特效。
- **HUD**：罗盘、速度、高度、推力、坐标、FPS、航向。
- **光影**：方向光 + 半球光 + PCF 软阴影，ACES 色调映射。

---

## 技术

- 渲染底座：`lib/three.min.js`（Three.js r152，UMD 全局 `THREE`，本地离线，无 CDN）。
- 全部游戏逻辑在 `js/game.js`，仅 `index.html` + `css/ui.css` 一层壳。
- 无限地形使用高度函数 `terrainHeight(x,z)`（ridged-fbm + 梯田量化 + 下沉泳池裁切），
  每区块编程生成 `BufferGeometry`，并做 AO/uv/顶点色。
- `?shot=1` 进入无指针锁定、自动环绕相机的截图模式（用于自动化验证，不影响正常游玩）。

### 文件结构
```
index.html            游戏壳 + HUD DOM
css/ui.css            池核 HUD / 罗盘 / 飞船风样式
js/game.js            渲染 + 无限地形 + 星舰 + 飞行 + 相机 + HUD
lib/three.min.js      vendored Three.js（离线）
play.bat              Windows 一键启动
README.md             本说明
shots/                开发期验证截图
```

---

### 调试 / 验证
```powershell
# 语法检查
node --check js/game.js

# 本地服务器
node lib/serve.js 8123
```
浏览器控制台无报错；DOM 就绪标记 `window.__PCF_READY === true`，
调试句柄 `window.__PCF`（含 `fly` / `terrainHeight` / `WORLD`）。
