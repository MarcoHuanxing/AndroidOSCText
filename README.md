# AndroidOSCText

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

装 `android-app/build/outputs/apk/debug/app-debug.apk`，打开后填：

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

## License

MIT
