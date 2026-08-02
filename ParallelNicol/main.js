// 平行ニコル 3波長で次数を決める
//
// 平行ニコルで測れるのは c = cos(2πR/λ) だけ。単波長では次数 m が決まらず
// R = λ(m ± arccos(c)/2π) という候補列しか得られない。
// 590 / 610 / 630 nm の 3 波長で測ると、3 つの候補列がそろう R が 1 つに決まる。
//
// 判定指標は全体を通して D(R) = max_i |cos(2πR/λ_i) − c_i|（最大誤差）に統一してある。
// 「全波長で誤差が許容幅以内」という条件そのものなので、判定・グラフ・代表点選びで
// 別々の指標が混ざらない。

// ---------------------------------------------------------------- 定数

const LAMBDAS = [590, 610, 630];
// 実際の色だと 590/610/630 はどれも橙〜赤で見分けられないので、
// 波長の順序感（黄 → 橙 → 赤桃）は保ちつつ分離した 3 色を使う
const LAM_COLORS = ['#ffd166', '#ff8a5c', '#ff5c7a'];
const LAM_RGB = [[255, 209, 102], [255, 138, 92], [255, 92, 122]];

const R_MAX = 3000;          // 表示・探索するリタデーションの上限 [nm]
const SCAN_STEP = 0.05;      // 候補探索の刻み [nm]（静止時）
const SCAN_STEP_FAST = 0.25; // 掃引アニメ中の刻み（60fps を維持するため粗くする）
const SWEEP_NM_PER_SEC = 300;

const C_MATCH = '#36d1c4';   // 測定から決まった候補（シアン）
const C_TRUE = '#8ecbff';    // 真の R（水色）
const C_GRID = '#2c313a';
const C_TEXT = '#9aa4b2';
const C_DIM = '#6d7684';

// 右余白は横軸の "3000" 目盛りと軸タイトル "R [nm]" が重ならない幅を確保する
const PAD = { l: 54, r: 58, t: 32, b: 24 };

// ---------------------------------------------------------------- 状態

const state = {
  R: 1400,
  use: [true, true, true],
  tol: 0.05,
  nicol: 'parallel',   // 'parallel' | 'crossed'
  yMode: 'c',          // 'c' | 'T'
  showOrder: true,
  focusLam: 0,
  playing: false,
  speed: 1,
  // 以下は refresh() が埋める導出量
  cMeas: [0, 0, 0],
  cands: [[], [], []],
  matches: [],
};

// ---------------------------------------------------------------- 物理

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** リタデーション R [nm] を波長 λ [nm] で測ったときの c = cos(2πR/λ) */
function cOf(R, lam) {
  return Math.cos(2 * Math.PI * R / lam);
}

/**
 * 試料を 45° に置いたときの透過率。
 * 平行ニコル T∥ = (1+c)/2、直交ニコル T⊥ = (1−c)/2
 */
function tOf(c) {
  return state.nicol === 'parallel' ? (1 + c) / 2 : (1 - c) / 2;
}

/**
 * 試料の方位角 θ を回したときの透過率（極座標グラフの動径）。
 *   T∥(θ) = 1 − sin²2θ · sin²(δ/2),  T⊥(θ) = sin²2θ · sin²(δ/2)
 * sin²(δ/2) = (1−c)/2 なので c だけで決まる。θ = 45° で tOf(c) に一致する。
 */
function tAzimuth(c, theta) {
  const s = Math.sin(2 * theta) ** 2 * (1 - c) / 2;
  return state.nicol === 'parallel' ? 1 - s : s;
}

/** グラフ縦軸の値（c 表示か透過率表示か） */
function yValue(c) {
  return state.yMode === 'T' ? tOf(c) : c;
}

/** 真の R から各波長の測定値 c_i を作る（測定者にはここから先しか見えない） */
function measure() {
  state.cMeas = LAMBDAS.map((lam) => cOf(state.R, lam));
}

