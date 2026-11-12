# 架构说明

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

## 关键设计决策

### 为什么用手写 OSC 编码器而不是 `osc-min` / `node-osc`

1. **零依赖**：整个 PC 端没有 `node_modules`，`npm start` 直接跑，没有供应链风险，也没有安装失败的可能
2. **我们要的只有两种消息**：`/chatbox/input` 和 `/chatbox/typing`。引入一个通用库只为发两种包不划算
3. **OSC 编码本身极简**：字符串 NUL 结尾 + 4 字节对齐，整数大端 int32。80 行能写完，且我们**完全掌控字节布局**，测试可以断言到每一个十六进制字节

### 为什么字符计数用码点而不是 `String.length`

JavaScript 的 `string.length` 数的是 UTF-16 码元。`😀` 的 `length` 是 **2**，但 VRChat 的 144 字符限制数的是**用户感知的字符**（码点）。

如果用 `length` 截断：
- 一个 emoji 占 2 个配额 → 用户实际能打的字变少
- `slice(0, 144)` 可能把代理对切成两半 → 产生非法 UTF-8 → VRChat 显示 `` 或直接丢弃

所以 `normalise()` 用 `Array.from(s)`（按码点拆分）再 `.slice()`、`.join('')`。测试里有专门一条 `normalise never splits a surrogate pair` 守着这个行为。

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

---

## 协议依据

| 事实 | 来源 | 本项目如何验证 |
|---|---|---|
| `/chatbox/input` 类型是 `,sTT` | [VRChat Wiki: OSC#Chatbox](https://wiki.vrchat.com/wiki/OSC#Chatbox) | 查询本机 VRChat 的 OSCQuery（:52071），返回 `"FULL_PATH":"/chatbox/input","ACCESS":2,"TYPE":"sTT"` |
| `/chatbox/typing` 类型是 `,T` | 同上 | OSCQuery 返回 `"TYPE":"s"`（VRChat 的 OSCQuery 对 bool 端点报告不一致，wiki 表格为权威） |
| 144 字符 / 9 行上限 | 同上 | 单元测试断言截断行为 |
| VRChat 监听 UDP 9000 | [OSC Overview](https://docs.vrchat.com/docs/osc-overview) | `netstat -ano` 观察到 VRChat 进程绑定 9000 |
| `T`/`F` 类型标签无载荷 | [OSC 1.1 规范](https://opensoundcontrol.stanford.edu/spec-1_0.html) | 单元测试 `T and F tags carry no payload` |

**这一点值得强调**：网络上大量教程写 `,sbb`（blob 传布尔）。我们没有照抄，而是直接问 VRChat 要了 OSCQuery 元数据来确认。
