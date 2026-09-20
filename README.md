# 对比度调色板求解器（Contrast Palette Solver）

导入颜色令牌、候选色与 WCAG 对比度约束，**全局搜索**出同时满足全部约束的最优改色方案。
Node.js + Express + 原生前端，无前端框架、无外部网络请求，**所有数据仅在本机内存中处理**。

## 唯一启动命令

```bash
docker compose up --build
```

启动后用浏览器打开：

> http://localhost:3000

构建镜像时会自动安装全部依赖，无需手动 `npm install`。停止服务使用 `Ctrl+C`（或
`docker compose down`）。

## 功能

- 导入 JSON（粘贴文本或选择文件），内置「载入示例」按钮；
- 可**锁定任意令牌**：被锁定的令牌保持原色，不参与改色；
- **色觉鲁棒模式（可选）**：`profiles` 声明需要同时满足的色觉视型
  （`normal` / `protanopia` / `deuteranopia` / `tritanopia`），每条约束必须在
  **全部所选视型**的模拟色下都达到 `minContrast`，才会进入改色优化；
- **全局分支定界搜索**（branch and bound），在满足全部 WCAG 对比度约束的方案中，按以下顺序优化：
  1. **改色令牌数最少**；
  2. **CIE Lab 总色差最小**（ΔE\*ab / CIE76，D65 白点）；
  3. 稳定决胜：按令牌名升序、以色值字典序最小者为准（相同输入永远得到相同结果）；
- 页面按约束**逐视型展示改前 / 改后对比度比值**与是否达标，并**突出最差视型**；
- **无解时列出锁定颜色直接造成的冲突**（两端锁定不达标、单侧锁定导致对端无可用颜色、
  自反约束等），并**指明具体失败的视型**；
- 一键**导出替换后的令牌 JSON**（保留输入中的其他字段与结构，仅替换颜色）；
- 搜索采用 MRV 变量选择 + 相容位掩码前向检查 + 改色数/色差单调下界剪枝。

## 输入格式与上限

```json
{
  "name": "示例产品主题",
  "tokens": [
    { "name": "bg", "color": "#f8fafc", "locked": true },
    { "name": "text", "color": "#6b7280" }
  ],
  "candidates": ["#0f172a", "#1f2937", "#ffffff"],
  "constraints": [
    { "foreground": "text", "background": "bg", "minContrast": 4.5 }
  ],
  "profiles": ["normal", "deuteranopia"]
}
```

- 颜色支持 `#rgb` 或 `#rrggbb`（不区分大小写）；
- 每个令牌的取值域 = 原色 + 全部候选色（自动去重）；
- `locked: true` 或在页面勾选锁定的令牌只能保留原色；
- `minContrast` 为 WCAG 对比度（1–21）。常用阈值：普通文本 **4.5**、大号文本/UI **3**、
  严格文本 **7**；
- `profiles` 可选，取值 `normal` / `protanopia` / `deuteranopia` / `tritanopia`；
  **未提供时等同 `["normal"]`**；重复值自动去重，未知值、空数组或非数组形式都会被拒绝；

| 项目 | 上限 |
| --- | --- |
| 令牌数 | **10** |
| 候选色数 | **12** |
| 约束条数 | **30** |

超出上限或格式有误时，页面与接口都会返回明确的错误信息。

## 色觉鲁棒模式（profiles）

`profiles` 声明一组色觉视型，求解器会模拟每种视型下看到的颜色，并要求
**每条约束在全部所选视型下都达到 `minContrast`**，才进入最少改色、最小总色差与稳定决胜。
缺省等同 `["normal"]`（即不做模拟，行为与旧版一致）。

每个视型的模拟管线固定为四步：**sRGB 线性化 → 矩阵变换 → 裁剪到 [0,1] → 重新编码为 sRGB**，
随后按常规 WCAG 公式计算对比度。模拟矩阵取自 Machado, Oliveira & Fernandes (2009)
的 100% 严重度模型，作用于线性化 sRGB 分量，固定取值如下（与 `src/color.js` 中
`CVD_MATRICES` 一致）：