/**
 * 波長ごとの候補列 R = λ(m ± α/2π), α = arccos(c)。
 * α = 0 / 0.5 のときは ± が縮退するので重複を除く。
 */
function buildCandidates() {
  return LAMBDAS.map((lam, i) => {
    const a = Math.acos(clamp(state.cMeas[i], -1, 1)) / (2 * Math.PI); // 0..0.5
    const out = [];
    const seen = new Set();
    const mMax = Math.ceil(R_MAX / lam);
    for (let m = 0; m <= mMax; m++) {
      for (const s of [-1, 1]) {
        const R = lam * (m + s * a);
        if (R < -1e-9 || R > R_MAX) continue;
        const key = Math.max(0, R).toFixed(3);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ R: Math.max(0, R), m, branch: s < 0 ? '−' : '+' });
      }
    }
    out.sort((p, q) => p.R - q.R);
    return out;
  });
}

/** D(R) = max_i |cos(2πR/λ_i) − c_i|（有効な波長のみ）。波長が 0 本なら NaN */
function maxDev(R) {
  let d = 0;
  let n = 0;
  for (let i = 0; i < 3; i++) {
    if (!state.use[i]) continue;
    n++;
    const dev = Math.abs(cOf(R, LAMBDAS[i]) - state.cMeas[i]);
    if (dev > d) d = dev;
  }
  return n === 0 ? NaN : d;
}

/**
 * D(R) ≤ tol を満たす区間を走査し、区間ごとに D 最小の点を代表として返す。
 * lo / hi は区間の広がり＝「R がどこまで絞れたか」の幅。
 */
