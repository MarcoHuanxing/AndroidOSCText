#!/usr/bin/env node
/**
 * bundle.mjs — pc-bridge 的单文件内联打包器（构建期工具，零第三方依赖）
 *
 * 为什么手写：项目的卖点是「运行时零依赖」，所以构建链也不想引入
 * esbuild / rollup / webpack —— 只为了把几个 CommonJS 文件拼在一起不值得。
 * 本项目所有模块都是 CJS + 静态的相对 require，内联它们几十行就够。
 *
 * 做的事：
 *   1. 从 entry 出发，静态扫描 require('<字面量>')；
 *   2. 相对路径（./x、../y）按 Node 的解析顺序补齐 .js / .cjs / .json / index.js；
 *   3. 每个模块包成 factory 塞进同一个文件，按需惰性执行并带缓存
 *      （所以循环 require 返回的是"进行中"的 exports，和 Node 行为一致）；
 *   4. 内置模块（fs、path、node:xxx ...）和非相对路径原样保留，交给真正的 require。
 *
 * 约定：
 *   - 内联模块里的 __dirname / __filename 一律指向「bundle 文件本身」，
 *     于是 pc-bridge/.build/bridge.cjs 和 pc-bridge/src/config.js 对
 *     path.join(__dirname, '..', 'config.json') 的解析结果一致
 *     （都落到 pc-bridge/config.json）。
 *   - require.main 指向入口模块，保证源码里的 if (require.main === module) 仍然成立。
 *
 * 用法：
 *   node scripts/bundle.mjs [--entry <file>] [--out <file>] [--quiet]
 *   npm run build:bundle
 */

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PKG_DIR = path.resolve(HERE, '..');
export const DEFAULT_ENTRY = path.join(PKG_DIR, 'src', 'index.js');
export const DEFAULT_OUT = path.join(PKG_DIR, '.build', 'bridge.cjs');

