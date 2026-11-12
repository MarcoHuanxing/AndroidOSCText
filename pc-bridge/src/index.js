#!/usr/bin/env node
'use strict';
/**
 * AndroidOSCText — PC bridge entrypoint.
 *
 * Phone (LAN) --HTTP--> this process --OSC/UDP--> VRChat chatbox
 */

const os = require('os');
const { loadConfig, lanAddresses, CONFIG_FILE } = require('./config');
const { Chatbox } = require('./chatbox');
const { createServer } = require('./server');
const { createDiscoveryResponder } = require('./discovery');

function banner(cfg) {
  const addrs = lanAddresses();
  const line = '='.repeat(64);
  console.log(line);
  console.log('  AndroidOSCText  ·  手机 -> VRChat Chatbox 桥接');
  console.log(line);
  console.log('  本机名      : ' + os.hostname());
  console.log('  OSC 目标    : ' + cfg.oscHost + ':' + cfg.oscPort + '  (VRChat)');
  console.log('  HTTP 监听   : ' + cfg.httpHost + ':' + cfg.httpPort);
  console.log('  配置文件    : ' + CONFIG_FILE);
  console.log('');
  console.log('  手机请访问以下任一地址：');
  if (addrs.length === 0) {
    console.log('    (未检测到局域网 IPv4 地址)');
  } else {
    for (const a of addrs) {
      console.log('    http://' + a.address + ':' + cfg.httpPort + '    [' + a.iface + ']');
    }
  }
  console.log('');
  console.log('  访问令牌    : ' + cfg.token);
  if (cfg.requireToken) {
    console.log('  (手机端首次连接需要填写这个令牌)');
  }
  console.log('');
  console.log('  限制        : ' + cfg.maxChars + ' 字符 / ' + cfg.maxLines + ' 行 / ' +
              '最小间隔 ' + cfg.minIntervalMs + 'ms');
  console.log(line);
  console.log('');
}

async function main() {
  const cfg = loadConfig();
  const chatbox = new Chatbox({
    host: cfg.oscHost,
    port: cfg.oscPort,
    maxChars: cfg.maxChars,
    maxLines: cfg.maxLines,
    minIntervalMs: cfg.minIntervalMs,
    typingHoldMs: cfg.typingHoldMs,
  });
  await chatbox.open();

  const { server } = createServer(cfg, chatbox);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.httpPort, cfg.httpHost, resolve);
  });

  let discovery = null;
  if (cfg.enableDiscovery !== false) {
    try {
      discovery = createDiscoveryResponder(cfg);
    } catch (err) {
      console.warn('[discovery] 启动失败（不影响正常使用）:', err.message);
    }
  }

  banner(cfg);

  // One-shot CLI mode: "node src/index.js --say hello"
  const sayIdx = process.argv.indexOf('--say');
  if (sayIdx !== -1) {
    const text = process.argv.slice(sayIdx + 1).join(' ');
    try {
      const r = await chatbox.send(text);
      console.log('[say] sent ' + r.bytes + ' bytes: ' + r.text);
    } catch (err) {
      console.error('[say] failed:', err.message);
      process.exitCode = 1;
    }
    chatbox.close();
    if (discovery) discovery.close();
    server.close();
    return;
  }

  const shutdown = (signal) => {
    console.log('');
    console.log('[' + signal + '] 正在关闭...');
    chatbox.close();
    if (discovery) discovery.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[fatal]', err.message);
    process.exit(1);
  });
}

module.exports = { main };
