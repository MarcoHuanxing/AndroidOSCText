# 打包成 Windows exe

> 把 PC 桥接打成一个双击就能跑的单文件 exe，发给室友不用装 Node.js。

## 一句话结论

在 `pc-bridge/` 下执行 `npm install` 然后 `npm run build:exe`，得到 **`dist/aost-bridge.exe`** —— 一个约 **89 MB** 的单文件（实测 88.7 MB，Node 24.19），内含 Node.js 运行时。对方拷过去双击就能用，不需要装 Node、不需要 `npm install`。

| 项目 | 值 |
|---|---|
| 产物 | `dist/aost-bridge.exe`（仓库根目录下的 `dist/`） |
| 体积 | 约 89 MB（实测 88.7 MB = 92,987,904 字节；绝大部分是 Node 运行时） |
| 目标机依赖 | 无。不装 Node、不装 npm、不用管理员权限 |
| 首次运行 | 在 exe 同目录生成 `config.json`（含随机令牌），终端打印本机名 / OSC 目标 / HTTP 监听 / 局域网地址 / 令牌 |
| 技术路线 | Node.js SEA（`--experimental-sea-config`）+ `postject` 注入 blob |
| 版本 | 0.2.0 |
| 平台 | Windows x64 |

---

## 为什么选 Node SEA

候选方案的取舍（结论不是抄来的，是权衡出来的）：

| 方案 | 体积 | 做法 | 问题 |
|---|---|---|---|
| **Node.js SEA（采用）** | ~89 MB | 官方 `--experimental-sea-config` 生成 blob，`postject` 注入到拷贝出来的 `node.exe` | 体积大；SEA 仍是实验特性；只能同平台构建 |
| 让用户自己装 Node | 0 | 就是现在的「方式 B」：`npm start` | 对「发给室友」这件事直接劝退 —— 装 Node、开终端、cd 目录、npm install，每一步都能卡住人 |
| `pkg`（vercel/pkg） | ~40 MB | 把 JS 打进 Node 变体 | 项目**已停止维护**，对较新 Node 的语法/API 支持滞后 |
| `nexe` | ~35 MB | 自己编译一份 Node 再嵌入 | 需要维护一份自行编译的 Node 产物，构建机要装全套编译工具链，跟随 Node 升级的成本高 |
| Electron | ~150 MB 起 | 塞一个 Chromium | 我们只要一个 HTTP 服务和 UDP 发包，不需要浏览器引擎；启动慢、内存高、还要管渲染进程 |

选 SEA 的核心理由不是「体积小」（它恰恰最大），而是 **它是官方路线**：Node 24 自带 SEA，不依赖第三方维护一个 Node 分支。`pkg` / `nexe` 的通病是「跟随 Node 版本」要等第三方跟进 —— `pkg` 已经停更，这条路会走死。

> **Node 24 的一个坑**：网上有些文章提到 `node --build-sea`，那是更新版本才有的便捷参数，**Node 24 没有**。所以构建走的是经典两步：先用 `--experimental-sea-config` 生成 blob，再用 `postject` 把 blob 注入到拷贝出的 `node.exe` 里。

---

## 为什么是 ~89 MB，值不值

拆开看体积：

| 部分 | 大致体积 | 能不能省 |
|---|---|---|
| Node 运行时（`node.exe` 本体） | 约 88.5 MB | 省不掉。这就是「不用装 Node」的实际代价 —— 你在替对方把 Node 装进去 |
| 桥接代码 + SEA blob | 几十 KB 到几百 KB | 忽略不计。本项目运行时零依赖，本来就是很小的东西 |

所以体积完全由「要不要自带运行时」决定，没有调优空间。**值不值取决于分发给谁**：

| 对象 | 结论 |
|---|---|
| 不会折腾的人（室友、只想打字聊天的 VRChat 玩家） | **值**。89 MB 用微信/U 盘发一次，换掉「装 Node 装到一半放弃」 |
| 只有你自己用 | **不值**。直接 `npm start` 更省事，改代码也不用重新打包（见 README「方式 B」） |

