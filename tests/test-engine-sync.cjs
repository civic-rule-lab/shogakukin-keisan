/**
 * test-engine-sync.cjs — index.html の同梱エンジン（所得・住民税・奨学金・貸与・ブリッジ・社保）の版を検証。
 *
 * 1. engine-manifest に載った sha256 と、埋め込まれた各ファイルの中身が一致する（手で直していない）
 * 2. kokuho-core が隣にあれば、埋め込みが kokuho-core の js/core と一字一句同じ（無改変の複製）
 * 3. ページを jsdom で読み込んでスクリプトのエラーが出ない・画面が使う名前がそろっている
 * 4. 同期で入った修正が効いている（所得金額調整控除・70歳以上の厚生年金・75歳以上の健康保険）
 *
 * 実行（jsdom は kokuho-core の node_modules を借りる）:
 *   NODE_PATH=../kokuho-core/node_modules node tests/test-engine-sync.cjs
 * 同期のやり直し: node scripts/sync-engine.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const CORE = path.join(ROOT, '..', 'kokuho-core');

let pass = 0, fail = 0;
const A = (label, cond) => { console.log(`${cond ? '✓' : '✗'} ${label}`); cond ? pass++ : fail++; };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script async src="https:\/\/www\.googletagmanager[^<]*<\/script>/g, '');

// 1. manifest と埋め込みの一致
const mm = html.match(/<script type="application\/json" id="engine-manifest">([\s\S]*?)<\/script>/);
A('engine-manifest がある', !!mm);
const manifest = mm ? JSON.parse(mm[1]) : { files: {} };
const blocks = {};
for (const m of html.matchAll(/<script data-engine-src="([^"]+)">\n([\s\S]*?)\n<\/script>/g)) blocks[m[1]] = m[2];
const jsFiles = Object.keys(manifest.files).filter(f => f.endsWith('.js'));
A('埋め込みの JS が 6 本（所得・住民税・奨学金・貸与・ブリッジ・社保）', jsFiles.length === 6 && jsFiles.every(f => f in blocks));
A('各 JS の中身が manifest の sha256 と一致', jsFiles.every(f => sha(blocks[f] || '') === manifest.files[f]));
A('旧形式（strip 結合の 1 本）が残っていない', !html.includes('/* === 同梱エンジン（正本の strip 結合'));
A('engine:begin / engine:end が 1 組', (html.match(/<!-- engine:begin/g) || []).length === 1 && (html.match(/<!-- engine:end -->/g) || []).length === 1);

// 2. kokuho-core の原本と一致
if (fs.existsSync(path.join(CORE, 'js', 'core', 'jumin.js'))) {
  for (const f of Object.keys(manifest.files)) {
    const p = path.join(CORE, f);
    A(`kokuho-core の原本と一致: ${f}`, fs.existsSync(p) && sha(fs.readFileSync(p, 'utf8')) === manifest.files[f]);
  }
} else {
  console.log('… kokuho-core が隣に無いため原本との一致は未検査');
}

// 3. jsdom で読み込む
const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push(String(e.message || e)));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://shogakukin-keisan.jp/' });
const w = dom.window;
A('スクリプトのエラーが出ない', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 5).join('\n'));
const names = ['calcShogakukin', 'supporterFromIncome', 'estimateHumanDeductionDiff', 'calcLoanEligibility', 'simulateTeigaku',
  'simulateShotokuRendo', 'simulateType2', 'lookupHoshoryo', 'hoshoryoNyugakuZougaku', 'calcSalaryIncome', 'calcPensionIncome',
  'calcTaxableIncomeForKokuho', 'calculateJumin'];
A('画面が使う関数がそろっている', names.every(n => w.eval(`typeof ${n}`) === 'function'));
A('window.Shaho・SPEC・SHAHO_DATA がある', w.eval('typeof window.Shaho.calculateShaho === "function" && typeof SPEC === "object" && typeof SHAHO_DATA === "object"'));

// 4. 同期で入った修正
// 所得金額調整控除: 給与200万（給与所得132万）＋65歳以上の年金200万（年金所得90万）→ 10万円を引いて合計所得212万
const sp = w.eval('supporterFromIncome(null,{salary:2000000,pension:2000000,age:66,socialInsurance:0,dependents:0})');
A('給与と年金の両方: 所得金額調整控除 10 万円を引いた合計所得 2,120,000', sp.totalIncome === 2120000);
const sp0 = w.eval('supporterFromIncome(null,{salary:2000000,pension:0,age:66,socialInsurance:0,dependents:0})');
A('給与だけ: 調整控除なしの合計所得 1,320,000', sp0.totalIncome === 1320000);
// 社保: 70歳以上は厚生年金なし、75歳以上は健康保険・介護もなし（雇用保険は残る）
const si = age => w.eval(`(function(){const r=window.Shaho.calculateShaho({monthlySalary:333333,targetMonth:'2026-07',prefSlug:'tokyo',age:${age},koyoCategory:'ippan'},SHAHO_DATA);return {h:r.health.employee,k:r.koseiNenkin.employee,y:r.koyo.employee};})()`);
const a69 = si(69), a70 = si(70), a75 = si(75);
A('69歳: 健康保険・厚生年金がかかる', a69.h > 0 && a69.k > 0);
A('70歳: 厚生年金 0・健康保険はかかる', a70.k === 0 && a70.h > 0);
A('75歳: 健康保険 0・厚生年金 0・雇用保険は残る', a75.h === 0 && a75.k === 0 && a75.y > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
