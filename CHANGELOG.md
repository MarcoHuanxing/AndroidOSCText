# 更新日志

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