局域网内传输 89 MB 很快，所以没有做「增量更新」之类的东西 —— 收益不抵复杂度。

---

## 构建

### 前置条件

| 要求 | 说明 |
|---|---|
| 操作系统 | **Windows x64**（SEA 不能跨平台构建，见「限制」） |
| Node.js | **≥ 20，推荐 24**。构建脚本会检查主版本号，太低直接报错（SEA 的行为在不同版本间不一致） |
| npm | 随 Node 附带 |
| 网络 | `npm install` 要拉一个 `postject`（**只在构建期用，不会进产物**） |

### 步骤

```powershell
cd pc-bridge
npm install
npm run build:exe
```

`npm install` 只是为了拿到注入工具 `postject`。桥接运行时本身仍然零依赖，这一点没变。

构建脚本（在 `pc-bridge/scripts/` 下）大致做这些事：

1. 把 `src/` 合成 SEA 能吃的**单个** CommonJS 入口 —— SEA 的 blob 只接受一个 `main` 文件，它不会在运行期自己去读散装的 `require('./server')`
2. 用 `--experimental-sea-config` 生成 blob
3. 拷贝一份**构建机上当前这个 Node** 的 `node.exe`
   （对应的 npm 脚本：`build:bundle` 只做到第 1 步，`build:exe` 是完整流程）
4. 用 `postject` 把 blob 以 `NODE_SEA_BLOB` 资源注入，靠 sentinel fuse 定位注入点
5. 原子改名为仓库根的 `dist/aost-bridge.exe`，并跑一次 `--version` 自检（构建脚本自己会验一遍，省得你拿到一个坏的）

> blob 名、fuse 字符串这些二进制细节由脚本固定，不需要手动敲。

### 产物在哪

```
AndroidOSCText/
└── dist/
    └── aost-bridge.exe      ← 要分发的东西
```

---

## 验证

拿到 exe 后按顺序验三件事，**三件都过才算可用**（窗口弹出来一下不算）：

### 1. 版本对不对

```powershell
.\aost-bridge.exe --version
```

应打印 `0.2.0`。`--help` 会打印用法、三个参数和**配置文件查找顺序**（排查「配置到底读的哪个文件」时很有用）。

### 2. 能不能启动

双击（或从命令行运行）。应看到横幅：

| 横幅行 | 为什么值得看一眼 |
|---|---|
| 版本 / 运行方式 | 运行方式应显示 `单文件 exe（免安装 Node）`。如果显示的是 `源码 (node src/index.js)`，说明你跑的不是打包好的 exe |
| 本机名 | 对应 `discovery` 应答里的主机名，手机上认机器用 |
| OSC 目标 / HTTP 监听 | 端口对不对（默认 `127.0.0.1:9000` / `0.0.0.0:7712`） |
| 配置文件 | 这次读的是哪个 `config.json`。exe 方式下应是 exe 同目录的那个 |
| 局域网地址 | 手机要填的那个 IP。没有这一行见「排错」 |
| 访问令牌 | 手机端首次连接要填 |

另外启动时还会打印一行 `[discovery] 正在监听 UDP 7713`，说明自动发现也在工作。

### 3. HTTP 通不通

```bash
curl http://127.0.0.1:7712/api/health
```

应返回 `{"ok":true,...}`，含 `osc` 目标和运行时统计。这个端点**不需要令牌**，适合用来判断「服务活着没」。

> PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，行为不一样。要发原始请求请用 `curl.exe`。

---

## 分发

**只需要发一个文件：`aost-bridge.exe`。** 配置在首次运行时自己生成。

### 首次运行发生了什么

- 在 exe 同目录生成 `config.json`，其中 `token` 是一串随机生成的令牌（32 位十六进制）
- 终端横幅打印：本机名 / OSC 目标 / HTTP 监听 / 配置文件路径 / 局域网地址 / 访问令牌
- 这台机器从此固定用这个令牌，重启不变

