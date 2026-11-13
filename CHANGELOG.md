# 更新日志

## v0.2.0 — 打包为 Windows exe

**2026-11-13**

这一版没有改协议、没有改 Android 端，只是把 PC 桥接变成「能被普通人运行」的东西。

- **单文件 exe 分发** —— 新增 `npm run build:exe`：用 Node.js SEA（`--experimental-sea-config`）生成 blob，再由 `postject` 注入到拷贝出的 `node.exe`，产出仓库根的 `dist/aost-bridge.exe`。实测 88.7 MB（Node 24.19），Node 运行时打在里面，对方不用装 Node
- **首次运行零配置** —— 双击就在 exe 同目录生成 `config.json`（含随机令牌），终端打印本机名 / OSC 目标 / HTTP 监听 / 局域网地址 / 令牌；换电脑时把 `config.json` 一起拷走即可沿用原令牌
- **新增 `AOST_CONFIG`** —— 可指定 `config.json` 的路径（放别处或一台机器跑多份配置），与已有的 `AOST_PORT` / `AOST_OSC_HOST` / `AOST_OSC_PORT` / `AOST_TOKEN` 一起构成完整的覆盖手段
- **移除测试套件与 CI** —— 删掉 `pc-bridge/test/` 与 `.github/`：桥接的测试依赖本机环境（占真实端口、要 VRChat 在跑），换台机器跑出来的是假失败，留着只会制造噪声。README 同时精简为「安装 / 使用 / AI 声明」，架构、发现协议、项目结构移入 `docs/architecture.md`，HTTP 接口移入 `docs/http-api.md`
- **不把打包和测试搬进 GitHub Actions** —— 桥接的测试依赖本机环境（占真实端口、要 VRChat 在跑），换台机器跑出来的是假失败；exe 也只需在本机 `npm run build:exe` 出一次。`.github/` 已移除
- **文档** —— 新增 [`docs/packaging.md`](docs/packaging.md)（选型取舍、为什么 89 MB、构建与验证、令牌迁移、防火墙、SmartScreen 与杀软误报、排错）；README「快速开始」新增「方式 A：直接用 exe」，原源码运行方式改为「方式 B」

**已知局限**：exe 没有代码签名，SmartScreen 会提示「未知发布者」，个别杀软可能误报；只能在 Windows 上构建 Windows exe，exe 内嵌的 Node 版本等于构建机上的版本。这些没法靠改代码消除，详见 `docs/packaging.md`。

## v0.1.0 — 2026-11-13

首个可用版本。

### PC 端桥接

- **手写 OSC 1.0/1.1 编码器**（`src/osc.js`，零依赖）
  - 地址串 / 类型标签串 / 载荷全部 4 字节对齐
  - 支持 `i` `f` `s` `b` `d` 与无载荷的 `T` `F` `N` `I`
  - 遇到不支持的标签直接抛错，不产生畸形报文
- **Chatbox 驱动器**（`src/chatbox.js`）
  - 码点级 144 字符截断（emoji 不会被切成半个）
  - 9 行上限
  - 控制字符剥离、CRLF 归一、TAB→空格
  - 串行队列 + 最小间隔限流（默认 900ms）
  - typing 指示器自动超时关闭
- **HTTP API**（`src/server.js`）
  - `/api/health`、`/api/info`、`/api/say`、`/api/typing`、`/api/history`
  - `crypto.timingSafeEqual` 做令牌比较
  - 请求体大小限制 64KB
- **内置网页界面**（`src/webui.js`）—— 手机浏览器直接可用，无需装 App
- **配置**（`src/config.js`）—— 首次运行自动生成随机令牌并持久化；支持环境变量覆盖

### Android 客户端

- Kotlin 单 Activity，Material3 深色主题
- 实时字符计数（按码点，与 PC 端规则一致）、行数提示、超限变红
- 连接设置（IP / 端口 / 令牌）持久化到 SharedPreferences
- 草稿自动保存，旋转屏幕或杀进程后不丢
- 原生 `HttpURLConnection` + 协程，无 Retrofit/OkHttp 依赖
- APK 体积 5.7 MB

### 测试

- 17 个单元测试（OSC 编码字节级断言、文本归一化边界）
- 14 项 HTTP 端到端测试
- 全部通过

### 协议验证

通过查询本机 VRChat 的 OSCQuery（`:52071`）确认：
```json
{ "FULL_PATH": "/chatbox/input", "ACCESS": 2, "TYPE": "sTT" }
```
没有采用网上常见的 `,sbb` 写法。