const BUILTINS = new Set(builtinModules);
// 只认字面量 require('x') / require("x")，且不把 obj.require(...) 当模块加载。
const REQUIRE_RE = /(^|[^\w$.])require\s*\(\s*(['"])([^'"\r\n]+)\2\s*\)/g;

function toId(absPath) {
  return path.relative(PKG_DIR, absPath).split(path.sep).join('/');
}

function isBuiltin(spec) {
  return spec.startsWith('node:') || BUILTINS.has(spec);
}

function isRelative(spec) {
  return spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../');
}

function resolveRelative(fromAbs, spec) {
  const base = path.resolve(path.dirname(fromAbs), spec);
  const candidates = [
    base,
    base + '.js',
    base + '.cjs',
    base + '.json',
    path.join(base, 'index.js'),
    path.join(base, 'index.cjs'),
    path.join(base, 'index.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // 继续试下一个候选
    }
  }
  return null;
}

function findRequires(code) {
  const found = [];
  REQUIRE_RE.lastIndex = 0;
  let match;
  while ((match = REQUIRE_RE.exec(code)) !== null) found.push(match[3]);
  return found;
}

/**
 * 把入口及其相对依赖内联成一个单文件 CJS。
 * @returns {{outFile: string, entryId: string, modules: string[], bytes: number, warnings: string[]}}
 */
export function bundle(options = {}) {
  const entryAbs = path.resolve(options.entry || DEFAULT_ENTRY);
  const outFile = path.resolve(options.out || DEFAULT_OUT);

  if (!fs.existsSync(entryAbs)) {
    throw new Error('入口文件不存在: ' + entryAbs);
  }

  const defs = new Map();
  const warnings = [];
  const seen = new Set([entryAbs]);
  const queue = [entryAbs];

  while (queue.length > 0) {
    const abs = queue.shift();
    const id = toId(abs);
    const raw = fs.readFileSync(abs, 'utf8');
    const isJson = abs.toLowerCase().endsWith('.json');

    if (isJson) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error('内联 JSON 解析失败: ' + id + ' — ' + err.message);
      }
      defs.set(id, {
        id,
        isJson: true,
        deps: {},
        code: 'module.exports = JSON.parse(' + JSON.stringify(JSON.stringify(parsed)) + ');',
      });
      continue;
    }

    // 去掉 BOM 和 shebang：模块被内联进函数体后，"#!" 就不再合法了。
    const code = raw.replace(/^\uFEFF/, '').replace(/^#![^\n]*\r?\n?/, '');
    const def = { id, isJson: false, deps: {}, code };
    defs.set(id, def);

    for (const spec of findRequires(code)) {
      if (isRelative(spec)) {
        const target = resolveRelative(abs, spec);
        if (!target) {
          throw new Error("无法解析 require('" + spec + "')（来自 " + id + '）');
        }
        def.deps[spec] = toId(target);
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      } else if (!isBuiltin(spec)) {
        warnings.push(id + " 依赖外部模块 '" + spec + "'（保留原生 require，运行时需能解析）");
      }
    }
  }

  const ids = [...defs.keys()].sort();
  const entryId = toId(entryAbs);
  const line = [];
  const push = (text) => line.push(text);

  push('#!/usr/bin/env node');
  push('/**');
  push(' * AndroidOSCText pc-bridge — 单文件打包产物（由 pc-bridge/scripts/bundle.mjs 生成，勿手改）');
  push(' *');
  push(' * 内联的源文件：');
  for (const id of ids) push(' *   - ' + id);
  push(' *');
  push(' * 约定：__dirname / __filename 指向本文件；require.main === 入口模块。');
  push(' */');
  push("'use strict';");
  push('(function () {');
  push("  'use strict';");
  push("  const __nativeRequire = typeof require === 'function' ? require : null;");
  push('  const __defs = {};');
  push('  const __cache = Object.create(null);');
  push('  const __ENTRY_ID = ' + JSON.stringify(entryId) + ';');
  push('');
  push('  function __makeRequire(def) {');
  push('    const localRequire = function (spec) {');
  push('      if (Object.prototype.hasOwnProperty.call(def.deps, spec)) return __load(def.deps[spec]);');
  push("      if (typeof __nativeRequire === 'function') return __nativeRequire(spec);");
  push("      throw new Error('Cannot find module in bundle: ' + spec + ' (from ' + def.filename + ')');");
  push('    };');
  push('    localRequire.resolve = function (spec) {');
  push('      if (Object.prototype.hasOwnProperty.call(def.deps, spec)) return def.deps[spec];');
  push("      return typeof __nativeRequire === 'function' ? __nativeRequire.resolve(spec) : spec;");
  push('    };');
  push('    localRequire.cache = __cache;');
  push("    Object.defineProperty(localRequire, 'main', {");
  push('      enumerable: false,');
  push('      get: function () { return __cache[__ENTRY_ID] || null; },');
  push('    });');
  push('    return localRequire;');
  push('  }');
  push('');
  push('  function __load(id) {');
  push('    const cached = __cache[id];');
  push('    if (cached) return cached.exports;');
  push('    const def = __defs[id];');
  push("    if (!def) throw new Error('bundle 内部错误：未知模块 ' + id);");
  push('    const module = { id: id, filename: def.filename, exports: {}, loaded: false };');
  push('    __cache[id] = module; // 先入缓存，循环 require 时拿到半成品 exports');
  push('    try {');
  push('      def.factory.call(module.exports, module, module.exports, __makeRequire(def), __filename, __dirname);');
  push('    } catch (err) {');
  push('      delete __cache[id];');
  push('      throw err;');
  push('    }');
  push('    module.loaded = true;');
  push('    return module.exports;');
  push('  }');

  for (const id of ids) {
    const def = defs.get(id);
    push('');
    push('  // ---- ' + id + ' ----');
    push('  __defs[' + JSON.stringify(id) + '] = {');
    push('    filename: ' + JSON.stringify(id) + ',');
    push('    deps: ' + JSON.stringify(def.deps) + ',');
    push('    factory: function (module, exports, require, __filename, __dirname) {');
    // 源码逐字保留（不做缩进/换行改写），否则模板字符串里的 HTML 会被改动。
    push(def.code.endsWith('\n') ? def.code.slice(0, -1) : def.code);
    push('    },');
    push('  };');
  }

  push('');
  push('  __load(__ENTRY_ID);');
  push('})();');
  push('');

  const text = line.join('\n');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text, 'utf8');

  return { outFile, entryId, modules: ids, bytes: Buffer.byteLength(text), warnings };
}

function parseCli(argv) {
  const opts = { quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entry') opts.entry = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error('未知参数: ' + arg);
  }
  return opts;
}

const invokedDirectly = (() => {
  const script = process.argv[1];
  if (!script) return false;
  const a = path.resolve(script).toLowerCase();
  const b = fileURLToPath(import.meta.url).toLowerCase();
  return a === b;
})();

if (invokedDirectly) {
  let opts;
  try {
    opts = parseCli(process.argv.slice(2));
  } catch (err) {
    console.error('[bundle] ' + err.message);
    process.exitCode = 1;
  }
  if (opts && opts.help) {
    console.log('用法: node scripts/bundle.mjs [--entry <file>] [--out <file>] [--quiet]');
  } else if (opts) {
    try {
      const result = bundle(opts);
      for (const warning of result.warnings) console.warn('[bundle] 警告: ' + warning);
      if (!opts.quiet) {
        console.log('[bundle] 内联 ' + result.modules.length + ' 个模块 -> ' +
          path.relative(PKG_DIR, result.outFile).split(path.sep).join('/') +
          '  (' + (result.bytes / 1024).toFixed(1) + ' KB)');
        for (const id of result.modules) console.log('         + ' + id);
      }
    } catch (err) {
      console.error('[bundle] 失败: ' + err.message);
      process.exitCode = 1;
    }
  }
}
