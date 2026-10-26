/**
 * test-senior-si-note.cjs — 詳細判定で、65歳以上・社会保険料が空欄のときに注記が出ることを jsdom で検証。
 *   65〜74歳＝介護保険料が入らない旨、75歳以上＝後期高齢者医療と介護保険料が入らない旨。
 *   社会保険料を入れた・64歳以下・年齢空欄では出ない。計算結果は変えない。
 *
 * 実行（jsdom は kokuho-core の node_modules を借りる）:
 *   NODE_PATH=../kokuho-core/node_modules node tests/test-senior-si-note.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const A = (label, cond) => { console.log(`${cond ? '✓' : '✗'} ${label}`); cond ? pass++ : fail++; };

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script async src="https:\/\/www\.googletagmanager[^<]*<\/script>/g, '');
const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push(String(e.message || e)));
const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://shogakukin-keisan.jp/' }).window;
const d = w.document, $ = id => d.getElementById(id);
A('スクリプトのエラーが出ない', errs.length === 0);

w.eval("setMode('exact')");
function set(i, age, si) {
  $(`sup${i}-salary`).value = '3,000,000';
  $(`sup${i}-age`).value = age;
  $(`sup${i}-socialInsurance`).value = si;
  w.eval('render()');
  const el = $(`sup${i}-siSenior`);
  return { shown: el.style.display !== 'none', text: el.textContent, result: $('result').textContent };
}
A('注記の枠が生計維持者ごとにある', !!$('sup0-siSenior') && !!$('sup1-siSenior'));
let r = set(0, '64', '');
A('64歳・空欄: 出ない', !r.shown);
r = set(0, '', '');
A('年齢空欄: 出ない', !r.shown);
r = set(0, '65', '');
A('65歳・空欄: 介護保険料の注記', r.shown && /介護保険料/.test(r.text) && !/後期高齢者医療/.test(r.text));
r = set(0, '74', '');
A('74歳・空欄: 介護保険料の注記', r.shown && /介護保険料/.test(r.text) && !/後期高齢者医療/.test(r.text));
r = set(0, '75', '');
A('75歳・空欄: 後期高齢者医療と介護保険の注記', r.shown && /後期高齢者医療/.test(r.text) && /介護保険/.test(r.text));
r = set(0, '75', '300,000');
A('75歳・社会保険料を入力: 出ない', !r.shown);
r = set(1, '80', '');
A('生計維持者2 にも出る', r.shown && /後期高齢者医療/.test(r.text));
r = set(0, '75', '');
w.eval('window.updateSeniorSiNotes = function(){}; render()');
A('注記の有無で計算結果は変わらない（注記を止めても同じ表示）', $('result').textContent === r.result);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
