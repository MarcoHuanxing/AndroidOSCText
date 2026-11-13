# 架构说明

从 README 拆出来的部分：为什么这样搭、数据怎么流、目录怎么分、发现协议，以及几个关键取舍。

## 一句话架构

```
┌──────────┐   局域网 HTTP    ┌────────────┐   OSC / UDP    ┌──────────┐
│  Android │ ───────────────► │  PC 桥接    │ ─────────────► │  VRChat  │
│  手机 App │   (Wi-Fi)        │  Node.js   │   :9000        │ Chatbox  │
└──────────┘                  └────────────┘                └──────────┘
```

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

## 数据流

```
[手机输入]
    │  用户点"发送"
    ▼
POST /api/say  {"text":"...", "sfx":true}
    │  HTTP over Wi-Fi（可确认送达）
    ▼
[pc-bridge/src/server.js]
    │  ① 鉴权（Bearer token，timing-safe 比较）
    │  ② 解析 JSON，校验 text 非空
    ▼
[pc-bridge/src/chatbox.js  Chatbox.send()]
    │  ③ normalise()：CRLF→LF、剔除控制字符、TAB→4 空格
    │                  9 行截断、144 码点截断（按码点避免切坏 emoji）
    │  ④ 串行队列 + 最小间隔限流（默认 900ms）
    ▼
[pc-bridge/src/osc.js  build('/chatbox/input', 'sTT', [text, true, sfx])]
    │  ⑤ 手写 OSC 编码：地址串 / 类型标签串 / 载荷，全部 4 字节对齐
    ▼
UDP → 127.0.0.1:9000
    ▼
[VRChat] → Chatbox 显示
```

## 项目结构

```
AndroidOSCText/
├── pc-bridge/                  PC 端桥接（Node.js，零运行时依赖）
│   ├── src/
│   │   ├── osc.js              OSC 1.0/1.1 编码器（手写，无依赖）
│   │   ├── chatbox.js          Chatbox 驱动器：归一化 + 限流 + typing
│   │   ├── server.js           HTTP API
│   │   ├── webui.js            浏览器兜底界面
│   │   ├── discovery.js        UDP 7713 自动发现应答
│   │   ├── config.js           配置加载 / 局域网 IP 枚举 / 令牌生成
│   │   └── index.js            入口
│   └── scripts/                打包脚本：bundle.mjs / build-exe.mjs
├── dist/                       打包产物 aost-bridge.exe（gitignore，不入库）
├── android-app/                Android 客户端（Kotlin）
│   └── app/src/main/java/com/aost/bridge/
│       ├── BridgeClient.kt     HTTP 客户端
│       ├── MainActivity.kt     单屏界面
│       └── Prefs.kt            连接设置持久化
└── docs/                       架构 / 协议 / 排错 / 打包 / API
```

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
 │       "version": "0.2.0",                  │
 │       "requiresToken": true } ────────────┤
```

设计选择：

- **用 UDP 广播而非 mDNS/Bonjour** —— Android 的 `NsdManager` 需要多播锁，各家 ROM 行为不一致；裸 UDP 广播在所有平台都稳定
- **同时广播 `255.255.255.255` 和各网卡的定向广播地址** —— 不少路由器会过滤全局广播
- **应答里直接带 HTTP 端口** —— 省掉一次额外的查询往返

安全性：发现阶段不返回令牌。令牌只在之后 HTTP 请求的 `Authorization` 头里出现。

## 关键设计决策

### 为什么用手写 OSC 编码器而不是 `osc-min` / `node-osc`

1. **零依赖**：整个 PC 端没有 `node_modules`，`npm start` 直接跑，没有供应链风险，也没有安装失败的可能
2. **我们要的只有两种消息**：`/chatbox/input` 和 `/chatbox/typing`。引入一个通用库只为发两种包不划算
3. **OSC 编码本身极简**：字符串 NUL 结尾 + 4 字节对齐，整数大端 int32。80 行能写完，且我们**完全掌控字节布局**，逐字节对照见 [OSC 协议参考](osc-protocol.md)

### 为什么字符计数用码点而不是 `String.length`

JavaScript 的 `string.length` 数的是 UTF-16 码元。`😀` 的 `length` 是 **2**，但 VRChat 的 144 字符限制数的是**用户感知的字符**（码点）。

如果用 `length` 截断：

- 一个 emoji 占 2 个配额 → 用户实际能打的字变少
- `slice(0, 144)` 可能把代理对切成两半 → 产生非法 UTF-8 → VRChat 显示乱码或直接丢弃

所以 `normalise()` 用 `Array.from(s)`（按码点拆分）再 `.slice()`、`.join('')`，从根上避免切坏代理对。

### 为什么限流放在服务端而不是客户端

VRChat 对 chatbox 有服务端节流，发太快会**静默丢弃**（不报错、不提示）。如果只靠客户端节流，用户换一个客户端（比如直接 curl）就能绕过。放在桥接层是唯一可靠的入口。

`Chatbox.send()` 内部维护 `_queue`（串行 Promise 链）和 `lastSentAt`，保证：

- 并发请求按到达顺序串行化，不会交错
- 任意两次实际发包间隔 ≥ `minIntervalMs`

### 为什么鉴权用 timing-safe 比较

`crypto.timingSafeEqual` 避免通过响应时间差逐字节爆破令牌。宿舍局域网虽然不开放到公网，但这是零成本的正确做法。

注意：长度不同时直接返回 `false`（`timingSafeEqual` 要求等长 buffer，否则抛异常）。

### Android 端为什么不用 Retrofit / OkHttp

App 只有一个 Activity、四个 HTTP 调用。引 OkHttp 会让 APK 增大 ~500KB 并引入依赖管理复杂度。`BridgeClient` 用原生 `HttpURLConnection` + `kotlinx-coroutines` 的 `Dispatchers.IO`，60 行写完，行为完全可预测。

## 协议依据

| 事实 | 来源 | 本项目如何验证 |
|---|---|---|
| `/chatbox/input` 类型是 `,sTT` | [VRChat Wiki: OSC#Chatbox](https://wiki.vrchat.com/wiki/OSC#Chatbox) | 查询本机 VRChat 的 OSCQuery（:52071），返回 `"FULL_PATH":"/chatbox/input","ACCESS":2,"TYPE":"sTT"` |
| `/chatbox/typing` 类型是 `,T` | 同上 | OSCQuery 返回 `"TYPE":"s"`（VRChat 的 OSCQuery 对 bool 端点报告不一致，wiki 表格为权威） |
| 144 字符 / 9 行上限 | 同上 | `chatbox.js` 的 `normalise()` 按此截断，见 [OSC 协议参考](osc-protocol.md) |
| VRChat 监听 UDP 9000 | [OSC Overview](https://docs.vrchat.com/docs/osc-overview) | `netstat -ano` 观察到 VRChat 进程绑定 9000 |
| `T`/`F` 类型标签无载荷 | [OSC 1.0 规范](https://opensoundcontrol.stanford.edu/spec-1_0.html) | 抓包核对报文（如 64 字节的 `,sTT` 文本包），类型标签表见 [OSC 协议参考](osc-protocol.md) |

**这一点值得强调**：网络上大量教程写 `,sbb`（blob 传布尔）。我们没有照抄，而是直接问 VRChat 要了 OSCQuery 元数据来确认。
