#!/usr/bin/env node
/**
 * sync-engine.cjs — index.html の同梱エンジンを kokuho-core の js/core に揃える。
 *
 * kokuho-core の家計簿ページと同じ読み込み順で、各ファイルを無改変のまま 1 本ずつ <script> に入れる。
 * 末尾に制度値（SPEC・SHAHO_DATA）と、画面のスクリプトが使う名前の受け渡し（glue）を置く。
 * どのファイルのどの版を入れたかは engine-manifest（kokuho-core のコミットと各ファイルの sha256）に残す。
 *
 * 実行（kokuho-core を隣に置いた状態で）:
 *   node scripts/sync-engine.cjs            # ../kokuho-core を使う
 *   node scripts/sync-engine.cjs <dir>      # kokuho-core の場所を指定
 * 検査だけ（書き換えない）: --check を付ける。差があれば終了コード 1。
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const CORE = path.resolve(args.find(a => !a.startsWith('--')) || path.join(ROOT, '..', 'kokuho-core'));

// 読み込み順は kokuho-core の家計簿ページ（city-integrated）と同じ。貸与コアはブリッジより前に置く。
const JS_FILES = [
  'js/core/shared/income.js',
  'js/core/jumin.js',
  'js/core/shogakukin.js',
  'js/core/shogakukin-loan.js',
  'js/core/shogakukin-bridge.js',
  'js/core/shaho.js',
];
const SPEC_FILE = 'js/core/shogakukin-2026.json';
const SHAHO_DATA_FILES = {
  kenpo: 'data/shaho/kenpo-2026.json',
  kosei: 'data/shaho/kosei-nenkin.json',
  koyo: 'data/shaho/koyo-2026.json',
  standard: 'data/shaho/standard-monthly.json',
};

const BEGIN = '<!-- engine:begin（scripts/sync-engine.cjs が生成。手で編集しない） -->';
const END = '<!-- engine:end -->';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const read = rel => fs.readFileSync(path.join(CORE, rel), 'utf8');

function coreCommit() {
  try { return execFileSync('git', ['-C', CORE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch (e) { return 'unknown'; }
}
function coreBranch() {
  try { return execFileSync('git', ['-C', CORE, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch (e) { return 'unknown'; }
}
function coreDirty() {
  try {
    const all = [...JS_FILES, SPEC_FILE, ...Object.values(SHAHO_DATA_FILES)];
    return execFileSync('git', ['-C', CORE, 'status', '--porcelain', '--', ...all], { encoding: 'utf8' }).trim();
  } catch (e) { return ''; }
}

function buildEngine() {
  const files = {};
  const blocks = [];
  for (const rel of JS_FILES) {
    const src = read(rel);
    if (/<\/script/i.test(src)) throw new Error(rel + ' に </script が含まれる');
    files[rel] = sha(src);
    blocks.push(`<script data-engine-src="${rel}">\n${src}\n</script>`);
  }
  const specSrc = read(SPEC_FILE);
  files[SPEC_FILE] = sha(specSrc);
  const shahoData = {};
  for (const [k, rel] of Object.entries(SHAHO_DATA_FILES)) {
    const s = read(rel);
    files[rel] = sha(s);
    shahoData[k] = JSON.parse(s);
  }
  const dataJs = [
    `const SPEC = ${JSON.stringify(JSON.parse(specSrc))};`,
    `const SHAHO_DATA = ${JSON.stringify(shahoData)};`,
    '// 画面のスクリプトが使う名前（給付コア・ブリッジは関数スコープに包まれ window に公開される）',
    'const { calcShogakukin } = window.Shogakukin;',
    'const { supporterFromIncome, estimateHumanDeductionDiff, calcFromIncome, calcLoanFromIncome } = window.ShogakukinBridge;',
  ].join('\n');
  if (/<\/script/i.test(dataJs)) throw new Error('制度値に </script が含まれる');
  const manifest = { source: 'kokuho-core', commit: coreCommit(), files };
  return [
    BEGIN,
    `<script type="application/json" id="engine-manifest">${JSON.stringify(manifest)}</script>`,
    ...blocks,
    `<script data-engine-src="data">\n${dataJs}\n</script>`,
    END,
  ].join('\n');
}

// 置き換える範囲: engine:begin〜end。初回は旧形式（「同梱エンジン」の見出しで始まる 1 本の <script>）。
function locate(html) {
  const b = html.indexOf(BEGIN);
  if (b >= 0) {
    const e = html.indexOf(END, b);
    if (e < 0) throw new Error('engine:end が見つからない');
    return [b, e + END.length];
  }
  const head = '<script>\n/* === 同梱エンジン';
  const s = html.indexOf(head);
  if (s < 0) throw new Error('同梱エンジンの位置が見つからない');
  const e = html.indexOf('</script>', s);
  if (html.indexOf(head, s + 1) >= 0) throw new Error('旧形式のエンジンが 2 つある');
  return [s, e + '</script>'.length];
}

function main() {
  const dirty = coreDirty();
  if (dirty) {
    console.error('kokuho-core の対象ファイルに未コミットの変更がある。main の版に揃えるため止める:\n' + dirty);
    process.exit(2);
  }
  if (coreBranch() !== 'main') console.error(`注意: kokuho-core は main ではなく ${coreBranch()} に乗っている`);
  const file = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const [s, e] = locate(html);
  const next = html.slice(0, s) + buildEngine() + html.slice(e);
  if (CHECK) {
    // コミット番号だけの違い（ファイルの中身は同じ）は一致とみなす
    const strip = h => h.replace(/"commit":"[^"]*"/, '"commit":""');
    if (strip(next) === strip(html)) { console.log('同梱エンジンは kokuho-core と一致'); return; }
    console.error('同梱エンジンが kokuho-core と違う'); process.exit(1);
  }
  fs.writeFileSync(file, next);
  console.log(`index.html を更新: kokuho-core ${coreCommit().slice(0, 10)}・${JS_FILES.length} ファイル＋制度値`);
}

main();
