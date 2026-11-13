# OSC 协议参考

本文记录本项目用到的 OSC 细节，以及为什么这样实现。

## 为什么需要了解 OSC 编码

VRChat 对 OSC 消息的校验很严格 —— 类型标签和载荷不匹配时会**静默丢弃**，不报错、不提示。所以编码必须精确。

## 字节布局

OSC 消息 = **地址串** + **类型标签串** + **载荷**，每部分都 4 字节对齐。

### 字符串编码

UTF-8 字节 + 1 个 NUL 结尾 + 填充到 4 的倍数。

| 原始 | 字节数 | +NUL | 对齐后 | 十六进制 |
|---|---|---|---|---|
| `/a` | 2 | 3 | 4 | `2f 61 00 00` |
| `/ab` | 3 | 4 | 4 | `2f 61 62 00` |
| `/abc` | 4 | 5 | 8 | `2f 61 62 63 00 00 00 00` |

**注意**：对齐算的是**字节数**，不是字符数。中文字符占 3 字节：

| 原始 | 字节数 | +NUL | 对齐后 |
|---|---|---|---|
| `中` | 3 | 4 | 4 |
| `中文` | 6 | 7 | 8 |

所以「4 个中文字」比「4 个 ASCII 字符」占更多字节配额，但按码点算它们都是 4 个字符。

### 类型标签

类型标签串本身也是 OSC 字符串，前面加逗号。`/chatbox/input` 的类型标签是 `,sTT`。

每个标签的含义：

| 标签 | 载荷 | 说明 |
|---|---|---|
| `i` | int32 大端 | 32 位有符号整数 |
| `f` | float32 大端 | 单精度浮点 |
| `s` | OSC 字符串 | UTF-8，NUL 结尾，4 字节对齐 |
| `b` | int32 长度 + 数据 + 填充 | blob |
| `d` | float64 | 双精度 |
| `T` | **无** | True（OSC 1.1） |
| `F` | **无** | False（OSC 1.1） |
| `N` | **无** | Nil（OSC 1.1） |
| `I` | **无** | Infinitum（OSC 1.1） |

**关键点**：`T` 和 `F` 是**无载荷标签** —— 它们出现在类型标签串里，但不占参数槽位。

这意味着：
```js
build('/chatbox/input', 'sTT', ['hi'])      // 只有 1 个参数 ✓
build('/chatbox/input', 'sTT', ['hi', true, true])  // 后面两个被忽略 ✓
```

### 完整示例

`/chatbox/input` + `,sTT` + `"hi"`：

```
2f 63 68 61 74 62 6f 78  2f 69 6e 70 75 74 00 00   /chatbox/input + NUL + pad
2c 73 54 54 00 00 00 00                             ,sTT + NUL + pad
68 69 00 00                                         hi + NUL + pad
```

总共 28 字节。第一个 16 字节块是地址（15 字符 + NUL 刚好 16，无需额外填充）；第二个是类型标签（4 字符 + NUL 需要补 3 个零到 8 字节）；第三个是载荷。

## VRChat chatbox 端点

| 地址 | 类型 | 参数 |
|---|---|---|
| `/chatbox/input` | `,sTT` | 1. 文本（UTF-8，**144 字符 / 9 行**上限）<br>2. 是否立即发送（`T`=立即，`F`=只填到输入框不发送）<br>3. 是否播放提示音（仅在立即发送时有效） |
| `/chatbox/typing` | `,T` | 输入指示器（`...`）可见性 |

## 网络上常见的错误写法

大量教程和旧代码写成 `,sbb`：

```js
// ❌ 错误：用 blob 传布尔
client.send('/chatbox/input', ['hi', { type: 'b', value: 1 }, { type: 'b', value: 1 }]);
```

这在早期的 VRChat 版本可能能工作（那时内部用 `bool` 重载），但当前版本的类型标签是 `sTT`。

**本项目怎么确认的**：不是查博客，而是直接查询 VRChat 自己的 OSCQuery 接口：

```bash
# 1. 找 OSCQuery 端口
netstat -ano | findstr :5207

# 2. 请求元数据
curl "http://127.0.0.1:52071/?HOST=127.0.0.1&OSC_IP=127.0.0.1&OSC_PORT=9001"
```

返回的 JSON 里：

```json
{
  "FULL_PATH": "/chatbox/input",
  "ACCESS": 2,
  "TYPE": "sTT"
}
```

`ACCESS: 2` 表示可写，`TYPE: "sTT"` 就是权威的类型签名。

## 端口

| 端口 | 方向 | 说明 |
|---|---|---|
| UDP 9000 | 你 → VRChat | VRChat 监听，接收所有 OSC 输入 |
| UDP 9001 | VRChat → 你 | VRChat 发给客户端的回传（avatar 参数、tracker 数据等） |
| TCP 52071 | OSCQuery | HTTP 接口，查询可用的 OSC 地址树（端口动态分配） |

本项目只往 9000 发。/chatbox 是单向的 write-only 端点，不产生回传。

## 扩展：接收 VRChat 发来的消息

如果想做双向（比如显示别人在做什么），需要监听 UDP 9001 并解析 OSC 包：

```js
const dgram = require('dgram');
const sock = dgram.createSocket('udp4');
sock.on('message', (buf) => {
  // VRChat 发来的 avatar 参数，如 /avatar/parameters/VRCEmote 1
  const addr = buf.toString('utf8', 0, buf.indexOf(0));
  console.log(addr);
});
sock.bind(9001);
```

注意 9001 端口**同一时间只能被一个程序绑定**。SlimeVR、VRCFaceTracking、VRCX 等都可能占这个端口 —— 如果你同时想用它们，需要选一个"接力"方案。
