import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// =====================================================================
// 分子配向計（MOA）: 3D の共振曲線群 ↔ 配向パターンの関係を可視化する
//   3D  : 試料 1 回転中の共振曲線（f × θ × 透過マイクロ波強度）
//   断面: f = fm で切った強度カーブ I(θ)
//   極座標: I(θ) を巻き取ったもの ＝ 配向パターン（長軸 = 配向角、max/min = MOR）
// =====================================================================

// ---------- 物理モデルの定数 ----------
const FR0     = 4000;   // 平均誘電率のときの共振周波数 [MHz]
const EPS_AVE = 4.06;   // 平均誘電率 ε′（資料の GFRP 例に合わせた値）
const KF      = 3.0;    // ε′ が 1 増えるときの共振周波数の下がり幅 [MHz]
const F_LO    = 3995;   // 表示する周波数範囲 [MHz]
const F_HI    = 4005;

// ---------- 表示（3D）の定数 ----------
const N_THETA = 36;     // 3D に描く共振曲線の本数（10° 刻み）
const M_F     = 121;    // 共振曲線 1 本あたりの周波数サンプル数
const N_CUT   = 145;    // 断面カーブのサンプル数（2.5° 刻み）
const X_HALF  = 6.4;    // 周波数軸の半長
const Z_HALF  = 5.2;    // 回転角軸の半長
const Y_MAX   = 4.2;    // 強度 1.0 の高さ
const POLAR_R = 2.1;    // 巻き取ったときの極座標半径（3D 内）
const POLAR_CY = Y_MAX * 0.575; // 巻き取り先の中心（fm 断面プレーンの中心に合わせる）
const POLAR_CZ = 0;             // 同じく z

const COL_CURVE = 0x6d8299;  // 共振曲線群
const COL_SURF  = 0x232f3d;  // 面（陰線処理用）
const COL_CUR   = 0xffd166;  // 現在の θ
const COL_CUT   = 0x36d1c4;  // f = fm の断面 ＝ 配向パターン
const COL_PLANE = 0x8ecbff;  // 断面プレーン
const COL_AXIS  = 0x556072;

const CSS_CUR = '#ffd166', CSS_CUT = '#36d1c4', CSS_PLANE = '#8ecbff';
const CSS_GRID = '#2c313a', CSS_TEXT = '#9aa4b2', CSS_MUTED = '#6d7684';

const DEG = Math.PI / 180;

// ---------- 状態 ----------
const st = {
  phi0: 30,        // 配向角 φ0 [deg]
  dEps: 0.30,      // 誘電率異方性 Δε′
  Q: 2000,         // 空洞共振器の Q 値
  fm: 4001.45,     // 測定周波数 [MHz]（computeFm() が自動決定する）
  theta: 0,        // 試料の回転角 [deg]
  playing: true,
  speed: 1,
  morph: 0,        // 巻き取り 0..1（現在値）
  morphTarget: 0,  // 巻き取りの目標値
  showPlane: true,
  showCut: true,
  showSurf: true,
};

// ---------- 物理モデル ----------
// 電界方向の誘電率: 配向方向（θ = φ0）で最大、その 90° 側で最小
function epsAt(thetaDeg) {
  return EPS_AVE + (st.dEps / 2) * Math.cos(2 * (thetaDeg - st.phi0) * DEG);
}
// 摂動法: ε′ が大きいほど共振周波数は下がる
function frAt(thetaDeg) {
  return FR0 - KF * (epsAt(thetaDeg) - EPS_AVE);
}
// 共振曲線（ローレンツ型）。半値半幅 = fr / (2Q)
function intensityAt(f, thetaDeg) {
  const fr = frAt(thetaDeg);
  const x = (f - fr) / (fr / (2 * st.Q));
  return 1 / (1 + x * x);
}
// 測定周波数 fm の決め方（実機の設定手順）:
//   1回転中で共振周波数が最も高くなる θ（＝ ε′ が最小の θ = φ0 + 90°）のピークを選び、
//   その「高周波数側の半値（高さ 1/2）」の位置を fm とする。
//   ローレンツ型では半値は fr ± 半値半幅なので fm = frMax + frMax/(2Q)。
//   fm は必ず全ピークより高周波側にあるため、ε′ が小さい向き（＝配向と直交する向き）ほど
//   共振周波数が fm に近づいて強度が大きくなる → パターンの長軸は配向角と直交する。
function frMaxAngle() { return st.phi0 + 90; }
function computeFm() {
  const frMax = frAt(frMaxAngle());
  return frMax + frMax / (2 * st.Q);
}

