# 部署与排错

## 一、PC 端排错

### VRChat 收不到消息

按顺序检查：

1. **VRChat 是否在运行**
   ```powershell
   Get-Process VRChat -ErrorAction SilentlyContinue
   ```

2. **9000 端口是否被 VRChat 占用**
   ```powershell
   netstat -ano | findstr :9000
   ```
   应该看到 `UDP 0.0.0.0:9000`，其 PID 对应 VRChat 进程。
   如果 PID 是别的程序（比如 PaperTracker、VRCX），说明 VRChat 没抢到端口 —— 先关掉那个程序再启动 VRChat。

3. **OSC 是否真的启用**
   VRChat 启动日志里搜 `OSC`：
   ```powershell
   Get-Content "$env:LOCALAPPDATA/../LocalLow/VRChat/VRChat/output_log*.txt" -Tail 200 | Select-String OSC
   ```
   > 注意：日志里 `OSC enabled: False` 指的是**"用户是否在设置里手动开启了 OSC"**，不是"OSC 服务没起来"。
   > 只要日志里有 `Advertising Service VRChat-Client-xxxx of type OSC on 9000`，就说明 OSC 服务在正常工作。

4. **用 OSCQuery 直接验证端点存在**
   ```powershell
   # 先找 OSCQuery 端口
   netstat -ano | findstr :5207
   # 然后浏览器打开（把 52071 换成实际端口）
   # http://127.0.0.1:52071/?HOST=127.0.0.1&OSC_IP=127.0.0.1&OSC_PORT=9001
   ```
   返回的 JSON 里应该能找到 `"FULL_PATH": "/chatbox/input", "TYPE": "sTT"`。

5. **手动发一包测试**
   ```bash
   cd pc-bridge
   node src/index.js --say "hello from CLI"
   ```

### 桥接启动报错

| 报错 | 原因 | 解决 |
|---|---|---|
| `EADDRINUSE :7712` | 端口被占 | 改 `config.json` 里的 `httpPort`，或 `set AOST_PORT=7713` |
| `config.json is not valid JSON` | 手动编辑弄坏了 | 删掉 `config.json` 重启，会自动重建 |
| `Cannot find module` | 目录不对 | 必须 `cd pc-bridge` 再跑 |

### 如何只发送不启动服务

```bash
node src/index.js --say "临时发一句"
```

---

## 二、手机端排错

### 连不上 PC

1. **确认在同一个 Wi-Fi**
   手机 Wi-Fi 设置里看 IP，应该是 `192.168.x.x` 且和 PC 同网段。

2. **确认 IP 填对了**
   用 PC 启动窗口打印的地址，不要用 `127.0.0.1`、不要用 `26.x.x.x`（那是 Radmin VPN）或 `198.18.x.x`（Meta 虚拟网卡）。

3. **先用手机浏览器验证**
   手机浏览器打开 `http://<PC-IP>:7712`。
   - 能打开 → 网络通，问题在 App 的配置
   - 打不开 → 网络不通，看下一节

4. **Windows 防火墙**
   首次启动 Node 时 Windows 会弹窗询问是否允许网络访问。如果当时点了"取消"，需要手动放行：
   ```powershell
   # 以管理员身份运行
   New-NetFirewallRule -DisplayName "AndroidOSCText Bridge" -Direction Inbound -LocalPort 7712 -Protocol TCP -Action Allow
   ```
   或者临时关闭防火墙测试：
   ```powershell
   Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False
   # 测完记得改回 True
   ```

5. **宿舍网络隔离（AP Isolation）**
   很多校园/宿舍 Wi-Fi 开了"客户端隔离"，设备之间互相不可见。这是网络设备设置，改不了。
   
   **绕过办法：手机开热点**
   ```
   手机开热点 → PC 连手机热点 → PC 启动窗口会打印新的 IP（一般是 192.168.43.x）
   ```
   然后在手机端填这个新 IP。

### 401 Unauthorized

令牌填错了。令牌在 PC 启动窗口打印，也保存在 `pc-bridge/config.json` 的 `token` 字段。

### 发送没反应但没报错

看 PC 终端有没有 `[http] POST /api/say` 的日志。
- 有日志但 VRChat 没显示 → VRChat 侧问题，回到上面"VRChat 收不到消息"
- 没日志 → 请求没到，网络问题

---

## 三、配置项说明

`pc-bridge/config.json`：

```json
{
  "oscHost": "127.0.0.1",
  "oscPort": 9000,
  "httpHost": "0.0.0.0",
  "httpPort": 7712,
  "token": "自动生成",
  "requireToken": true,
  "maxChars": 144,
  "maxLines": 9,
  "sendNow": true,
  "sfx": true,
  "minIntervalMs": 900,
  "typingHoldMs": 3000,
  "historySize": 200
}
```

| 字段 | 说明 |
|---|---|
| `oscHost` | VRChat 所在机器。VR 用另一台 PC 时改成那台的 IP，并确保 VRChat 用 `--osc=9000:0.0.0.0:9001` 启动 |
| `httpPort` | 手机访问的 HTTP 端口 |
| `requireToken` | 设 `false` 可关闭鉴权（**仅限完全可信的网络**） |
| `minIntervalMs` | 两次发送的最小间隔。发太快 VRChat 会静默丢包，别设太小 |
| `sfx` | 是否默认播放提示音 |

### 环境变量（优先级高于 config.json）

| 变量 | 作用 |
|---|---|
| `AOST_PORT` | HTTP 端口 |
| `AOST_OSC_HOST` | OSC 目标 IP |
| `AOST_OSC_PORT` | OSC 目标端口 |
| `AOST_TOKEN` | 访问令牌 |

---

## 四、Android 端构建

### 环境要求

- JDK 17（本项目在 `D:\SoftWare\JDK17` 验证通过）
- Android SDK：platform-tools、platforms;android-34、build-tools;34.0.0
- Gradle 8.12.1（已随 wrapper 配置）

### 构建

```powershell
$env:JAVA_HOME = 'D:\SoftWare\JDK17'
$env:ANDROID_HOME = 'D:\SoftWare\AndroidSDK'
cd android-app
.\gradlew.bat :app:assembleDebug
```

产物：`android-app/app/build/outputs/apk/debug/app-debug.apk`

### 安装到手机

```bash
adb install -r android-app/app/build/outputs/apk/debug/app-debug.apk
```

adb 在 Android SDK 的 `platform-tools` 目录里。

### 修改默认连接地址

改 `android-app/app/build.gradle.kts`：

```kotlin
buildConfigField("String", "DEFAULT_HOST", "\"192.168.1.57\"")
```

这只是"首次打开时的默认值"，用户仍可在 App 内改。
