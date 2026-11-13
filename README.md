# AndroidOSCText

#SBAI瞎JB推

**用手机键盘打字，让文字出现在 VRChat 的 Chatbox 上。**

宿舍里不方便说话？不用买麦克风，不用装 SAPI，掏出手机打字就行 —— 文字会实时显示在你头顶的 Chatbox 里，对面的人直接看得到。

```
┌──────────┐   局域网 HTTP    ┌────────────┐   OSC / UDP    ┌──────────┐
│  Android │ ───────────────► │  PC 桥接    │ ─────────────► │  VRChat  │
│  手机 App │   (Wi-Fi)        │  Node.js   │   :9000        │ Chatbox  │
└──────────┘                  └────────────┘                └──────────┘
```

---

## 为什么是这套架构

VRChat 的 OSC 监听在 **PC 本机** 的 UDP 9000 端口，手机没法直接发 OSC 过去（UDP 跨设备受路由器/防火墙影响大，且 VRChat 只监听本机）。所以中间放一个 PC 端桥接：

| 方案 | 可行性 | 采用 |
|---|---|---|
| 手机直接发 OSC 到 PC:9000 | OSC 是 UDP 单发，没有确认；防火墙 + VRChat 只绑 `0.0.0.0` 但 OSCQuery 只通告 loopback | ✗ |
| **手机 HTTP → PC 桥接 → OSC** | HTTP 可确认送达、可鉴权、可限流、能跨 Wi-Fi | ✓ |
| 走云端中转 | 宿舍断网、延迟高、隐私差 | ✗ |

HTTP 这一层还带来几个实际好处：

- **送达确认**：手机能看到"已发送"，而不是盲发 UDP 后不确定
- **鉴权**：宿舍局域网谁都能连，没有令牌别人就能往你 Chatbox 上打字
- **限流**：VRChat 对 chatbox 有频率限制，桥接层统一限速，避免被服务端吞消息
- **归一化**：144 字符 / 9 行的规则在服务端统一处理，客户端不用重复实现

---

## 快速开始

### 1. PC 端（需要 Node.js ≥ 18）

```bash
cd pc-bridge
npm start
```

首次启动会自动生成 `config.json`（含随机访问令牌）。启动后终端会打印：

```
================================================================
  AndroidOSCText  ·  手机 -> VRChat Chatbox 桥接
================================================================
  OSC 目标    : 127.0.0.1:9000  (VRChat)
  HTTP 监听   : 0.0.0.0:7712

  手机请访问以下任一地址：
    http://192.168.1.57:7712    [以太网]

  访问令牌    : 9d3d034122b5d63e39b99e80d68b93de
================================================================
```

### 2. VRChat 端

VRChat 启动时会自动开启 OSC（UDP 9000）。不需要额外安装任何东西。

> 验证方式：`netstat -ano | findstr :9000` 应能看到 VRChat 进程在监听 UDP 9000。

### 3. 手机端

装 `android-app/build/outputs/apk/debug/app-debug.apk`，打开后点右上角齿轮展开连接设置。

**方式一：自动发现（推荐）**

点「自动发现 PC」，App 会广播 UDP 7713 搜同一局域网里的桥接，找到后自动填好 IP 和端口，再补令牌即可。

> IP 经常变（DHCP 重新分配、换 Wi-Fi），自动发现省得每次重填。

**方式二：手动填**

- **PC 局域网 IP**：启动窗口里打印的那个（如 `192.168.1.57`）
- **端口**：`7712`
- **访问令牌**：启动窗口里打印的那串

点"连接"，看到"已连接"就可以了 —— 之后打字点发送，VRChat 里立刻出现。

> 也可以直接用手机浏览器打开 `http://192.168.1.57:7712`，效果完全一样，不用装 App。

---

## 项目结构

```
AndroidOSCText/
├── pc-bridge/                  PC 端桥接（Node.js，零运行时依赖）
│   ├── src/
│   │   ├── osc.js              OSC 1.0/1.1 编码器（手写，无依赖）
│   │   ├── chatbox.js          Chatbox 驱动器：归一化 + 限流 + typing
│   │   ├── server.js           HTTP API
│   │   ├── webui.js            浏览器兜底界面
│   │   ├── config.js           配置加载 / 局域网 IP 枚举 / 令牌生成
│   │   └── index.js            入口
│   └── test/                   单元测试 + E2E 测试
├── android-app/                Android 客户端（Kotlin）
│   └── app/src/main/java/com/aost/bridge/
│       ├── BridgeClient.kt     HTTP 客户端
│       ├── MainActivity.kt     单屏界面
│       └── Prefs.kt            连接设置持久化
└── docs/                       架构说明 / 部署排错
```

---

## HTTP API

所有写操作需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（无需鉴权） |
| GET | `/api/info` | 局域网地址、限制参数（无需鉴权） |
| POST | `/api/say` | `{"text": "...", "sfx": true}` 发送到 chatbox |
| POST | `/api/typing` | `{"on": true}` 切换输入指示器 |
| GET | `/api/history` | 最近 50 条发送记录 |
| GET | `/` | 内置网页版界面 |