// ---------- 座標変換（3D） ----------
const xOfF = f => ((f - F_LO) / (F_HI - F_LO) - 0.5) * 2 * X_HALF;
const zOfTheta = deg => Z_HALF - (deg / 360) * 2 * Z_HALF;   // θ=0 が手前
const yOfI = I => I * Y_MAX;

// =====================================================================
// シーン構築
// =====================================================================
const viewEl = document.getElementById('view3d');
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('gl'), antialias: true,
});
renderer.setPixelRatio(window.devicePixelRatio || 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(6, 10, 8);
scene.add(dirLight);

const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minDistance = 6;
controls.maxDistance = 90;

function makeTextSprite(text, color, scale = 0.4) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const tex = new THREE.CanvasTexture(cv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false,
  }));
  sprite.scale.set(scale * 4, scale, 1);
  sprite.userData.setText = (t) => {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = 'bold 60px "Hiragino Sans","Noto Sans JP",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(t, 256, 64);
    tex.needsUpdate = true;
  };
  sprite.userData.setText(text);
  return sprite;
}
// 軸まわりのラベルは axes グループに入れる（巻き取り時にまとめて隠すため）
function addLabel(text, color, pos, scale) {
  const s = makeTextSprite(text, color, scale);
  s.position.copy(pos);
  axes.add(s);
  return s;
}
function lineFromPoints(pts, color, opacity = 1) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

// ---------- 座標軸・目盛り ----------
const axes = new THREE.Group();
scene.add(axes);

// 底面（f–θ 平面）の枠
axes.add(lineFromPoints([
  new THREE.Vector3(-X_HALF, 0,  Z_HALF), new THREE.Vector3( X_HALF, 0,  Z_HALF),
  new THREE.Vector3( X_HALF, 0, -Z_HALF), new THREE.Vector3(-X_HALF, 0, -Z_HALF),
  new THREE.Vector3(-X_HALF, 0,  Z_HALF),
], COL_AXIS, 0.65));

// θ の補助線（90° ごと）と目盛りラベル
for (const deg of [0, 90, 180, 270, 360]) {
  const z = zOfTheta(deg);
  axes.add(lineFromPoints([
    new THREE.Vector3(-X_HALF, 0, z), new THREE.Vector3(X_HALF, 0, z),
  ], COL_AXIS, deg % 180 === 0 ? 0.5 : 0.3));
  addLabel(`${deg}°`, '#8a94a3', new THREE.Vector3(X_HALF + 0.9, 0.05, z), 0.34);
}
// 強度軸
axes.add(lineFromPoints([
  new THREE.Vector3(-X_HALF, 0, Z_HALF), new THREE.Vector3(-X_HALF, Y_MAX * 1.08, Z_HALF),
], COL_AXIS, 0.65));
// f の目盛り
for (const f of [3996, 3998, 4002, 4004]) {
  const x = xOfF(f);
  axes.add(lineFromPoints([
    new THREE.Vector3(x, 0, Z_HALF), new THREE.Vector3(x, 0, Z_HALF + 0.28),
  ], COL_AXIS, 0.6));
  addLabel(`${f}`, '#7c8694', new THREE.Vector3(x, 0.02, Z_HALF + 0.95), 0.3);
}
addLabel('f（周波数）[MHz]', CSS_TEXT, new THREE.Vector3(0, 0.05, Z_HALF + 1.85), 0.4);
addLabel('θ（回転角）', CSS_TEXT, new THREE.Vector3(X_HALF + 1.35, 0.05, 0), 0.4);
addLabel('透過マイクロ波強度', CSS_TEXT,
  new THREE.Vector3(-X_HALF + 2.9, Y_MAX * 1.16, Z_HALF), 0.4);

// ---------- 共振曲線群（ウォーターフォール）と面 ----------
const curveLines = [];
for (let j = 0; j <= N_THETA; j++) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M_F * 3), 3));
  const line = new THREE.Line(geom,
    new THREE.LineBasicMaterial({ color: COL_CURVE, transparent: true, opacity: 0.95 }));
  curveLines.push(line);
  scene.add(line);
}

