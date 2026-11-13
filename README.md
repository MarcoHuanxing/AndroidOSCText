# AndroidOSCText

**SBAI瞎JB推**

**用手机键盘打字，让文字出现在 VRChat 的 Chatbox 上。**

宿舍里不方便说话？不用买麦克风，不用装 SAPI，掏出手机打字就行 —— 文字会实时显示在你头顶的 Chatbox 里，对面的人直接看得到。

> 为什么中间要塞一个 PC 桥接、协议细节、出问题怎么查：[架构说明](docs/architecture.md) · [OSC 协议参考](docs/osc-protocol.md) · [部署与排错](docs/setup-troubleshooting.md)

---

## 安装

### 1. PC 端（二选一）

**方式 A：直接用 exe —— 推荐，不用装 Node**

把 `dist/aost-bridge.exe` 放到一个**普通目录**里（比如桌面上新建的 `aost` 文件夹；别放 `C:\Program Files` —— 首次运行要在同目录写配置），然后双击。

- 不需要 Node.js，不需要 `npm install`，不需要管理员权限
- 首次运行在 exe 同目录生成 `config.json`（含随机令牌）
- 体积约 89 MB，因为 Node 运行时打在里面
- 怎么构建、换电脑时令牌怎么带走、SmartScreen 提示怎么过：[打包与分发](docs/packaging.md)

**方式 B：从源码运行（需要 Node.js ≥ 18）**

```bash
cd pc-bridge
npm start
```

两种方式启动后都会在终端打印连接信息：

```
================================================================
  AndroidOSCText  ·  手机 -> VRChat Chatbox 桥接
================================================================
  版本        : 0.2.0
  运行方式    : 单文件 exe（免安装 Node）
  OSC 目标    : 127.0.0.1:9000  (VRChat)
  HTTP 监听   : 0.0.0.0:7712
  配置文件    : D:\aost\config.json

  手机请访问以下任一地址：
    http://192.168.1.57:7712    [以太网]

  访问令牌    : 9d3d034122b5d63e39b99e80d68b93de
================================================================
```

### 2. VRChat 端

VRChat 启动时自动开启 OSC（UDP 9000），不需要装任何东西。

> 验证：`netstat -ano | findstr :9000` 应能看到 VRChat 进程在监听 UDP 9000。

### 3. 手机端

装 `android-app/build/outputs/apk/debug/app-debug.apk`（自己构建的方法见 [部署与排错](docs/setup-troubleshooting.md)）。

不装 App 也行：手机浏览器打开 `http://<PC 的局域网 IP>:7712`，功能完全一样。

---

## 使用

### 连接 PC

打开 App，点右上角齿轮展开连接设置：

- **自动发现（推荐）**：点「自动发现 PC」，App 广播 UDP 7713 找同局域网里的桥接，自动填好 IP 和端口，只需补令牌
- **手动填**：PC 局域网 IP、端口 `7712`、访问令牌 —— 都在 PC 启动窗口里

点「连接」，显示"已连接"就可以了。

### 打字发到 Chatbox

| 方式 | 怎么做 |
|---|---|
| 手机 App | 输入文字，点发送 |
| 手机浏览器 | 打开 `http://<PC-IP>:7712`，在页面里输入发送 |
| 命令行（exe） | `aost-bridge.exe --say "临时发一句"` |
| 命令行（源码） | `node src/index.js --say "临时发一句"` |
| HTTP / 脚本 | 见 [HTTP API](docs/http-api.md) |

几条硬规则：

- 上限 **144 字符 / 9 行**，按码点算 —— emoji 算 1 个，也不会被截成半个
- 服务端有最小发送间隔（默认 900ms），发太快 VRChat 会**静默丢包**，所以由桥接层排队
- Chatbox **只显示最后一条**，且对所有人可见；不想公开的内容别发

---

## AI 声明

本项目在开发过程中大量使用了 AI 辅助，如实说明。

### 生成方式

**代码与文档**主要由 AI 编程助手（DeepSeek Harness 上的 deepseek-v4.1-flash）生成，由项目所有者审阅、调试与决策。

- PC 端桥接全部源码（OSC 编解码器、chatbox 驱动、HTTP 服务、配置加载）
- Android 客户端全部源码（Kotlin Activity、HTTP 客户端、布局与资源）
- 打包脚本（`pc-bridge/scripts/`）与本 README、`docs/` 下的全部文档

### 人工把关的部分

以下决策与验证由人完成，不是 AI 自行拍板：

- **架构选型**：为什么走 HTTP 中转而不用 UDP 直发
- **协议事实核验**：`/chatbox/input` 的类型标签究竟是 `,sTT` 还是 `,sbb` —— 通过查询本机 VRChat 的 OSCQuery 实测确认，没有采信网上流传的写法
- **代码审阅与验收**：每个文件在合入前都被读过，关键行为实跑验证过

### 关于正确性

AI 生成的代码可能包含错误。现状如实写：

| 项 | 现状 |
|---|---|
| 自动化测试 | **没有**。桥接的测试依赖本机环境（要占真实端口、要 VRChat 在跑），换台机器跑出来的是假失败，所以没有保留测试套件 |
| 协议依据 | 每个 OSC 地址都对照 [VRChat 官方 wiki](https://wiki.vrchat.com/wiki/OSC#Chatbox) + 本机 OSCQuery 实测，见 [OSC 协议参考](docs/osc-protocol.md) |

也就是说：**它没有经过生产环境验证**，请按「自担风险」使用，重要场合先自己完整跑一遍。

### 如果你要复用

- 代码是 MIT，随便用
- 如果基于本项目继续用 AI 开发，建议保留这段声明
- 别因为「AI 写的」就跳过验证 —— 没有测试兜底的项目，验证只能靠你自己跑

---

## License

MIT
