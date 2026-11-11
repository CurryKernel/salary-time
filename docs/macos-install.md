# macOS 安装教程：从源码到「应用程序」

适用于：使用 Mac，想自己拉取 `salary-time` 源码并安装「工资实时统计」的用户。

首次安装大约需要 5–10 分钟，主要时间花在下载 Electron 和依赖上。安装完成后，以后从「启动台」或 Spotlight 直接打开即可，不需要再进终端。

---

## 0. 准备工作

### 0.1 确认 Mac 芯片

点击屏幕左上角  →「关于本机」→ 查看「芯片」：

- **Apple M1 / M2 / M3 / M4 …**：属于 Apple Silicon，下文默认按 `arm64` 构建。
- **Intel**：下文第 3 步需要使用 `--x64` 命令。

### 0.2 安装 Node.js 与 Git

打开「终端」（Spotlight 搜索 `Terminal`），执行：

```bash
node -v
npm -v
git --version
```

- `node -v` 建议为 **v20 或更高版本**（推荐 Node.js 22 LTS）。
- 如果没有 Node.js：到 <https://nodejs.org/zh-cn/download> 下载 LTS 安装包，双击安装；或使用 Homebrew：

  ```bash
  brew install node
  ```

- 如果 `git` 不可用，执行下面的命令安装命令行工具（按提示点「安装」）：

  ```bash
  xcode-select --install
  ```

---

## 1. 拉取代码

```bash
git clone https://gitcode.com/CurryKernel/salary-time.git
cd salary-time
```

如果你已经配置过 GitCode 的 SSH key，也可以使用：

```bash
git clone git@gitcode.com:CurryKernel/salary-time.git
cd salary-time
```

---

## 2. 安装依赖

```bash
npm install
```

> 国内网络下载 Electron 可能较慢。如果卡住或失败，先设置镜像再重试：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install
```

---

## 3. 构建 macOS 应用

### Apple Silicon（M 系列芯片）

```bash
npm run dist:mac
```

### Intel 芯片

```bash
npx electron-builder --mac --x64
```

构建过程中出现跳过代码签名（`skipped macOS application code signing`）的提示是正常的——本应用没有购买 Apple 开发者证书，不影响本机使用。

构建完成后，`dist/` 目录下会生成（文件名以实际输出为准）：

```text
dist/SalaryTime-1.0.0-arm64.dmg
dist/mac-arm64/SalaryTime.app
```

---

## 4. 安装到「应用程序」

### 方式 A：图形界面（推荐给不熟悉终端的用户）

```bash
open dist
```

在打开的 Finder 窗口里：

1. 双击 `SalaryTime-1.0.0-arm64.dmg`；
2. 把窗口里的 **SalaryTime** 拖进「应用程序」文件夹；
3. 在「启动台」或 Spotlight 中搜索 **SalaryTime** 打开。

### 方式 B：一条命令安装

Apple Silicon：

```bash
ditto dist/mac-arm64/SalaryTime.app /Applications/SalaryTime.app
open /Applications/SalaryTime.app
```

Intel 的 `.app` 路径通常是 `dist/mac/SalaryTime.app`，把上面的路径替换即可。

如果提示没有写入权限，在命令前加 `sudo`，输入开机密码：

```bash
sudo ditto dist/mac-arm64/SalaryTime.app /Applications/SalaryTime.app
```

---

## 5. 第一次打开

- 打开后，悬浮窗会出现在屏幕右下角。
- **程序不会显示 Dock 图标**，这是刻意设计；屏幕右上角菜单栏会出现一个 **¥** 图标，点它可以显示 / 隐藏悬浮窗，右键可以退出。
- 如果 macOS 提示「无法验证开发者」或「无法打开」：
  1. 在「应用程序」里 **右键 App → 打开 → 再点「打开」**；
  2. 或到「系统设置 → 隐私与安全性」，在页面下方点击「仍要打开」。
- 如果是从网络下载的安装包，少数情况下会提示「文件已损坏」，可以执行：

  ```bash
  xattr -dr com.apple.quarantine /Applications/SalaryTime.app
  ```

  然后重新打开。自己本地构建的 App 一般不会触发这个提示。

---

## 6. 日常使用

| 操作 | 说明 |
| --- | --- |
| 拖动标题栏 | 移动悬浮窗，位置自动记住 |
| 图钉按钮 | 切换始终置顶 |
| 齿轮按钮 | 打开设置：基础工资、绩效工资、计薪方式、上下班时间 |
| 减号按钮 | 隐藏到菜单栏托盘 |
| × 按钮 | 退出应用 |
| `Esc` | 从设置返回主界面 |
| `⌘ + Q` | 退出应用 |

- 在设置里勾选「按当月实际工作日计算」，可以按当月真实工作日摊算每天工资，并查看本月、本周已累计收入。
- 勾选「开机自启动」后，登录 Mac 会自动出现悬浮窗。
- 配置保存在 `~/Library/Application Support/SalaryTime/settings.json`。

---

## 7. 只想临时运行，不安装

如果不想安装到「应用程序」，直接在项目目录执行：

```bash
npm start
```

关闭时点悬浮窗右上角的 **×** 即可。

---

## 8. 常见问题

| 问题 | 解决办法 |
| --- | --- |
| `npm install` 很慢 / 下载 Electron 失败 | 按第 2 步设置 `ELECTRON_MIRROR` 镜像后重试 |
| 打包时下载 NSIS / 7-Zip 失败 | 设置第 2 步的 `ELECTRON_BUILDER_BINARIES_MIRROR` 后重试 |
| `node: command not found` | 安装 Node.js LTS，安装后重新打开终端 |
| `xcrun: error` / 构建失败提示缺少编译工具 | 执行 `xcode-select --install` |
| Intel Mac 打不开 arm64 的 DMG | 使用第 3 步的 Intel 命令自行构建 x64 版本 |
| Apple Silicon 打不开 x64 版本 | 重新按 `npm run dist:mac` 构建 arm64 版本 |
| 提示代码签名被跳过 | 正常现象，本机使用不受影响 |
| 找不到 App / 没有 Dock 图标 | Spotlight 搜索 `SalaryTime`；或点菜单栏 ¥ 图标 |
| 想卸载 | 退出 App 后删除 `/Applications/SalaryTime.app`；如需清空配置，再删除 `~/Library/Application Support/SalaryTime` |

---

## 9. 一分钟速通版

已经装好 Node.js 的话，复制下面命令即可：

```bash
git clone https://gitcode.com/CurryKernel/salary-time.git
cd salary-time
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install
npm run dist:mac
ditto dist/mac-arm64/SalaryTime.app /Applications/SalaryTime.app
open /Applications/SalaryTime.app
```

Intel 芯片把最后三行中的 `npm run dist:mac` 换成 `npx electron-builder --mac --x64`，并把 `.app` 路径换成 `dist/mac/SalaryTime.app`。