因此「首次运行」这一步**必须在对方机器上做一次**，不能替他先跑好再发。而且 exe 所在目录要有写权限（别放 `C:\Program Files`）。

### 令牌怎么带走 / 怎么重置

令牌跟着 `config.json` 走，不跟着 exe 走：

| 场景 | 做法 |
|---|---|
| 换目录 / 换电脑，**想沿用**原令牌（手机端不用改） | 把 `config.json` 和 exe 一起拷过去 |
| 换电脑，**不想带配置** | 只拷 exe，让对方首次运行生成新令牌，再把新令牌填进手机 |
| 令牌疑似泄露 | 删掉 `config.json` 重启，会生成新令牌（手机端要跟着改） |
| 不想让令牌落到文件里 | 用 `AOST_TOKEN` 环境变量覆盖（见下表） |

> `config.json` 是**明文**存令牌的。别提交进 git，也别随手发到群里。

---

## 配置与环境变量

`config.json` 的完整字段说明见 [部署与排错](setup-troubleshooting.md) 的「配置项说明」一节。环境变量优先级**高于** `config.json`：

| 变量 | 作用 | 默认值 |
|---|---|---|
| `AOST_PORT` | HTTP 监听端口（手机连的就是它） | `7712` |
| `AOST_OSC_HOST` | OSC 目标地址（VRChat 所在机器） | `127.0.0.1` |
| `AOST_OSC_PORT` | OSC 目标 UDP 端口 | `9000` |
| `AOST_TOKEN` | 访问令牌，覆盖 `config.json` 里的值 | 首次运行随机生成 |
| `AOST_CONFIG` | 指定 `config.json` 的路径（绝对路径，或相对当前工作目录），放别处、或一台机器跑多份配置时用 | exe 同目录的 `config.json`（源码运行时是 `pc-bridge/config.json`） |

PowerShell 里临时覆盖的例子：

```powershell
$env:AOST_PORT = 7800
.\aost-bridge.exe
```

> 这样设的环境变量只在当前终端会话有效。要长期生效，改 `config.json` 或去系统环境变量里设。

---

## 端口与防火墙

exe 方式下需要关心的三个端口：

| 端口 | 协议 | 方向 | 用途 | 怎么改 |
|---|---|---|---|---|
| `7712` | TCP | 入站 | 手机 → 桥接 HTTP | `AOST_PORT` 或 `config.json` 的 `httpPort` |
| `7713` | UDP | 入站（广播） | 手机自动发现 PC | `config.json` 里 `enableDiscovery: false` 关掉 |
| `9000` | UDP | **出站** | 桥接 → VRChat OSC | `AOST_OSC_PORT` 或 `oscPort` |

Windows 防火墙只需要放行**入站 7712（TCP）** 和 **7713（UDP）**；9000 是往外发的，不用开。

首次运行时 Windows 会弹窗问是否允许联网 —— **弹窗里的程序名会是 `aost-bridge.exe`**（不是 `node.exe`），这是 exe 方式与源码方式在防火墙层面的唯一差别。当时点了「取消」的话，以管理员身份补一条规则：

```powershell
New-NetFirewallRule -DisplayName "AndroidOSCText Bridge" -Direction Inbound -LocalPort 7712 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "AndroidOSCText Bridge Discovery" -Direction Inbound -LocalPort 7713 -Protocol UDP -Action Allow
```

> 改了 `AOST_PORT` 之后记得把规则里的端口一起改，否则放行的不是你实际用的端口。

---

## 未签名 exe 的现实

这个 exe **没有代码签名**（签名证书要花钱，个人项目没买）。后果说清楚，不粉饰：

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 首次运行弹「Windows 已保护你的电脑 / 未知发布者」 | SmartScreen 对「从网上下载的可执行文件」没有信誉记录 | 点「更多信息」→「仍要运行」。这一步通常只出现一次 |
| 文件属性里发布者一栏是空的 | 同上，没有签名 | 只能自己接受，或者去买证书重签 |
| 杀软报可疑 / 木马 | 打包产物本质是「被改过的 `node.exe`」（postject 往 PE 里塞了资源），这种形态在启发式扫描里天然不讨喜 | 大概率是误报：可以上传样本给厂商报误报、给目录加排除项，或者干脆不给这个人发 exe、改用源码方式 |
| 从 U 盘 / 微信传到对方机器被标记「有风险」 | 同上，加上没有云信誉积累 | 同上 |

