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
- **全局分支定界搜索**（branch and bound），在满足全部 WCAG 对比度约束的方案中，按以下顺序优化：
  1. **改色令牌数最少**；
  2. **CIE Lab 总色差最小**（ΔE\*ab / CIE76，D65 白点）；
  3. 稳定决胜：按令牌名升序、以色值字典序最小者为准（相同输入永远得到相同结果）；
- 页面展示每条约束的**改前 / 改后对比度比值**与是否达标；
- **无解时列出锁定颜色直接造成的冲突**（两端锁定不达标、单侧锁定导致对端无可用颜色、自反约束等）；
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
  ]
}
```

- 颜色支持 `#rgb` 或 `#rrggbb`（不区分大小写）；
- 每个令牌的取值域 = 原色 + 全部候选色（自动去重）；
- `locked: true` 或在页面勾选锁定的令牌只能保留原色；
- `minContrast` 为 WCAG 对比度（1–21）。常用阈值：普通文本 **4.5**、大号文本/UI **3**、
  严格文本 **7**；

| 项目 | 上限 |
| --- | --- |
| 令牌数 | **10** |
| 候选色数 | **12** |
| 约束条数 | **30** |

超出上限或格式有误时，页面与接口都会返回明确的错误信息。

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

> 约束 #5（primaryText / primary）两端均被锁定：当前对比度 1.3 小于要求的 4.5

## HTTP 接口（可选）

- `POST /api/solve`：请求体 `{ "payload": <输入JSON>, "locks": { "令牌名": true } }`，
  返回最优方案、每条约束改前/改后比值与导出用 JSON；
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
src/color.js            # sRGB/WCAG 亮度、对比度与 CIE Lab 色差
src/solver.js           # 输入校验 + 分支定界搜索 + 锁定冲突诊断
src/server.js           # Express 服务与 /api/solve
public/                 # 原生前端（HTML/CSS/JS）
examples/               # 示例数据
scripts/                # 求解器测试与样例验证脚本
```

## 隐私

页面不会向任何第三方发送数据；JSON 仅在浏览器与本机 `localhost:3000` 服务之间传递，
求解在进程内存中完成，不写磁盘、不做持久化。