// 面（後ろの曲線を隠すための陰線処理）
const surfGeom = new THREE.BufferGeometry();
surfGeom.setAttribute('position',
  new THREE.BufferAttribute(new Float32Array((N_THETA + 1) * M_F * 3), 3));
{
  const idx = [];
  for (let j = 0; j < N_THETA; j++) {
    for (let i = 0; i < M_F - 1; i++) {
      const a = j * M_F + i, b = a + 1, c = a + M_F, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  surfGeom.setIndex(idx);
}
const surface = new THREE.Mesh(surfGeom, new THREE.MeshStandardMaterial({
  color: COL_SURF, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
  transparent: true, opacity: 0.97,
  polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 1.5,
}));
scene.add(surface);

// ---------- 現在の θ の共振曲線（強調） ----------
const curGeom = new THREE.BufferGeometry();
curGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M_F * 3), 3));
const curLine = new THREE.Line(curGeom, new THREE.LineBasicMaterial({ color: COL_CUR }));
scene.add(curLine);
// 現在の θ の位置を底面に示す線
const curBase = lineFromPoints([new THREE.Vector3(), new THREE.Vector3()], COL_CUR, 0.4);
scene.add(curBase);

// ---------- f = fm の断面プレーン ----------
const planeMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(2 * Z_HALF, Y_MAX * 1.15),
  new THREE.MeshBasicMaterial({
    color: COL_PLANE, transparent: true, opacity: 0.09,
    side: THREE.DoubleSide, depthWrite: false,
  }));
planeMesh.rotation.y = Math.PI / 2;      // YZ 面へ（法線を f 軸に向ける）
scene.add(planeMesh);
const planeEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(planeMesh.geometry),
  new THREE.LineBasicMaterial({ color: COL_PLANE, transparent: true, opacity: 0.45 }));
planeEdge.rotation.y = Math.PI / 2;
scene.add(planeEdge);
const fmLabel = makeTextSprite('fm', CSS_PLANE, 0.36);
scene.add(fmLabel);

// ---------- 断面カーブ（巻き取りで極座標へ変形する） ----------
const cutGeom = new THREE.BufferGeometry();
cutGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_CUT * 3), 3));
// 面の上に乗るカーブなので、埋もれないよう深度テストなしで手前に描く
const cutLine = new THREE.Line(cutGeom,
  new THREE.LineBasicMaterial({ color: COL_CUT, depthTest: false }));
cutLine.renderOrder = 3;
scene.add(cutLine);