```
protanopia（红色盲）:        deuteranopia（绿色盲）:       tritanopia（蓝色盲）:
0.152286  1.052583  -0.204868   0.367322  0.860646  -0.227968   1.255528  -0.076749  -0.178779
0.114503  0.786281   0.099216   0.280085  0.672501   0.047413  -0.078411   0.930809   0.147602
-0.003882 -0.048116  1.051998  -0.011820  0.042940   0.968881   0.004733   0.691367   0.303900
```

`normal` 为恒等（不做矩阵变换）。求解结果中每条约束都会按视型列出改前/改后比值，
并标注改后对比度最差的视型（`worstAfterProfile`）；锁定冲突会通过 `failedProfiles`
与消息文本说明具体失败的视型。

## 示例数据

仓库内置示例 [`examples/sample-palette.json`](examples/sample-palette.json)
（运行后点击页面「载入示例」即可）。示例包含 8 个令牌、12 个候选色、7 条约束，
其中背景 `bg` 与 `surface` 已锁定。求解结果为：

- 只改 **2** 个令牌：`primaryText #1d4ed8 → #f8fafc`（按钮文字改为浅色）、
  `danger #f87171 → #b91c1c`（错误红加深至 6.18:1）；
- CIE Lab 总色差 ΔE\*ab = **131.64**；
- 注意 `danger` 最终选 `#b91c1c` 而不是肉眼“看起来更近”的 `#dc2626`，
  因为在 CIE Lab 空间中前者的 ΔE（30.35）略小于后者（30.91）。

部分约束的改前/改后比值：

| 约束 | 要求 | 改前 | 改后 |
| --- | --- | --- | --- |
| primaryText / primary | 4.5 | 1.30:1 ❌ | 4.94:1 ✅ |
| danger / bg | 4.5 | 2.64:1 ❌ | 6.18:1 ✅ |
| textPrimary / bg | 7 | 14.03:1 ✅ | 14.03:1 ✅ |

### 无解锁冲突示例

将示例中的 `primary` 也锁定（保持 `#2563eb`）、同时锁定 `primaryText` 为 `#1d4ed8`，
会得到无解，页面直接列出：

> 约束 #5（primaryText / primary）两端均被锁定：在 normal 视型下对比度为 1.3，小于要求的 4.5

## HTTP 接口（可选）

- `POST /api/solve`：请求体 `{ "payload": <输入JSON>, "locks": { "令牌名": true } }`，
  `payload` 即上文的输入格式（可含 `profiles`）。返回最优方案、每条约束的改前/改后明细与导出用 JSON：
  - 响应顶层 `profiles` 为实际生效的视型列表（去重、按固定顺序排列）；
  - `report.constraints[i].profiles` 按视型列出 `beforeRatio` / `afterRatio` 与是否达标，
    同条约束另含 `worstBeforeProfile` / `worstAfterProfile`（各视型中比值最小者），
    顶层 `beforeRatio` / `afterRatio` 即最差视型的数值，`beforePass` / `afterPass`
    表示“全部所选视型”是否达标；
  - 无解冲突 `conflicts[i].failedProfiles` 列出具体失败的视型；
- `GET /api/health`：健康检查。

## 无 Docker 时的本地开发方式（可选）

需要 Node.js ≥ 18：

```bash
npm install
npm start
```

## 项目结构

```
Dockerfile              # 多阶段构建，构建期自动准备依赖
compose.yaml            # docker compose up --build 即启动
src/color.js            # sRGB/WCAG 亮度、对比度、CIE Lab 色差与色觉缺陷模拟矩阵
src/solver.js           # 输入校验 + 分支定界搜索 + 锁定冲突诊断
src/server.js           # Express 服务与 /api/solve
public/                 # 原生前端（HTML/CSS/JS）
examples/               # 示例数据
scripts/                # 求解器测试与样例验证脚本
```

## 隐私

页面不会向任何第三方发送数据；JSON 仅在浏览器与本机 `localhost:3000` 服务之间传递，
求解在进程内存中完成，不写磁盘、不做持久化。
