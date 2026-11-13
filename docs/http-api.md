# HTTP API

桥接对局域网暴露的 HTTP 接口。手机 App、内置网页版、命令行 `--say`、你自己写的脚本，走的都是这一套。

- 默认地址：`http://<PC 的局域网 IP>:7712`
- 所有**写操作**都要 `Authorization: Bearer <令牌>`（或 `X-AOST-Token` 头）
- 令牌在 PC 启动窗口打印，也存在 `config.json` 的 `token` 字段里
- 响应一律 JSON，`Cache-Control: no-store`

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 否 | 健康检查：运行时长、OSC 目标、发送统计 |
| GET | `/api/info` | 否 | 版本、局域网地址、限制参数 |
| POST | `/api/say` | 是 | `{"text": "...", "sfx": true}` 发到 chatbox |
| POST | `/api/typing` | 是 | `{"on": true}` 切换输入指示器 |
| GET | `/api/history` | 是 | 最近 50 条发送记录 |
| GET | `/` | 否 | 内置网页版界面 |

## 示例

```bash
# 健康检查（不需要令牌）
curl http://192.168.1.57:7712/api/health

# 发一条
curl -X POST http://192.168.1.57:7712/api/say \
  -H "Authorization: Bearer 9d3d034122b5d63e39b99e80d68b93de" \
  -H "Content-Type: application/json" \
  -d '{"text":"宿舍不方便说话，打字交流","sfx":false}'
```

`POST /api/say` 成功返回：

```json
{ "ok": true, "text": "…归一化后的文本…", "bytes": 52, "sendNow": true, "sfx": false }
```

`text` 是你实际发出去的内容（已截断、已归一化）；`bytes` 是 OSC 报文长度。空文本会被 400 拒绝。

## 行为细节

| 项 | 说明 |
|---|---|
| 鉴权失败 | 401 `{"ok":false,"error":"unauthorized"}`，令牌比较用 `crypto.timingSafeEqual` |
| 归一化 | CRLF→LF、剔除控制字符、TAB→4 空格、9 行截断、144 码点截断 |
| 限流 | 串行队列 + 最小间隔（默认 900ms），并发请求按到达顺序排队 |
| 请求体上限 | 64KB |
| CORS | 放开 `*`，因为内置网页由本服务提供，局域网工具无需收紧 |

> 关掉鉴权（`config.json` 里 `requireToken: false`）只适合完全可信的网络 —— 局域网里任何人都能往你 Chatbox 打字。