// 断面カーブの下側の塗り（直交では「カーテン」、巻き取り後は塗りつぶした配向パターン）
const cutFillGeom = new THREE.BufferGeometry();
cutFillGeom.setAttribute('position',
  new THREE.BufferAttribute(new Float32Array(N_CUT * 2 * 3), 3));
{
  const idx = [];
  for (let k = 0; k < N_CUT - 1; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  cutFillGeom.setIndex(idx);
}
const cutFill = new THREE.Mesh(cutFillGeom, new THREE.MeshBasicMaterial({
  color: COL_CUT, transparent: true, opacity: 0.16,
  side: THREE.DoubleSide, depthWrite: false,
}));
cutFill.renderOrder = 2;
scene.add(cutFill);

// 巻き取り先の極座標グリッド（morph に応じてフェードイン）
const polarGrid = new THREE.Group();
scene.add(polarGrid);
const polarGridMats = [];
for (const frac of [0.25, 0.5, 0.75, 1.0]) {
  const pts = [];
  for (let k = 0; k <= 72; k++) {
    const a = (k / 72) * 360 * DEG;
    pts.push(new THREE.Vector3(0, POLAR_CY + POLAR_R * frac * Math.cos(a),
      POLAR_CZ - POLAR_R * frac * Math.sin(a)));
  }
  const l = lineFromPoints(pts, COL_AXIS, 0);
  polarGridMats.push(l.material);
  polarGrid.add(l);
}
for (let a = 0; a < 180; a += 30) {
  const r = POLAR_R, rad = a * DEG;
  const l = lineFromPoints([
    new THREE.Vector3(0, POLAR_CY + r * Math.cos(rad), POLAR_CZ - r * Math.sin(rad)),
    new THREE.Vector3(0, POLAR_CY - r * Math.cos(rad), POLAR_CZ + r * Math.sin(rad)),
  ], COL_AXIS, 0);
  polarGridMats.push(l.material);
  polarGrid.add(l);
}
// 巻き取り後の角度目盛り（右上のグラフと同じ 0° 上・時計回り）
for (const a of [0, 90, 180, 270]) {
  const rad = a * DEG, r = POLAR_R + 0.45;
  const s = makeTextSprite(`${a}°`, '#8a94a3', 0.32);
  s.position.set(0, POLAR_CY + r * Math.cos(rad), POLAR_CZ - r * Math.sin(rad));
  s.material.opacity = 0;
  polarGridMats.push(s.material);
  polarGrid.add(s);
}

// ---------- 現在の測定点（3 つのグラフを結ぶマーカー） ----------
const marker = new THREE.Mesh(
  new THREE.SphereGeometry(0.15, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
marker.renderOrder = 4;
scene.add(marker);

// =====================================================================
// 計算結果のキャッシュ（断面の統計）
// =====================================================================
const cutTheta = new Float32Array(N_CUT);
const cutI = new Float32Array(N_CUT);
// angle = 配向角（長軸 + 90°）、longAxis = 強度が最大になる方向（パターンの長軸）
const cutStat = { max: 1, min: 0, thetaMax: 0, mor: 1, angle: 0, longAxis: 0 };

// 角度を (−90°, 90°] に畳む（軸は 180° 周期なので）
function foldAxisAngle(deg) {
  const a = ((deg % 180) + 180) % 180;
  return a > 90 ? a - 180 : a;
}

function recomputeCut() {
  let max = -Infinity, min = Infinity, thetaMax = 0;
  for (let k = 0; k < N_CUT; k++) {
    const th = (k / (N_CUT - 1)) * 360;
    const I = intensityAt(st.fm, th);
    cutTheta[k] = th; cutI[k] = I;
    if (I > max) { max = I; thetaMax = th; }
    if (I < min) { min = I; }
  }
  cutStat.max = max;
  cutStat.min = min;
  cutStat.thetaMax = thetaMax;
  cutStat.mor = min > 1e-9 ? max / min : Infinity;
  cutStat.longAxis = foldAxisAngle(thetaMax);        // 強度が最大になる方向
  cutStat.angle = foldAxisAngle(thetaMax + 90);      // 配向角 ＝ 長軸と直交する向き
}

// =====================================================================
// ジオメトリ更新
// =====================================================================
function rebuildSurface() {
  const surfPos = surfGeom.attributes.position.array;
  for (let j = 0; j <= N_THETA; j++) {
    const th = (j / N_THETA) * 360;
    const z = zOfTheta(th);
    const linePos = curveLines[j].geometry.attributes.position.array;
    for (let i = 0; i < M_F; i++) {
      const f = F_LO + (i / (M_F - 1)) * (F_HI - F_LO);
      const x = xOfF(f), y = yOfI(intensityAt(f, th));
      linePos[i * 3] = x; linePos[i * 3 + 1] = y; linePos[i * 3 + 2] = z;
      const o = (j * M_F + i) * 3;
      surfPos[o] = x; surfPos[o + 1] = y; surfPos[o + 2] = z;
    }
    curveLines[j].geometry.attributes.position.needsUpdate = true;
    curveLines[j].geometry.computeBoundingSphere();
  }
  surfGeom.attributes.position.needsUpdate = true;
  surfGeom.computeVertexNormals();
  surfGeom.computeBoundingSphere();
}

// 断面カーブ: 直交（f=fm 面上の I(θ) グラフ）↔ 極座標（配向パターン）を morph で補間
function updateCut() {
  const xfm = xOfF(st.fm);
  const m = st.morph;
  const pos = cutGeom.attributes.position.array;
  const fill = cutFillGeom.attributes.position.array;
  const norm = cutStat.max > 1e-9 ? cutStat.max : 1;
  for (let k = 0; k < N_CUT; k++) {
    const th = cutTheta[k], I = cutI[k];
    // A: 直交（3D の断面そのもの）
    const ay = yOfI(I), az = zOfTheta(th);
    // B: 極座標（0° が上、時計回りが正 ＝ 右上のグラフと同じ向き）
    const r = POLAR_R * (I / norm), rad = th * DEG;
    const by = POLAR_CY + r * Math.cos(rad);
    const bz = POLAR_CZ - r * Math.sin(rad);
    const y = ay + (by - ay) * m, z = az + (bz - az) * m;
    pos[k * 3] = xfm; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    // 塗りの下辺: 直交では底面（強度 0）、極座標では中心へ寄せる
    fill[k * 6] = xfm;
    fill[k * 6 + 1] = y;
    fill[k * 6 + 2] = z;
    fill[k * 6 + 3] = xfm;
    fill[k * 6 + 4] = 0 + (POLAR_CY - 0) * m;
    fill[k * 6 + 5] = az + (POLAR_CZ - az) * m;
  }
  cutGeom.attributes.position.needsUpdate = true;
  cutGeom.computeBoundingSphere();
  cutFillGeom.attributes.position.needsUpdate = true;
  cutFillGeom.computeBoundingSphere();

  planeMesh.position.set(xfm, Y_MAX * 0.575, 0);
  planeEdge.position.copy(planeMesh.position);
  polarGrid.position.x = xfm;
  fmLabel.position.set(xfm, Y_MAX * 1.28, 0);
  fmLabel.userData.setText(`fm = ${st.fm.toFixed(2)}`);
  for (const mat of polarGridMats) mat.opacity = 0.55 * m;
  polarGrid.visible = m > 0.01;
}

// 現在の θ の共振曲線・マーカー
function updateCurrent() {
  const th = st.theta, z = zOfTheta(th);
  const pos = curGeom.attributes.position.array;
  for (let i = 0; i < M_F; i++) {
    const f = F_LO + (i / (M_F - 1)) * (F_HI - F_LO);
    pos[i * 3] = xOfF(f);
    pos[i * 3 + 1] = yOfI(intensityAt(f, th));
    pos[i * 3 + 2] = z;
  }
  curGeom.attributes.position.needsUpdate = true;
  curGeom.computeBoundingSphere();
  curLine.material.opacity = 1 - 0.85 * st.morph;
  curLine.visible = st.morph < 0.98;

  const bp = curBase.geometry.attributes.position.array;
  bp[0] = -X_HALF; bp[1] = 0; bp[2] = z;
  bp[3] = X_HALF;  bp[4] = 0; bp[5] = z;
  curBase.geometry.attributes.position.needsUpdate = true;
  curBase.visible = st.morph < 0.98;

  // マーカー（断面上の現在の測定点）も同じ morph で移動する
  const I = intensityAt(st.fm, th);
  const norm = cutStat.max > 1e-9 ? cutStat.max : 1;
  const ay = yOfI(I), az = z;
  const r = POLAR_R * (I / norm), rad = th * DEG;
  const by = POLAR_CY + r * Math.cos(rad), bz = POLAR_CZ - r * Math.sin(rad);
  marker.position.set(xOfF(st.fm), ay + (by - ay) * st.morph, az + (bz - az) * st.morph);
}

// 巻き取り中は背後の曲線群を薄くして、断面（＝配向パターン）を見やすくする
function updateFade() {
  const m = st.morph;
  surface.visible = st.showSurf && m < 0.99;
  surface.material.opacity = 0.97 * (1 - m);
  for (const l of curveLines) {
    l.visible = m < 0.99;
    l.material.opacity = 0.95 * (1 - 0.85 * m);
  }
  axes.visible = m < 0.9;
  planeMesh.visible = st.showPlane;
  planeEdge.visible = st.showPlane;
  cutLine.visible = st.showCut;
  cutFill.visible = st.showCut;
  marker.visible = st.showCut;
}

// =====================================================================
// 2D パネル（配向パターン・共振曲線）
// =====================================================================
const polarCv = document.getElementById('polar');
const curveCv = document.getElementById('curve');

function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// 0° を上、時計回りを正（配向計の表示と同じ向き）
const polarXY = (cx, cy, r, deg) =>
  [cx + r * Math.sin(deg * DEG), cy - r * Math.cos(deg * DEG)];

function drawPolar() {
  const c = fitCanvas(polarCv);
  if (!c) return;
  const { ctx, w, h } = c;
  const cx = w / 2, cy = h / 2 + 16;
  const R = Math.max(24, Math.min(w, h) * 0.33);
  const norm = cutStat.max > 1e-9 ? cutStat.max : 1;

  // 目盛り円とスポーク
  ctx.strokeStyle = CSS_GRID;
  ctx.lineWidth = 1;
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * frac, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let a = 0; a < 180; a += 30) {
    const [x1, y1] = polarXY(cx, cy, R, a), [x2, y2] = polarXY(cx, cy, R, a + 180);
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.fillStyle = CSS_MUTED;
  ctx.font = '10px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const a of [0, 90, 180, 270]) {
    const [x, y] = polarXY(cx, cy, R + 12, a);
    ctx.fillText(`${a}°`, x, y);
  }

  // 配向パターン（＝ f = fm 断面の I(θ) を巻き取ったもの）
  ctx.strokeStyle = CSS_CUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k < N_CUT; k++) {
    const [x, y] = polarXY(cx, cy, R * (cutI[k] / norm), cutTheta[k]);
    k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  // 長軸（強度が最大になる向き）と、そこから 90° 回した配向角
  const axisLine = (deg, style, dash, len) => {
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = style;
    ctx.lineWidth = 1.2;
    const [x1, y1] = polarXY(cx, cy, R * len, deg);
    const [x2, y2] = polarXY(cx, cy, R * len, deg + 180);
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  };
  axisLine(cutStat.longAxis, 'rgba(255,157,60,0.55)', [5, 4], 1.05);  // 長軸
  axisLine(cutStat.angle, '#ff9d3c', [], 0.95);                       // 配向角（長軸+90°）
  ctx.fillStyle = '#ff9d3c';
  ctx.font = '10px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  {
    const [lx, ly] = polarXY(cx, cy, R * 0.95 + 14, cutStat.angle);
    ctx.fillText('配向角', lx, ly);
  }

  // 現在の θ（3D のマーカー・下の共振曲線と対応）
  const I = intensityAt(st.fm, st.theta);
  const [mx, my] = polarXY(cx, cy, R * (I / norm), st.theta);
  ctx.strokeStyle = 'rgba(255,209,102,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy); ctx.lineTo(mx, my);
  ctx.stroke();
  ctx.fillStyle = CSS_CUR;
  ctx.beginPath();
  ctx.arc(mx, my, 4, 0, Math.PI * 2);
  ctx.fill();

  // 読み値（実機の表示に合わせた体裁）
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = '12px "SFMono-Regular",Consolas,monospace';
  ctx.fillStyle = '#cdd3dc';
  const mor = isFinite(cutStat.mor) ? cutStat.mor.toFixed(3) : '∞';
  ctx.fillText(`ANGLE = ${cutStat.angle.toFixed(1)}°`, 12, h - 26);
  ctx.fillText(`MOR   = ${mor}`, 12, h - 10);
  ctx.font = '11px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.fillStyle = CSS_MUTED;
  ctx.textAlign = 'right';
  ctx.fillText(`長軸 ${cutStat.longAxis.toFixed(1)}° + 90° = 配向角`, w - 12, h - 26);
  ctx.fillText(`入力した φ₀ = ${st.phi0}°`, w - 12, h - 10);
}

function drawCurvePanel() {
  const c = fitCanvas(curveCv);
  if (!c) return;
  const { ctx, w, h } = c;
  const L = 46, Rm = 14, T = 44, B = 30;
  const pw = w - L - Rm, ph = h - T - B;
  if (pw < 40 || ph < 30) return;
  const px = f => L + ((f - F_LO) / (F_HI - F_LO)) * pw;
  const py = I => T + (1 - I / 1.08) * ph;

  // 枠と目盛り
  ctx.strokeStyle = CSS_GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(L, T, pw, ph);
  ctx.fillStyle = CSS_MUTED;
  ctx.font = '10px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const f of [3996, 3998, 4000, 4002, 4004]) {
    ctx.beginPath();
    ctx.moveTo(px(f), T); ctx.lineTo(px(f), T + ph);
    ctx.strokeStyle = 'rgba(44,49,58,0.7)';
    ctx.stroke();
    ctx.fillText(`${f}`, px(f), T + ph + 5);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const I of [0, 0.5, 1]) ctx.fillText(I.toFixed(1), L - 6, py(I));
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = CSS_TEXT;
  ctx.fillText('透過マイクロ波強度', L - 40, T - 15);
  ctx.textAlign = 'right';
  ctx.fillText('f（周波数）[MHz]', w - Rm, h - 14);

  // 配向方向・その 90° 方向の共振曲線（ピークが振れる範囲）
  const drawLorentz = (theta, style, width, dash) => {
    ctx.save();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < 200; i++) {
      const f = F_LO + (i / 199) * (F_HI - F_LO);
      const x = px(f), y = py(intensityAt(f, theta));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  };
  drawLorentz(st.phi0, 'rgba(109,130,153,0.75)', 1, [4, 3]);        // ε′max（fr 最小）
  drawLorentz(frMaxAngle(), 'rgba(142,203,255,0.8)', 1.4, [5, 3]);  // ε′min（fr 最大）＝ fm を決める曲線
  drawLorentz(st.theta, CSS_CUR, 2);                                // 現在の θ

  // fm の決め方: fr が最大になる曲線の「高周波側 半値」を示す
  const frMax = frAt(frMaxAngle());
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(142,203,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(frMax), py(0.5)); ctx.lineTo(px(st.fm), py(0.5));   // 半値の高さ
  ctx.moveTo(px(frMax), py(0.5)); ctx.lineTo(px(frMax), py(1));     // ピーク位置
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(142,203,255,0.85)';
  ctx.font = '10px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('半値', (px(frMax) + px(st.fm)) / 2, py(0.5) - 3);

  // 測定周波数 fm
  ctx.strokeStyle = CSS_PLANE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(px(st.fm), T); ctx.lineTo(px(st.fm), T + ph);
  ctx.stroke();
  ctx.fillStyle = CSS_PLANE;
  ctx.font = '11px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(`f = fm`, px(st.fm), T - 4);

  // 現在の測定点（この 1 点が配向パターンの 1 点になる）
  const I = intensityAt(st.fm, st.theta);
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(54,209,196,0.6)';
  ctx.beginPath();
  ctx.moveTo(L, py(I)); ctx.lineTo(px(st.fm), py(I));
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = CSS_CUT;
  ctx.beginPath();
  ctx.arc(px(st.fm), py(I), 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CSS_CUR;
  ctx.font = '11px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText(`θ = ${st.theta.toFixed(0)}°   I = ${I.toFixed(3)}`, L + pw - 6, T + 6);
}

// =====================================================================
// UI
// =====================================================================
const $ = id => document.getElementById(id);
const els = {
  phi0: $('phi0'), phi0Val: $('phi0Val'),
  dEps: $('dEps'), dEpsVal: $('dEpsVal'),
  q: $('q'), qVal: $('qVal'),
  fmVal: $('fmVal'),
  morph: $('morph'), morphVal: $('morphVal'),
  theta: $('theta'), thetaVal: $('thetaVal'),
  speed: $('speed'), speedVal: $('speedVal'),
  status: $('status'),
};

function updateStatus() {
  const emax = EPS_AVE + st.dEps / 2, emin = EPS_AVE - st.dEps / 2;
  const frMin = frAt(st.phi0), frMax = frAt(frMaxAngle());
  const mor = isFinite(cutStat.mor) ? cutStat.mor.toFixed(3) : '∞';
  const I = intensityAt(st.fm, st.theta);
  els.status.textContent =
    `ε′max = ${emax.toFixed(3)}（θ = ${st.phi0}°）\n` +
    `ε′min = ${emin.toFixed(3)}（θ = ${(st.phi0 + 90) % 180}°）\n` +
    `共振周波数 fr = ${frMin.toFixed(2)} 〜 ${frMax.toFixed(2)} MHz\n` +
    `── fm の決定 ──\n` +
    `fr 最大の θ = ${(st.phi0 + 90) % 360}°（fr = ${frMax.toFixed(2)}）\n` +
    `その高周波側 半値 ＝ fr + ${(frMax / (2 * st.Q)).toFixed(2)} MHz\n` +
    `→ fm = ${st.fm.toFixed(2)} MHz\n` +
    `── f = fm の断面（配向パターン）──\n` +
    `長軸 = ${cutStat.longAxis.toFixed(1)}°（強度最大の向き）\n` +
    `ANGLE = ${cutStat.angle.toFixed(1)}°（配向角 ＝ 長軸+90°）\n` +
    `MOR = ${mor}\n` +
    `現在 θ = ${st.theta.toFixed(0)}° → I = ${I.toFixed(3)}`;
}

// パラメータが変わったときに一括で走らせる
function refresh() {
  st.fm = computeFm();                 // fm は φ0 / Δε′ / Q から自動で決まる
  els.fmVal.textContent = st.fm.toFixed(2);
  recomputeCut();
  rebuildSurface();
  updateCut();
  updateCurrent();
  updateFade();
  updateStatus();
}

els.phi0.addEventListener('input', e => {
  st.phi0 = +e.target.value;
  els.phi0Val.textContent = `${st.phi0}°`;
  refresh();
});
els.dEps.addEventListener('input', e => {
  st.dEps = +e.target.value;
  els.dEpsVal.textContent = st.dEps.toFixed(2);
  refresh();
});
els.q.addEventListener('input', e => {
  st.Q = +e.target.value;
  els.qVal.textContent = `${st.Q}`;
  refresh();
});
els.theta.addEventListener('input', e => {
  st.theta = +e.target.value;
  els.thetaVal.textContent = `${st.theta}°`;
  if (st.playing) setPlaying(false);
  updateCurrent();
  updateStatus();
});
els.speed.addEventListener('input', e => {
  st.speed = +e.target.value;
  els.speedVal.textContent = `${st.speed.toFixed(1)}×`;
});
els.morph.addEventListener('input', e => {
  st.morph = st.morphTarget = +e.target.value / 100;
  els.morphVal.textContent = `${Math.round(st.morph * 100)}%`;
  syncWrapBtn();
});

$('showPlane').addEventListener('change', e => { st.showPlane = e.target.checked; updateFade(); });
$('showCut').addEventListener('change', e => { st.showCut = e.target.checked; updateFade(); });
$('showSurf').addEventListener('change', e => { st.showSurf = e.target.checked; updateFade(); });

function setPlaying(on) {
  st.playing = on;
  $('playBtn').textContent = on ? '⏸ 一時停止' : '▶ 回転を再生';
}
$('playBtn').addEventListener('click', () => setPlaying(!st.playing));
$('stepBack').addEventListener('click', () => stepTheta(-10));
$('stepFwd').addEventListener('click', () => stepTheta(10));
function stepTheta(d) {
  if (st.playing) setPlaying(false);
  st.theta = (st.theta + d + 360) % 360;
  els.theta.value = st.theta;
  els.thetaVal.textContent = `${st.theta.toFixed(0)}°`;
  updateCurrent();
  updateStatus();
}

function syncWrapBtn() {
  $('wrapBtn').textContent = st.morphTarget > 0.5
    ? '⟲ 3D の断面に戻す' : '▶ 断面を極座標へ巻き取る';
}
$('wrapBtn').addEventListener('click', () => {
  st.morphTarget = st.morphTarget > 0.5 ? 0 : 1;
  syncWrapBtn();
  setView(st.morphTarget > 0.5 ? 'front' : 'obl');
});

// ---------- 視点 ----------
const OBL_DIR = new THREE.Vector3(0.9, 0.62, 1.05).normalize();
const FRONT_DIR = new THREE.Vector3(1, 0.06, 0.02).normalize();
let fly = null;

function setView(kind) {
  const target = kind === 'front'
    ? new THREE.Vector3(xOfF(st.fm), POLAR_CY, POLAR_CZ)
    : new THREE.Vector3(0, Y_MAX * 0.42, 0);
  const dir = kind === 'front' ? FRONT_DIR : OBL_DIR;
  const dist = kind === 'front' ? 15 : 26;
  fly = {
    fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
    toPos: target.clone().addScaledVector(dir, dist), toTarget: target,
    t: 0, dur: 0.85,
  };
  for (const b of $('viewBtns').querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.view === kind);
  }
}
$('viewBtns').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setView(b.dataset.view);
});