**不吹的部分**：我无法保证某些杀软不误报，也无法保证 SmartScreen 只拦一次。如果分发对象对「未知发布者」很敏感，最稳的是教他用源码方式（README「方式 B」），或者你自己买一张代码签名证书重新签。

> 同理：别从不明来源下载别人打好的 `aost-bridge.exe`。自己构建一遍的成本只有两条命令。

---

## 限制

| 限制 | 说明 |
|---|---|
| **只能在 Windows 上构建 Windows exe** | SEA 不是交叉编译工具 —— 它拿的是**构建机上那个 `node.exe`** 来注入。想在 Linux/macOS 上产出 Windows exe 得另外准备一份 Windows 版 `node.exe`，本项目没做 |
| **exe 里的 Node 版本 = 构建机上的 Node 版本** | 用 Node 24 构建，exe 内就是 Node 24。升级运行时的唯一方式是「用新 Node 重新构建一遍」 |
| **只出 x64** | 架构跟着构建机的 Node 走。ARM64 Windows 需要在 ARM64 机器上用 ARM64 Node 构建 |
| **SEA 仍是实验特性** | 参数名里就写着 `experimental`。Node 大版本升级时行为可能变，构建脚本要跟着调 |
| **体积不会变小** | 见「为什么是 ~89 MB」 |
| **没有自动更新** | 发出去的就是那一份。改了代码要重新构建、重新发 |

---

## 排错

| 现象 | 可能原因 | 处理 |
|---|---|---|
| **双击闪一下就没了** | 控制台程序崩溃时窗口会立刻关掉，错误信息跟着消失 | 别双击，改用命令行跑：`.\aost-bridge.exe`，错误会留在窗口里；或 `.\aost-bridge.exe > out.txt 2>&1` 再看 `out.txt`。最常见原因是端口被占或 `config.json` 被改坏 |
| 同上，日志里是 `EADDRINUSE` | 7712 被别的进程占了（比如已经开着一份） | `netstat -ano \| findstr :7712` 找到占用者并关掉，或用 `$env:AOST_PORT = 7800` 换端口 |
| `config.json is not valid JSON` | 手动编辑弄坏了 | 删掉 `config.json` 重启，会自动重建（令牌会变，手机端要更新） |
| 手机一直 401 | 令牌不对 | 令牌在启动横幅和 exe 同目录的 `config.json` 的 `token` 字段里；复制时别多带空格 |
| 手机连不上，但 PC 自己 curl 得通 | 防火墙没放行 / 宿舍 Wi-Fi 开了客户端隔离 / 手机里填了 `127.0.0.1` 或虚拟网卡 IP | 先按「端口与防火墙」放行，再用手机浏览器打开 `http://<PC 的局域网 IP>:7712` 验证；宿舍网隔离就改用手机热点 |
| 横幅里没有局域网地址 | 只连了虚拟网卡，或者根本没连网 | 连上正常 Wi-Fi 或手机热点再看 |
| 构建时注入失败 / `postject` 报错 | `npm install` 没装好，或 `node.exe` 与注入参数不匹配 | 删掉 `node_modules` 重跑 `npm install`，确认 Node 是 24；构建脚本会指出是哪一步失败 |
| 构建时报不认识 `--experimental-sea-config` | Node 太老 | 升到 Node 20+（推荐 24） |
| `npm install` 拉不到 `postject` | 网络 / 代理 | 换 npm 镜像重试。这一步失败**不影响**源码方式运行（`npm start` 不需要它） |

---

相关文档：[架构说明](architecture.md) · [部署与排错](setup-troubleshooting.md)
