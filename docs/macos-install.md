# macOS 安装教程：拉代码 → 双击安装 → 像普通 App 一样使用

适用于：使用 Mac，想自己拉取 `salary-time` 源码并安装「工资实时统计」的用户。

安装完成后，悬浮窗会安装在「应用程序」里，之后从「启动台」或 Spotlight 搜索 **工资实时统计** 就能打开，不需要再进终端。

---

## 0. 准备工作

确认终端可用，并安装 Node.js 与 Git：

```bash
node -v
npm -v
git --version
```

- Node.js 建议 **v20 或更高**（推荐 22 LTS）。没有的话到 <https://nodejs.org/zh-cn/download> 下载 LTS 安装包。
- 如果 `git` 不可用，执行下面的命令并点「安装」：

  ```bash
  xcode-select --install
  ```

Apple Silicon（M 系列）和 Intel 芯片都可以用下面同一条命令，安装器会自动使用当前机器对应的 Electron 运行时。

---

## 1. 拉取代码

```bash
git clone https://gitcode.com/CurryKernel/salary-time.git
cd salary-time
```

已配置 SSH 的话也可以用：

```bash
git clone git@gitcode.com:CurryKernel/salary-time.git
cd salary-time
```

---

## 2. 安装依赖

```bash
npm install
```

国内网络下载 Electron 慢的话，先设置镜像再重试：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install
```

---

## 3. 一键安装到「应用程序」

```bash
npm run install:mac
```

看到类似下面的输出就成功了：

```text
✅ 已安装：/Applications/工资实时统计.app
   以后在「启动台」或 Spotlight 中搜索「工资实时统计」即可打开。
```

这一步做了什么：

- 生成一个 macOS 启动器 `工资实时统计.app`；
- 安装到 `/Applications`（没有写入权限时自动装到 `~/Applications`）；
- 启动器会调用 Electron **官方签名的运行时** 来加载本项目，因此不需要 Apple 开发者账号，也不需要处理未签名应用被系统拦截的问题；
- 以后双击启动器即可，关闭用悬浮窗右上角的 **×**。

> 安装器引用的是当前项目目录。如果之后移动或删除了 `salary-time` 文件夹，需要在新位置重新执行一次 `npm run install:mac`。

---

## 4. 打开应用

在「启动台」或 Spotlight（`⌘ + 空格`）里搜索 **工资实时统计** 打开。

- 悬浮窗默认出现在屏幕右下角；拖动标题栏可以移动。
- 程序不占用 Dock；菜单栏右侧会出现 **¥** 图标，点它可以显示 / 隐藏。
- 关闭：点悬浮窗右上角 **×**；下次从启动器重新打开即可。
- 如果应用已经在运行，再次点击启动器会把已有窗口调出来，不会重复开启。

首次使用可以在设置里填写工资、上下班时间，勾选「按当月实际工作日计算」等。设置自动保存。

---

## 4.1 开机自启（可选）

启动器版本的设置面板里不会显示「开机自启动」选项，请在系统里添加：

「系统设置」→「通用」→「登录项」→ 点 **+** → 选择「应用程序」里的 **工资实时统计.app**。

之后登录 Mac 就会自动出现悬浮窗。

---

## 5. 日常使用速查

| 操作 | 说明 |
| --- | --- |
| 拖动标题栏 | 移动悬浮窗，位置自动记住 |
| 图钉 | 始终置顶 |
| 齿轮 | 设置基础工资、绩效、计薪方式、上下班时间 |
| 减号 | 隐藏到菜单栏托盘 |
| × | 退出应用 |
| `⌘ + Q` | 退出应用 |
| 菜单栏 ¥ | 显示 / 隐藏 / 退出 |

---

## 6. 只想临时运行，不安装

```bash
cd salary-time
npm start
```

关闭时点右上角 **×**。这种方式需要保持终端窗口打开。

---

## 7. 常见问题

| 问题 | 解决办法 |
| --- | --- |
| `npm run install:mac` 提示找不到 Electron | 先执行 `npm install`，确认 `node_modules/electron` 存在 |
| 点击启动器没有反应 | `cat /tmp/salary-time.log` 查看日志；或重新执行 `npm run install:mac` |
| 提示「无法验证开发者」 | 在「应用程序」里右键 `工资实时统计.app` →「打开」；或在「系统设置 → 隐私与安全性」点「仍要打开」 |
| 应用被移动到别处 / 项目目录改名 | 在新目录重新执行 `npm run install:mac` |
| 想卸载 | 退出应用后删除 `/Applications/工资实时统计.app`；如需清空配置，再删除 `~/Library/Application Support/SalaryTime` |
| 想生成传统 DMG 安装包 | 执行 `npm run dist:mac`，但未签名 DMG 在部分 macOS 上会被 Gatekeeper 拦截，普通使用推荐上面的启动器方式 |

---

## 8. 一分钟速通版

已经装好 Node.js 的话：

```bash
git clone https://gitcode.com/CurryKernel/salary-time.git
cd salary-time
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install
npm run install:mac
```

然后从「启动台」或 Spotlight 打开 **工资实时统计**。
