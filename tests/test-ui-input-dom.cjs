/**
 * test-ui-input-dom.cjs — 奨学金かんたん計算（index.html）の入力 UI を jsdom で検証。
 *
 * 1. 埋め込みの共通入力 UI が kokuho-core/js/core/shared/ui-input.js と一字一句同じ（無改変の複製）
 * 2. Enter で次の欄へ（data-step の段・横枠順）。非表示モードの欄・閉じた details の中は飛ばす
 * 3. IME 確定の Enter（isComposing / keyCode 229）では動かない
 * 4. 数値欄: 全角→半角・blur でカンマ・先頭ゼロ除去
 * 5. 旧実装（DOM 順の Enter 移動・restore タイマー）が残っていない
 *
 * 実行（jsdom は kokuho-core の node_modules を借りる）:
 *   NODE_PATH=../kokuho-core/node_modules node tests/test-ui-input-dom.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const CORE_UI = path.join(ROOT, '..', 'kokuho-core', 'js', 'core', 'shared', 'ui-input.js');

let pass = 0, fail = 0;
const A = (label, cond) => { console.log(`${cond ? '✓' : '✗'} ${label}`); cond ? pass++ : fail++; };

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script async src="https:\/\/www\.googletagmanager[^<]*<\/script>/g, '');

// 1. 複製が無改変か
if (fs.existsSync(CORE_UI)) {
  const core = fs.readFileSync(CORE_UI, 'utf8');
  A('共通入力 UI の複製が kokuho-core の原本と一致', html.includes(core));
} else {
  console.log('… kokuho-core が隣に無いため原本との一致は未検査');
}
A('旧 Enter ハンドラ（readonly 小技）が残っていない', !html.includes("setAttribute('readonly','readonly')"));
A('旧 restore タイマーが残っていない', !/setTimeout\(restore,/.test(html));
A('data-step-end の欄が 1 つ', (html.match(/<(?:input|select)[^>]*\sdata-step-end/g) || []).length === 1);

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window, d = w.document;
Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', { get() {
  for (let n = this; n; n = n.parentElement) if (n.style && n.style.display === 'none') return null;
  return this.parentNode;
} });

function enter(id, extra) {
  const el = d.getElementById(id); el.focus();
  el.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: 'Enter', bubbles: true, cancelable: true }, extra || {})));
  return d.activeElement && d.activeElement.id;
}
const set = (id, v) => { const el = d.getElementById(id); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); return el; };

(async () => {
  if (d.readyState === 'loading') await new Promise(r => d.addEventListener('DOMContentLoaded', r));
  A('共通 UI が読み込まれている', typeof w.setupEnterFlow === 'function');

  // かんたん判定
  A('かんたん: 都道府県 → 年収1', enter('pref-sel') === 's-inc1');
  A('かんたん: 年収1 → 年収2', enter('s-inc1') === 's-inc2');
  A('かんたん: 年収2 → 子の人数（詳細モードの欄は飛ばす）', enter('s-inc2') === 'children');
  A('IME 確定（isComposing）: 動かない', enter('s-inc1', { isComposing: true }) === 's-inc1');
  A('IME 確定（keyCode 229）: 動かない', enter('s-inc1', { keyCode: 229 }) === 's-inc1');
  let el = set('s-inc1', '４５０００００');
  A('入力中: 全角→半角、カンマ無し', el.value === '4500000');
  el.dispatchEvent(new w.Event('blur'));
  A('blur: カンマ付与', el.value === '4,500,000');
  el = set('s-inc2', '00'); el.dispatchEvent(new w.Event('blur'));
  A('blur: 00 → 0', el.value === '0');

  // 詳細判定
  w.setMode('exact');
  A('詳細: 生計維持者の欄に id と data-step がある', !!d.getElementById('sup0-salary') && d.getElementById('sup0-salary').getAttribute('data-step') === '10');
  A('詳細: 扶養 4a → 4b → 4c', enter('hh-minor') === 'hh-general' && enter('hh-general') === 'hh-specific');
  A('詳細: 4c → 生計維持者1 年収（10）', enter('hh-specific') === 'sup0-salary');
  A('詳細: 年収 → 年齢 → 社会保険料', enter('sup0-salary') === 'sup0-age' && enter('sup0-age') === 'sup0-socialInsurance');
  A('詳細: 社会保険料 → 生計維持者2 年収（閉じた「くわしい入力」は飛ばす）', enter('sup0-socialInsurance') === 'sup1-salary');
  d.querySelector('#supporters .supporter details').open = true;
  A('詳細: 「くわしい入力」を開けば年金（13）に止まる', enter('sup0-socialInsurance') === 'sup0-pension');
  el = set('sup0-salary', '４５０００００'); el.dispatchEvent(new w.Event('blur'));
  A('詳細: 生計維持者の年収も全角→半角・カンマ', el.value === '4,500,000');
  // 「生計維持者が1人」に切り替えて再生成しても設定が効く
  d.getElementById('e-single').checked = true; w.renderSupporters();
  el = set('sup0-salary', '３０００００'); el.dispatchEvent(new w.Event('blur'));
  A('再生成後の欄にも数値欄設定が効く', el.value === '300,000');
  A('再生成後: 生計維持者2 は無い', !d.getElementById('sup1-salary'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
