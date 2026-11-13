#!/usr/bin/env node
/**
 * build-exe.mjs — 一条命令把 pc-bridge 打成单文件 Windows exe。
 *
 * 流水线：
 *   1. scripts/bundle.mjs 把 src/** 内联成 .build/bridge.cjs
 *   2. 去掉 shebang，写 .build/sea-main.cjs 和 .build/sea-config.json（绝对路径）
 *   3. node --experimental-sea-config 生成 .build/sea-prep.blob
 *   4. 复制当前 node.exe 当容器
 *   5. postject 把 blob 注入成 NODE_SEA_BLOB（本地 devDependency，不联网）
 *   6. 原子改名为仓库根 dist/aost-bridge.exe，并跑一次 --version 自检
 *
 * 可重复执行：每次都会重新生成并覆盖旧产物。
 *
 * 用法：
 *   npm run build:exe            （在 pc-bridge 目录）
 *   node scripts/build-exe.mjs [--out <file>] [--keep-sea]
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundle, PKG_DIR, DEFAULT_OUT } from './bundle.mjs';

const REPO_ROOT = path.resolve(PKG_DIR, '..');
const BUILD_DIR = path.join(PKG_DIR, '.build');
const BUNDLE_FILE = DEFAULT_OUT;
const SEA_MAIN = path.join(BUILD_DIR, 'sea-main.cjs');
const SEA_CONFIG = path.join(BUILD_DIR, 'sea-config.json');
const SEA_BLOB = path.join(BUILD_DIR, 'sea-prep.blob');
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const DEFAULT_EXE = path.join(DIST_DIR, 'aost-bridge.exe');
const POSTJECT_CLI = path.join(PKG_DIR, 'node_modules', 'postject', 'dist', 'cli.js');
// Node 官方的 SEA 哨兵 fuse：postject 靠它在 node 二进制里定位注入点。
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const NODE_EXE = process.execPath;

class BuildError extends Error {
  constructor(message, hints = []) {
    super(message);
    this.hints = hints;
  }
}

let stepNo = 0;

function step(title) {
  stepNo += 1;
  console.log('');
  console.log('=== [' + stepNo + '] ' + title + ' ===');
}

function info(message) {
  console.log('    ' + message);
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function rel(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

function run(label, command, args, options = {}) {
  console.log('  $ ' + path.basename(command) + ' ' + args.map((a) => (a.includes(' ') ? '"' + a + '"' : a)).join(' '));
  const result = spawnSync(command, args, {
    cwd: options.cwd || PKG_DIR,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  if (result.error) {
    throw new BuildError('无法启动子进程（' + label + '）：' + result.error.message, [
      '如果错误是 EPERM / EACCES，说明本机（或安全软件、沙箱）禁止创建子进程。',
      '请关闭限制后重试，或手动执行上面打印的命令。',
    ]);
  }
  if (result.status !== 0) {
    throw new BuildError(label + ' 失败（退出码 ' + result.status + '）', [
      '完整命令见上面的 $ 行，可直接复制到终端复现。',
    ]);
  }
}

function stripShebang(source) {
  return source.replace(/^#![^\n]*\r?\n?/, '');
}

function removeIfPresent(file) {
  try {
    fs.rmSync(file, { force: true, maxRetries: 2, retryDelay: 100 });
  } catch (err) {
    throw new BuildError('无法覆盖已有文件 ' + rel(file) + '：' + err.message, [
      '通常是它正在运行 —— 请先关闭 dist\\aost-bridge.exe（或任务管理器里结束该进程）再重试。',
    ]);
  }
}

function build(options) {
  const exePath = path.resolve(options.out || DEFAULT_EXE);
  const tmpExe = exePath + '.tmp';

  // ---- 0. 前置检查 ---------------------------------------------------------
  if (!fs.existsSync(POSTJECT_CLI)) {
    throw new BuildError('找不到 postject：' + rel(POSTJECT_CLI), [
      '构建期依赖没装。请在 pc-bridge 目录执行：',
      '  npm install',
      '（postject 已写在 devDependencies 里，只用于把 SEA blob 注入 exe，运行时依然零依赖。）',
    ]);
  }
  const nodeMajor = Number(String(process.versions.node).split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    throw new BuildError('当前 Node 版本太旧，不支持 --experimental-sea-config（需要 Node >= 20）', [
      '当前版本: ' + process.version + '  (' + NODE_EXE + ')',
      '升级 Node 后重试；或在 20+ 上用同一个脚本构建。',
    ]);
  }

  // ---- 1. 内联打包 ---------------------------------------------------------
  step('内联打包：src/** -> ' + rel(BUNDLE_FILE));
  const result = bundle({ out: BUNDLE_FILE });
  for (const warning of result.warnings) console.warn('    [警告] ' + warning);
  info('入口     : ' + result.entryId);
  info('模块数   : ' + result.modules.length);
  info('体积     : ' + kb(fs.statSync(BUNDLE_FILE).size));

  // ---- 2. SEA 入口（shebang 在 SEA 的 CJS 包装里不合法，去掉） ------------
  step('准备 SEA 入口与配置');
  const bundled = fs.readFileSync(BUNDLE_FILE, 'utf8');
  fs.writeFileSync(SEA_MAIN, stripShebang(bundled), 'utf8');
  info('入口脚本 : ' + rel(SEA_MAIN));

  const seaConfig = {
    main: SEA_MAIN,
    output: SEA_BLOB,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  };
  fs.writeFileSync(SEA_CONFIG, JSON.stringify(seaConfig, null, 2) + '\n', 'utf8');
  info('配置     : ' + rel(SEA_CONFIG) + '（main/output 均为绝对路径）');

  // ---- 3. 生成 blob --------------------------------------------------------
  step('生成 SEA blob');
  removeIfPresent(SEA_BLOB);
  run('生成 SEA blob', NODE_EXE, ['--experimental-sea-config', SEA_CONFIG], { cwd: BUILD_DIR });
  if (!fs.existsSync(SEA_BLOB) || fs.statSync(SEA_BLOB).size === 0) {
    throw new BuildError('SEA blob 未生成：' + rel(SEA_BLOB), ['检查上面的 node 输出。']);
  }
  info('blob     : ' + rel(SEA_BLOB) + '  ' + kb(fs.statSync(SEA_BLOB).size));

  // ---- 4. 复制 node.exe 当容器 --------------------------------------------
  step('复制 Node 运行时作为 exe 容器');
  fs.mkdirSync(path.dirname(exePath), { recursive: true });
  removeIfPresent(tmpExe);
  info('源       : ' + NODE_EXE + '  (' + process.version + ')');
  fs.copyFileSync(NODE_EXE, tmpExe);
  info('目标     : ' + rel(tmpExe) + '  ' + mb(fs.statSync(tmpExe).size));

  // ---- 5. postject 注入 ---------------------------------------------------
  step('postject 注入 SEA blob');
  run('postject 注入', NODE_EXE, [
    POSTJECT_CLI,
    tmpExe,
    'NODE_SEA_BLOB',
    SEA_BLOB,
    '--sentinel-fuse',
    SENTINEL_FUSE,
  ]);

  // ---- 6. 落地 + 自检 ------------------------------------------------------
  step('落地为 ' + rel(exePath));
  removeIfPresent(exePath);
  try {
    fs.renameSync(tmpExe, exePath);
  } catch (err) {
    throw new BuildError('改名失败：' + err.message, ['请确认 ' + rel(exePath) + ' 没有被占用。']);
  }
  const exeSize = fs.statSync(exePath).size;
  info('产物     : ' + rel(exePath) + '  ' + mb(exeSize));

  step('自检：' + path.basename(exePath) + ' --version');
  run('exe --version 自检', exePath, ['--version']);

  if (!options.keepSea) {
    for (const f of [SEA_MAIN, SEA_BLOB]) removeIfPresent(f);
    info('已清理中间文件（保留 .build/bridge.cjs 便于排查）');
  }

  console.log('');
  console.log('✔ 构建完成');
  console.log('  产物   : ' + rel(exePath) + '  (' + mb(exeSize) + ')');
  console.log('  下一步 : 直接双击或在终端运行 ' + rel(exePath));
  console.log('           首次启动会在 exe 同目录生成 config.json 并打印访问令牌');
  return { exePath, exeSize, bundleBytes: result.bytes, modules: result.modules.length };
}

function parseCli(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') options.out = argv[(i += 1)];
    else if (arg === '--keep-sea') options.keepSea = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new BuildError('未知参数: ' + arg, ['支持: --out <file> / --keep-sea / --help']);
  }
  return options;
}

const invokedDirectly = (() => {
  const script = process.argv[1];
  if (!script) return false;
  return path.resolve(script).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
})();

if (invokedDirectly) {
  let options = {};
  try {
    options = parseCli(process.argv.slice(2));
    if (options.help) {
      console.log('用法: node scripts/build-exe.mjs [--out <file>] [--keep-sea]');
    } else {
      build(options);
    }
  } catch (err) {
    console.error('');
    console.error('[build:exe] ✗ ' + err.message);
    for (const hint of err.hints || []) console.error('  · ' + hint);
    // 失败时别留下半成品
    const tmpExe = path.resolve(options.out || DEFAULT_EXE) + '.tmp';
    try { fs.rmSync(tmpExe, { force: true }); } catch { /* ignore */ }
    process.exitCode = 1;
  }
}