function scanMatches(step) {
  const out = [];
  if (!state.use.some(Boolean)) return out;
  const n = Math.round(R_MAX / step);
  let cur = null;
  for (let k = 0; k <= n; k++) {
    const R = k * step;
    const d = maxDev(R);
    if (d <= state.tol) {
      if (!cur) cur = { R, D: d, lo: R, hi: R };
      else {
        cur.hi = R;
        if (d < cur.D) { cur.D = d; cur.R = R; }
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- Canvas 下ごしらえ

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const rgba = (i, a) => `rgba(${LAM_RGB[i][0]},${LAM_RGB[i][1]},${LAM_RGB[i][2]},${a})`;

/** R [nm] → x ピクセル */
const xOfR = (R, w) => PAD.l + (R / R_MAX) * (w - PAD.l - PAD.r);

/** 横軸（R [nm]）の目盛りを描く */
function drawRAxis(ctx, w, h, yBase) {
  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 1;
  ctx.fillStyle = C_DIM;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let R = 0; R <= R_MAX; R += 500) {
    const x = xOfR(R, w);
    ctx.beginPath();
    ctx.moveTo(x, PAD.t);
    ctx.lineTo(x, yBase);
    ctx.stroke();
    ctx.fillText(String(R), x, yBase + 4);
  }
  ctx.textAlign = 'right';
  ctx.fillText('R [nm]', w - 4, yBase + 4);
}

/** 真の R とマッチ位置の縦線（3 グラフ共通の目印） */
function drawMarkerLines(ctx, w, top, bottom) {
  // 生き残った候補（シアン）
  ctx.setLineDash([]);
  for (const mt of state.matches) {
    const x = xOfR(mt.R, w);
    ctx.strokeStyle = C_MATCH;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  // 真の R（水色・破線）。既定では候補と重なる
  const xt = xOfR(state.R, w);
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = C_TRUE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(xt, top);
  ctx.lineTo(xt, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------- ① c–R 曲線

function drawCurves(canvas) {
  const { ctx, w, h } = setupCanvas(canvas);
  const yBase = h - PAD.b;
  const plotH = yBase - PAD.t;
  if (plotH < 20) return;

  const showT = state.yMode === 'T';
  const vMin = showT ? 0 : -1;
  const vMax = 1;
  const yOf = (v) => yBase - ((v - vMin) / (vMax - vMin)) * plotH;

  // 横グリッド
  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 1;
  ctx.fillStyle = C_DIM;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ticks = showT ? [0, 0.5, 1] : [-1, -0.5, 0, 0.5, 1];
  for (const v of ticks) {
    const y = yOf(v);
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), PAD.l - 6, y);
  }
  ctx.save();
  ctx.translate(13, PAD.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = C_TEXT;
  ctx.fillText(showT ? (state.nicol === 'parallel' ? '透過率 T∥' : '透過率 T⊥') : 'c = cos(2πR/λ)', 0, 0);
  ctx.restore();

  drawRAxis(ctx, w, h, yBase);

  // 各波長の曲線と測定値の水平線
  for (let i = 0; i < 3; i++) {
    const on = state.use[i];
    ctx.strokeStyle = on ? LAM_COLORS[i] : rgba(i, 0.16);
    ctx.lineWidth = on ? 1.6 : 1;
    ctx.beginPath();
    for (let x = PAD.l; x <= w - PAD.r; x++) {
      const R = ((x - PAD.l) / (w - PAD.l - PAD.r)) * R_MAX;
      const y = yOf(yValue(cOf(R, LAMBDAS[i])));
      if (x === PAD.l) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 測定値の水平線（この高さと曲線の交点が候補）
    const ym = yOf(yValue(state.cMeas[i]));
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = on ? rgba(i, 0.85) : rgba(i, 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, ym);
    ctx.lineTo(w - PAD.r, ym);
    ctx.stroke();
    ctx.setLineDash([]);

    // 交点＝候補
    if (on) {
      ctx.fillStyle = LAM_COLORS[i];
      for (const cd of state.cands[i]) {
        ctx.beginPath();
        ctx.arc(xOfR(cd.R, w), ym, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawMarkerLines(ctx, w, PAD.t, yBase);

  // 凡例（曲線と重なるので下敷きを敷く）
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const labels = LAMBDAS.map((l, i) => `${l}nm c=${fmtSigned(state.cMeas[i])}`);
  const legendW = labels.reduce((s, t) => s + ctx.measureText(t).width + 12, 4);
  ctx.fillStyle = 'rgba(23,27,33,0.82)';
  ctx.fillRect(PAD.l + 1, yBase - 16, legendW, 15);
  let lx = PAD.l + 5;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = state.use[i] ? LAM_COLORS[i] : rgba(i, 0.3);
    ctx.fillText(labels[i], lx, yBase - 14);
    lx += ctx.measureText(labels[i]).width + 12;
  }
}

// ---------------------------------------------------------------- ② 候補コム

function drawCombs(canvas) {
  const { ctx, w, h } = setupCanvas(canvas);
  const yBase = h - PAD.b;
  const plotH = yBase - PAD.t;
  if (plotH < 20) return;
  const rowH = plotH / 3;

  // 生き残った候補の帯（R がどこまで絞れたかの幅も見える）
  for (const mt of state.matches) {
    const x0 = xOfR(mt.lo, w);
    const x1 = xOfR(mt.hi, w);
    ctx.fillStyle = 'rgba(54,209,196,0.16)';
    ctx.fillRect(x0, PAD.t, Math.max(2, x1 - x0), plotH);
  }

  drawRAxis(ctx, w, h, yBase);

  for (let i = 0; i < 3; i++) {
    const on = state.use[i];
    const top = PAD.t + rowH * i;
    const base = top + rowH - 6;

    // 段のベースライン
    ctx.strokeStyle = C_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, base);
    ctx.lineTo(w - PAD.r, base);
    ctx.stroke();

    // 段の見出し
    ctx.fillStyle = on ? LAM_COLORS[i] : rgba(i, 0.3);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${LAMBDAS[i]} nm`, PAD.l - 6, base - rowH / 2 + 4);

    // 候補のチック
    const list = state.cands[i];
    const tickTop = top + 6;
    ctx.strokeStyle = on ? LAM_COLORS[i] : rgba(i, 0.18);
    ctx.lineWidth = on ? 1.8 : 1;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let k = 0; k < list.length; k++) {
      const x = xOfR(list[k].R, w);
      ctx.beginPath();
      ctx.moveTo(x, tickTop);
      ctx.lineTo(x, base);
      ctx.stroke();

      // 次数ラベル（隣と近すぎるときは省く）
      if (state.showOrder && on) {
        const prev = k > 0 ? xOfR(list[k - 1].R, w) : -1e9;
        const next = k < list.length - 1 ? xOfR(list[k + 1].R, w) : 1e9;
        if (x - prev > 22 && next - x > 22) {
          ctx.fillStyle = rgba(i, 0.85);
          ctx.fillText(`${list[k].m}${list[k].branch}`, x, tickTop - 1);
        }
      }
    }
  }

  drawMarkerLines(ctx, w, PAD.t, yBase);
}

// ---------------------------------------------------------------- ③ 一致度 D(R)

// D は 0 付近が肝心なので、平方根スケールで小さい側を引き伸ばす
const D_MAX = 2;
const dScale = (D) => Math.sqrt(clamp(D, 0, D_MAX) / D_MAX);

function drawMatch(canvas) {
  const { ctx, w, h } = setupCanvas(canvas);
  const yBase = h - PAD.b;
  const plotH = yBase - PAD.t;
  if (plotH < 20) return;
  const yOfD = (D) => yBase - dScale(D) * plotH;

  // 許容幅の内側（生き残る領域）を塗る
  for (const mt of state.matches) {
    const x0 = xOfR(mt.lo, w);
    const x1 = xOfR(mt.hi, w);
    ctx.fillStyle = 'rgba(54,209,196,0.16)';
    ctx.fillRect(x0, PAD.t, Math.max(2, x1 - x0), plotH);
  }

  // 横グリッド（平方根スケールなので目盛り値を明示する）
  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 1;
  ctx.fillStyle = C_DIM;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, 0.05, 0.1, 0.2, 0.5, 1, 2]) {
    const y = yOfD(v);
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(2), PAD.l - 6, y);
  }

  drawRAxis(ctx, w, h, yBase);

  if (state.use.some(Boolean)) {
    // D(R) 曲線
    ctx.strokeStyle = '#cdd3dc';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = PAD.l; x <= w - PAD.r; x++) {
      const R = ((x - PAD.l) / (w - PAD.l - PAD.r)) * R_MAX;
      const y = yOfD(maxDev(R));
      if (x === PAD.l) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 許容幅の水平線
    const yt = yOfD(state.tol);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = C_MATCH;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(PAD.l, yt);
    ctx.lineTo(w - PAD.r, yt);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C_MATCH;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`許容幅 ±${state.tol.toFixed(3)}`, PAD.l + 4, yt - 2);
  } else {
    ctx.fillStyle = C_DIM;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('波長を 1 つ以上選んでください', (PAD.l + w - PAD.r) / 2, PAD.t + plotH / 2);
  }

  drawMarkerLines(ctx, w, PAD.t, yBase);
}

// ---------------------------------------------------------------- ① 極座標（試料を回したときの透過率）

/**
 * 波長ごとに 1 枚。3 波長を重ね書きすると形の違いが読めないので必ず別カードに描く。
 * 極座標の向きは姉妹アプリ（MOA）と同じで 0° = 上、左回り（反時計回り）が正。
 */
function drawPolarCard(canvas, i) {
  const { ctx, w, h } = setupCanvas(canvas);
  const on = state.use[i];
  const c = state.cMeas[i];
  const t45 = tOf(c);

  // 左に数値、右に円（位相円と同じ流儀）
  const cx = w * 0.66;
  const cy = h / 2 + 4;
  const rOut = Math.min(w * 0.30, (h - 26) * 0.46);
  // 0° = 上、左回りが正
  const px = (th, r) => cx - r * Math.sin(th);
  const py = (th, r) => cy - r * Math.cos(th);

  // 目盛り円（T = 1 と T = 0.5）
  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 1;
  for (const t of [1, 0.5]) {
    ctx.setLineDash(t === 1 ? [] : [3, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, rOut * t, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 45° ごとのスポークと角度ラベル
  ctx.fillStyle = C_DIM;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let deg = 0; deg < 360; deg += 45) {
    const th = (deg * Math.PI) / 180;
    ctx.strokeStyle = C_GRID;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px(th, rOut), py(th, rOut));
    ctx.stroke();
    ctx.fillText(`${deg}°`, px(th, rOut + 12), py(th, rOut + 12));
  }

  // T(θ) の曲線
  ctx.beginPath();
  const N = 240;
  for (let k = 0; k <= N; k++) {
    const th = (2 * Math.PI * k) / N;
    const r = rOut * tAzimuth(c, th);
    const x = px(th, r);
    const y = py(th, r);
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(i, on ? 0.2 : 0.06);
  ctx.fill();
  ctx.strokeStyle = on ? LAM_COLORS[i] : rgba(i, 0.22);
  ctx.lineWidth = on ? 1.8 : 1;
  ctx.stroke();

  // 測定点（45°）― ここが c を与える 1 点
  const th45 = Math.PI / 4;
  const r45 = rOut * t45;
  ctx.strokeStyle = C_MATCH;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(px(th45, rOut), py(th45, rOut));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C_MATCH;
  ctx.beginPath();
  ctx.arc(px(th45, r45), py(th45, r45), 3.6, 0, Math.PI * 2);
  ctx.fill();

  // 文字（左半分）
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '12px sans-serif';
  ctx.fillStyle = on ? LAM_COLORS[i] : rgba(i, 0.4);
  ctx.fillText(`${LAMBDAS[i]} nm`, 10, 10);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = C_TEXT;
  ctx.fillText(`c = ${fmtSigned(c)}`, 10, 30);
  ctx.fillStyle = C_MATCH;
  ctx.fillText(`${state.nicol === 'parallel' ? 'T∥' : 'T⊥'}(45°) = ${t45.toFixed(3)}`, 10, 48);
  ctx.fillStyle = C_DIM;
  ctx.font = '10px sans-serif';
  ctx.fillText('外円 = T 1.0 / 破線 = 0.5', 10, h - 36);
  ctx.fillText('0° = 偏光子軸、左回りが正', 10, h - 22);
  if (!on) {
    ctx.fillStyle = C_TEXT;
    ctx.font = '11px sans-serif';
    ctx.fillText('（この波長は未使用）', 10, 68);
  }
}

// ---------------------------------------------------------------- 位相円（次数 = 巻き数）

function drawPhasor(canvas) {
  const { ctx, w, h } = setupCanvas(canvas);
  const i = state.focusLam;
  const lam = LAMBDAS[i];
  const turns = state.R / lam;           // δ/2π
  const m = Math.floor(turns + 1e-12);   // 次数
  const delta = 2 * Math.PI * turns;

  // 左半分に文字、右半分に円を置いて重ならないようにする
  const cx = w * 0.68;
  const cy = h / 2;
  const rOut = Math.min(w * 0.28, h * 0.40);
  const rIn = rOut * 0.30;

  // 外周（単位円）と軸
  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - rOut - 6, cy);
  ctx.lineTo(cx + rOut + 6, cy);
  ctx.moveTo(cx, cy - rOut - 6);
  ctx.lineTo(cx, cy + rOut + 6);
  ctx.stroke();

  // δ を 0 から現在値まで回したらせん。1 周ごとに半径が増えるので巻き数が数えられる
  const ang = (t) => -2 * Math.PI * t;   // 反時計回りを正にする（画面 y は下向き）
  const rad = (t) => (turns > 1e-9 ? rIn + (rOut - rIn) * (t / turns) : rOut);
  if (turns > 1e-9) {
    ctx.strokeStyle = rgba(i, 0.85);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const steps = Math.max(64, Math.ceil(turns * 180));
    for (let k = 0; k <= steps; k++) {
      const t = (turns * k) / steps;
      const r = rad(t);
      const x = cx + r * Math.cos(ang(t));
      const y = cy + r * Math.sin(ang(t));
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 現在の位相ベクトル（先端は外周上にある）
  const tipX = cx + rOut * Math.cos(ang(turns));
  const tipY = cy + rOut * Math.sin(ang(turns));
  ctx.strokeStyle = LAM_COLORS[i];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = LAM_COLORS[i];
  ctx.beginPath();
  ctx.arc(tipX, tipY, 3.4, 0, Math.PI * 2);
  ctx.fill();

  // ± の折り返し縮退：−δ も同じ c を与える
  const mirX = cx + rOut * Math.cos(-ang(turns));
  const mirY = cy + rOut * Math.sin(-ang(turns));
  ctx.strokeStyle = rgba(i, 0.5);
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(mirX, mirY);
  ctx.stroke();
  ctx.setLineDash([]);

  // x 射影 = c（測定できるのはこれだけ）
  ctx.strokeStyle = C_MATCH;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C_MATCH;
  ctx.beginPath();
  ctx.arc(tipX, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // 文字
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = LAM_COLORS[i];
  ctx.fillText(`λ = ${lam} nm`, 8, 8);
  ctx.fillStyle = C_TEXT;
  ctx.fillText(`δ/2π = ${turns.toFixed(3)}`, 8, 24);
  ctx.fillStyle = C_TRUE;
  ctx.fillText(`次数 m = ${m}`, 8, 40);
  ctx.fillStyle = C_DIM;
  ctx.fillText(`（${m} 周と ${(turns - m).toFixed(3)}）`, 8, 56);
  ctx.fillStyle = C_MATCH;
  ctx.fillText(`c = ${fmtSigned(state.cMeas[i])}`, 8, 76);
}

// ---------------------------------------------------------------- 表示更新

const fmtSigned = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3);

function updateStatus() {
  const nUse = state.use.filter(Boolean).length;
  const used = LAMBDAS.filter((_, i) => state.use[i]).join(' / ');
  const lines = [];

  lines.push(`測定値 c　${LAMBDAS.map((l, i) => `${l}:${fmtSigned(state.cMeas[i])}`).join('　')}`);
  lines.push(`使用波長　${nUse} 本${nUse ? `（${used} nm）` : ''}`);

  if (nUse === 0) {
    lines.push('候補　　　― 波長を選んでください');
  } else {
    const ms = state.matches;
    lines.push(`候補　　　${ms.length} 本`);
    if (ms.length === 0) {
      lines.push('　許容幅が狭すぎます（探索刻みより細い谷）');
    } else if (ms.length <= 6) {
      for (const mt of ms) {
        const half = (mt.hi - mt.lo) / 2;
        const hit = Math.abs(mt.R - state.R) < Math.max(1, half) ? ' ←真値' : '';
        lines.push(`　R = ${mt.R.toFixed(1)} nm（幅 ±${half.toFixed(1)}）${hit}`);
      }
    } else {
      lines.push(`　${ms.slice(0, 4).map((mt) => mt.R.toFixed(0)).join(', ')} … ほか ${ms.length - 4} 本`);
    }
  }
  lines.push(`真の R 　 ${state.R.toFixed(1)} nm`);

  if (nUse > 0 && state.matches.length === 1) {
    lines.push('→ 次数が決まりました');
  } else if (nUse === 1) {
    lines.push('→ 単波長では次数が決まりません');
  } else if (nUse > 1 && state.matches.length > 1) {
    lines.push('→ 誤差の許容幅に対して波長が足りません');
  }

  el.status.textContent = lines.join('\n');
}

function refresh() {
  measure();
  state.cands = buildCandidates();
  state.matches = scanMatches(state.playing ? SCAN_STEP_FAST : SCAN_STEP);
  for (let i = 0; i < 3; i++) drawPolarCard(el.polar[i], i);
  drawCurves(el.curves);
  drawCombs(el.combs);
  drawMatch(el.match);
  drawPhasor(el.phasor);
  updateStatus();
}

// ---------------------------------------------------------------- DOM

const el = {
  R: document.getElementById('R'),
  Rnum: document.getElementById('Rnum'),
  tol: document.getElementById('tol'),
  tolVal: document.getElementById('tolVal'),
  use: [0, 1, 2].map((i) => document.getElementById(`use${i}`)),
  showOrder: document.getElementById('showOrder'),
  focusBtns: document.getElementById('focusBtns'),
  nicolBtns: document.getElementById('nicolBtns'),
  yBtns: document.getElementById('yBtns'),
  playBtn: document.getElementById('playBtn'),
  speed: document.getElementById('speed'),
  speedVal: document.getElementById('speedVal'),
  status: document.getElementById('status'),
  polar: [0, 1, 2].map((i) => document.getElementById(`polar${i}`)),
  curves: document.getElementById('curves'),
  combs: document.getElementById('combs'),
  match: document.getElementById('match'),
  phasor: document.getElementById('phasor'),
};

function setR(v) {
  state.R = clamp(Number(v) || 0, 0, R_MAX);
  el.R.value = String(state.R);
  el.Rnum.value = state.R.toFixed(1).replace(/\.0$/, '');
}

el.R.addEventListener('input', () => { setR(el.R.value); refresh(); });
el.Rnum.addEventListener('input', () => { setR(el.Rnum.value); refresh(); });

el.tol.addEventListener('input', () => {
  state.tol = Number(el.tol.value);
  el.tolVal.textContent = `±${state.tol.toFixed(3)}`;
  refresh();
});

el.use.forEach((cb, i) => {
  cb.addEventListener('change', () => { state.use[i] = cb.checked; refresh(); });
});

el.showOrder.addEventListener('change', () => { state.showOrder = el.showOrder.checked; refresh(); });

function wireBtnGroup(group, attr, apply) {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const b of group.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    apply(btn.dataset[attr]);
    refresh();
  });
}
wireBtnGroup(el.focusBtns, 'lam', (v) => { state.focusLam = Number(v); });
wireBtnGroup(el.nicolBtns, 'nicol', (v) => { state.nicol = v; });
wireBtnGroup(el.yBtns, 'y', (v) => { state.yMode = v; });

el.playBtn.addEventListener('click', () => {
  state.playing = !state.playing;
  el.playBtn.textContent = state.playing ? '⏸ 一時停止' : '▶ 再生';
  refresh();
});

el.speed.addEventListener('input', () => {
  state.speed = Number(el.speed.value);
  el.speedVal.textContent = `${state.speed.toFixed(1)}×`;
});

// ---------------------------------------------------------------- ループ

let last = performance.now();
let lastW = 0;
let lastH = 0;

function render(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  let dirty = false;

  if (state.playing && state.speed > 0) {
    let R = state.R + SWEEP_NM_PER_SEC * state.speed * dt;
    if (R > R_MAX) R -= R_MAX;
    setR(R);
    dirty = true;
  }

  // リサイズ検出（Canvas は CSS で伸縮するので実サイズの変化を見る）
  const rect = el.curves.getBoundingClientRect();
  if (Math.round(rect.width) !== lastW || Math.round(rect.height) !== lastH) {
    lastW = Math.round(rect.width);
    lastH = Math.round(rect.height);
    dirty = true;
  }

  if (dirty) refresh();
  requestAnimationFrame(render);
}

// ---------------------------------------------------------------- 起動

setR(state.R);
el.tolVal.textContent = `±${state.tol.toFixed(3)}`;
el.speedVal.textContent = `${state.speed.toFixed(1)}×`;
refresh();
requestAnimationFrame(render);