```bash
curl -X POST http://192.168.1.57:7712/api/say \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"宿舍不方便说话，打字交流","sfx":false}'
```

---

## 自动发现协议

手机不需要手输 IP，靠一个极简的 UDP 广播协议找到 PC：

```
手机                                     PC 桥接 (UDP 7713)
 │                                            │
 ├── { "aost": "AOST-DISCOVER" } ──────────► │
 │                                            │
 │ ◄── { "aost": "AOST-DISCOVER",             │
 │       "port": 7712,                        │
 │       "name": "AndroidOSCText bridge",     │
 │       "version": "0.1.0",                  │
 │       "requiresToken": true } ────────────┤
```

设计选择：

- **用 UDP 广播而非 mDNS/Bonjour** —— Android 的 `NsdManager` 需要多播锁，各家 ROM 行为不一致；裸 UDP 广播在所有平台都稳定
- **同时广播 `255.255.255.255` 和各网卡的定向广播地址** —— 不少路由器会过滤全局广播
- **应答里直接带 HTTP 端口** —— 省掉一次额外的查询往返

安全性：发现阶段不返回令牌。令牌只在之后 HTTP 请求的 `Authorization` 头里出现。

---
## OSC 协议细节

按 [VRChat 官方 wiki](https://wiki.vrchat.com/wiki/OSC#Chatbox)：

| 地址 | 类型标签 | 参数 |
|---|---|---|
| `/chatbox/input` | `,sTT` | 1. 文本（UTF-8，144 字符 / 9 行上限）<br>2. 是否立即发送（`true`）<br>3. 是否播放提示音 |
| `/chatbox/typing` | `,T` | 输入指示器可见性 |

**常见坑**：网络上很多示例写的是 `,sbb`（用 blob 传布尔）。这在旧版本可能能用，但当前 VRChat 的 OSCQuery 明确报告类型是 `sTT`。用 `T` / `F` 作为**无载荷类型标签**才是正确写法 —— 它们不占参数槽位。本项目通过 OSCQuery 实测确认，不是照抄博客。

---

## 测试

```bash
cd pc-bridge
npm test              # 17 个单元测试：OSC 编码、归一化、截断
node test/e2e.js      # 14 项 HTTP 端到端测试（需先 npm start）
```

E2E 覆盖：健康检查、局域网地址、令牌缺失/错误拒绝、UTF-8 原样保留、144 字符截断、9 行限制、空文本拒绝、typing、历史记录、404。

---

## 限制与已知问题

- **同一时间只有一个人能占用 9000 端口** —— 如果你同时用 VRCFaceTracking / SlimeVR 等，它们用的是 9001 回传，不冲突；但 PaperTracker 之类也绑 9000 的会抢占
- **宿舍网络若是隔离 AP**（客户端互相不可见），手机连不上 PC。此时可用热点模式：手机开热点，PC 连手机
- **Chatbox 只能显示最后一条**，且对所有人可见；不想公开的内容别发

## AI 声明

本项目在开发过程中大量使用了 AI 辅助，如实说明：

### 生成方式

**代码、文档、测试**主要由 AI 编程助手（DeepSeek Harness 上的 deepseek-v4.1-flash）生成，由项目所有者审阅、调试与决策。

AI 参与的部分：

- PC 端桥接全部源码（OSC 编解码器、chatbox 驱动、HTTP 服务、配置加载）
- Android 客户端全部源码（Kotlin Activity、HTTP 客户端、布局与资源）
- 单元测试、端到端测试用例
- 本 README 与 `docs/` 下的全部文档
- GitHub Actions 工作流

### 人工把关的部分

以下决策与验证由人完成，不是 AI 自行拍板：

- **架构选型**：为什么走 HTTP 中转而不用 UDP 直发
- **协议事实核验**：`/chatbox/input` 的类型标签究竟是 `,sTT` 还是 `,sbb` —— 通过查询本机 VRChat 的 OSCQuery 实测确认，没有采信网上流传的写法
- **代码审阅与验收**：每个文件在合入前都被读过，测试被实际执行过

### 关于正确性

AI 生成的代码可能包含错误。本项目做了以下保障：

| 保障 | 现状 |
|---|---|
| 单元测试 | 17 个，覆盖 OSC 字节布局、UTF-8 对齐、emoji 截断边界 |
| 端到端测试 | 14 项，真实 HTTP 打到你本机的桥接服务 |
| 协议依据 | 每个 OSC 地址都对照 VRChat 官方 wiki + OSCQuery 实测 |
| CI | GitHub Actions 在 Node 18/20/22 上跑测试 |

但这**不等于**经过生产环境验证。请按「自担风险」使用，重要场景先自己测一遍。

### 如果你要复用

- 代码是 MIT，随便用
- 但请同样保持诚实：如果你基于本项目继续用 AI 开发，建议保留这段声明
- 不要因为「AI 写的」就跳过测试 —— 测试恰恰是 AI 写代码时最该保留的部分

---

## License

MIT