// =====================================================================
// ループ
// =====================================================================
const sizeVec = new THREE.Vector2();
let last = performance.now();

function render(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // 試料の回転（1× で 12 秒／回転）
  if (st.playing) {
    st.theta = (st.theta + dt * st.speed * 30) % 360;
    els.theta.value = st.theta.toFixed(0);
    els.thetaVal.textContent = `${st.theta.toFixed(0)}°`;
    updateStatus();
  }

  // 巻き取りアニメーション
  if (Math.abs(st.morph - st.morphTarget) > 1e-4) {
    const dir = Math.sign(st.morphTarget - st.morph);
    st.morph = THREE.MathUtils.clamp(st.morph + dir * dt / 0.9, 0, 1);
    if (dir > 0) st.morph = Math.min(st.morph, st.morphTarget);
    else st.morph = Math.max(st.morph, st.morphTarget);
    els.morph.value = Math.round(st.morph * 100);
    els.morphVal.textContent = `${Math.round(st.morph * 100)}%`;
    updateCut();
    updateFade();
  }
  updateCurrent();

  // 視点の移動
  if (fly) {
    fly.t += dt;
    const s = THREE.MathUtils.clamp(fly.t / fly.dur, 0, 1);
    const e = s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2;  // ease in-out
    camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
    controls.target.lerpVectors(fly.fromTarget, fly.toTarget, e);
    if (s >= 1) fly = null;
  }
  controls.update();

  const dpr = window.devicePixelRatio || 1;
  const w = viewEl.clientWidth, h = viewEl.clientHeight;
  if (w > 0 && h > 0) {
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    renderer.getSize(sizeVec);
    if (sizeVec.x !== w || sizeVec.y !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  }
  drawPolar();
  drawCurvePanel();
  requestAnimationFrame(render);
}

// ---------- 初期化 ----------
camera.position.copy(new THREE.Vector3(0, Y_MAX * 0.42, 0)).addScaledVector(OBL_DIR, 26);
controls.target.set(0, Y_MAX * 0.42, 0);
els.phi0Val.textContent = `${st.phi0}°`;
els.dEpsVal.textContent = st.dEps.toFixed(2);
els.qVal.textContent = `${st.Q}`;
els.fmVal.textContent = st.fm.toFixed(2);
els.thetaVal.textContent = `${st.theta}°`;
els.speedVal.textContent = `${st.speed.toFixed(1)}×`;
els.morphVal.textContent = '0%';
syncWrapBtn();
refresh();
requestAnimationFrame(render);
