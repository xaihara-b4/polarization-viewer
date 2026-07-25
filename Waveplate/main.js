import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 座標系: 伝搬方向 = +X。横断面 = Y–Z。上方向 = +Z。
//   波長板の 進相軸(fast) = +Y（水平・固定）／遅相軸(slow) = +Z（垂直・固定）
//
// 描画するもの（デフォルメ・教育用）:
//   偏光板(左奥) → 直線偏光 → 波長板で進相/遅相の2成分に分解 →
//   遅相軸成分が板内で位相 δ だけ遅れる → 出口で合成 → 楕円偏光

// ---------- レイアウト定数 ----------
const X_POL    = -6;    // 偏光板の位置
const X_IN     = -2;    // 波長板の入口
const X_OUT    =  2;    // 波長板の出口
const X_SCREEN =  8;    // 出力側スクリーンの位置
const A        = 1.3;   // 振幅（表示スケール）
const LAMBDA_W = 2.6;   // 波長（ワールド長）
const K        = 2 * Math.PI / LAMBDA_W;  // 空間角周波数
const OMEGA    = 2.2;   // 時間角周波数（基準）
const TRANS_R  = 1.75;  // 偏光板の半径・板の横断半サイズ

const FAST_COLOR = 0x36d1c4; // 進相軸成分（シアン）
const SLOW_COLOR = 0xff9d3c; // 遅相軸成分（オレンジ）
const AXIS_COLOR = 0x556072;

// 状態（UI から更新）
const stateP = {
  phi: THREE.MathUtils.degToRad(45), // 透過軸角度（+Y からの回転）
  delta: THREE.MathUtils.degToRad(90), // 位相差
  speed: 1,
  lambda: 530,
  playing: true,
};

// ---------- 波長 → 可視光の近似色（PoincareSphere と同じ変換）----------
function wavelengthToColor(nm) {
  if (!isFinite(nm) || nm < 380 || nm > 780) return '#9aa4b2';
  let r = 0, g = 0, b = 0;
  if (nm < 440)      { r = (440 - nm) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = (645 - nm) / 65; }
  else               { r = 1; }
  const hex = v => Math.round(255 * Math.pow(v, 0.8)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ---------- シーン構築 ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(-4, -6, 8);
scene.add(dirLight);

// 伝搬軸（薄い基準線）
scene.add(new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(X_POL, 0, 0), new THREE.Vector3(X_SCREEN + 0.6, 0, 0)]),
  new THREE.LineBasicMaterial({ color: AXIS_COLOR, transparent: true, opacity: 0.5 })));

// 床グリッド（奥行きの手がかり）
const grid = new THREE.GridHelper(24, 24, 0x2c313a, 0x22262d);
grid.rotation.x = Math.PI / 2;      // XY 平面へ
grid.position.z = -TRANS_R - 1.2;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

// ラベル用スプライト（PoincareSphere から流用）
function makeTextSprite(text, color, scale = 0.42) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 64px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 64);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false,
  }));
  sprite.scale.set(scale * 4, scale, 1);
  return sprite;
}
function addLabel(text, color, pos, scale) {
  const s = makeTextSprite(text, color, scale);
  s.position.copy(pos);
  scene.add(s);
  return s;
}

// ---------- 偏光板（回転するコイン）----------
const polarizer = new THREE.Group();
polarizer.position.set(X_POL, 0, 0);
scene.add(polarizer);

const disk = new THREE.Mesh(
  new THREE.CylinderGeometry(TRANS_R, TRANS_R, 0.16, 48),
  new THREE.MeshStandardMaterial({
    color: 0x2b3550, metalness: 0.3, roughness: 0.6,
    transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  })
);
disk.rotation.z = Math.PI / 2; // 円盤の軸(既定 +Y)を +X へ
polarizer.add(disk);
// 縁のリング
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(TRANS_R, 0.05, 12, 48),
  new THREE.MeshStandardMaterial({ color: 0x8ea3c8, metalness: 0.5, roughness: 0.4 })
);
polarizer.add(ring); // TorusはXY面 → +Z軸まわり、盤面(YZ)に合わせ回転
ring.rotation.y = Math.PI / 2;

// 透過軸バー（この向きに電場が通る）。φで回すグループ
const axisBar = new THREE.Group();
polarizer.add(axisBar);
const bar = new THREE.Mesh(
  new THREE.BoxGeometry(0.1, 2 * TRANS_R * 0.92, 0.24),
  new THREE.MeshStandardMaterial({ color: 0xffe27a, emissive: 0x554400 })
);
axisBar.add(bar);

addLabel('偏光板', '#cdd3dc', new THREE.Vector3(X_POL, 0, TRANS_R + 0.9), 0.36);
addLabel('透過軸', '#ffe27a', new THREE.Vector3(X_POL, TRANS_R + 0.5, 0), 0.3);

// ---------- 波長板（直方体）----------
const plate = new THREE.Group();
scene.add(plate);
const plateBox = new THREE.Mesh(
  new THREE.BoxGeometry(X_OUT - X_IN, 2 * TRANS_R, 2 * TRANS_R),
  new THREE.MeshStandardMaterial({
    color: 0x2d6a8a, transparent: true, opacity: 0.16,
    depthWrite: false, side: THREE.DoubleSide,
  })
);
plateBox.position.set((X_IN + X_OUT) / 2, 0, 0);
plate.add(plateBox);
plate.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(plateBox.geometry),
  new THREE.LineBasicMaterial({ color: 0x4a8fb5, transparent: true, opacity: 0.6 })
).translateX((X_IN + X_OUT) / 2));

// 入口面の進相軸(+Y)・遅相軸(+Z)矢印
plate.add(new THREE.ArrowHelper(
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(X_IN, 0, 0), TRANS_R, FAST_COLOR, 0.28, 0.18));
plate.add(new THREE.ArrowHelper(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(X_IN, 0, 0), TRANS_R, SLOW_COLOR, 0.28, 0.18));
addLabel('波長板', '#cdd3dc', new THREE.Vector3((X_IN + X_OUT) / 2, 0, TRANS_R + 1.0), 0.36);
addLabel('進相軸(速)', '#7fe6dc', new THREE.Vector3(X_IN, TRANS_R + 0.45, 0), 0.28);
addLabel('遅相軸(遅)', '#ffc078', new THREE.Vector3(X_IN, 0, TRANS_R + 0.45), 0.28);

// 区間ラベル
addLabel('直線偏光', '#9aa4b2', new THREE.Vector3((X_POL + X_IN) / 2, 0, -TRANS_R - 0.9), 0.3);
addLabel('楕円偏光', '#9aa4b2', new THREE.Vector3((X_OUT + X_SCREEN) / 2, 0, -TRANS_R - 0.9), 0.3);
addLabel('スクリーン', '#9aa4b2', new THREE.Vector3(X_SCREEN, 0, -TRANS_R - 0.9), 0.28);

// ---------- 波（毎フレーム更新するライン）----------
// 汎用: n+1 頂点のラインを作り、Float32 の位置配列を返す
function makeLine(n, color, opacity = 1) {
  const positions = new Float32Array((n + 1) * 3);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geom,
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  line.frustumCulled = false;
  scene.add(line);
  return { line, positions, n };
}

const N_IN = 90, N_PLATE = 130, N_AFTER = 200;
const waveColor = new THREE.Color(wavelengthToColor(stateP.lambda));

const incoming = makeLine(N_IN, waveColor);            // 入射直線偏光（合成）: X_POL〜X_IN
const fastComp = makeLine(N_PLATE, FAST_COLOR, 0.95);  // 進相軸成分(Y): 板内 X_IN〜X_OUT のみ
const slowComp = makeLine(N_PLATE, SLOW_COLOR, 0.95);  // 遅相軸成分(Z): 板内 X_IN〜X_OUT のみ
const combined = makeLine(N_AFTER, waveColor);         // 合成（楕円らせん）: 板通過後 X_OUT〜X_SCREEN のみ

// 入射の櫛（電場ベクトルの束）
const N_COMB = 16;
const combPos = new Float32Array(N_COMB * 2 * 3);
const combGeom = new THREE.BufferGeometry();
combGeom.setAttribute('position', new THREE.BufferAttribute(combPos, 3));
const combLines = new THREE.LineSegments(combGeom,
  new THREE.LineBasicMaterial({ color: waveColor, transparent: true, opacity: 0.5 }));
combLines.frustumCulled = false;
scene.add(combLines);

// 通過後の合成波の櫛（軸から楕円偏光の波までの補助線）
const N_COMB_OUT = 30;
const combOutPos = new Float32Array(N_COMB_OUT * 2 * 3);
const combOutGeom = new THREE.BufferGeometry();
combOutGeom.setAttribute('position', new THREE.BufferAttribute(combOutPos, 3));
const combOutLines = new THREE.LineSegments(combOutGeom,
  new THREE.LineBasicMaterial({ color: waveColor, transparent: true, opacity: 0.4 }));
combOutLines.frustumCulled = false;
scene.add(combOutLines);

// スクリーン面と楕円リング
const screenPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(2 * TRANS_R, 2 * TRANS_R),
  new THREE.MeshBasicMaterial({
    color: 0x9fb3d0, transparent: true, opacity: 0.08, side: THREE.DoubleSide })
);
screenPlane.rotation.y = Math.PI / 2;    // YZ 面へ
screenPlane.position.set(X_SCREEN, 0, 0);
scene.add(screenPlane);

const N_ELL = 128;
const ellPos = new Float32Array((N_ELL + 1) * 3);
const ellGeom = new THREE.BufferGeometry();
ellGeom.setAttribute('position', new THREE.BufferAttribute(ellPos, 3));
const ellipse = new THREE.LineLoop(ellGeom, new THREE.LineBasicMaterial({ color: waveColor }));
ellipse.frustumCulled = false;
scene.add(ellipse);

// スクリーン上で回る電場ベクトル
let exitArrow = new THREE.ArrowHelper(
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(X_SCREEN, 0, 0), 1, waveColor, 0.3, 0.2);
scene.add(exitArrow);

// 波長板の出口面（到達面）: 進相波・遅相波・合成波の伸縮する矢印
const exitOrigin = new THREE.Vector3(X_OUT, 0, 0);
const exitFace = new THREE.Mesh(
  new THREE.PlaneGeometry(2 * TRANS_R, 2 * TRANS_R),
  new THREE.MeshBasicMaterial({
    color: 0x8ecbff, transparent: true, opacity: 0.07, side: THREE.DoubleSide })
);
exitFace.rotation.y = Math.PI / 2;   // YZ 面へ
exitFace.position.copy(exitOrigin);
scene.add(exitFace);

// 伸縮矢印（毎フレーム向き・長さを更新）。長さ 0 付近では非表示にする
function makeExitArrow(color) {
  const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), exitOrigin, 0.001, color, 0.22, 0.14);
  scene.add(a);
  return a;
}
const arrowFast = makeExitArrow(FAST_COLOR); // 進相波（Y）
const arrowSlow = makeExitArrow(SLOW_COLOR); // 遅相波（Z）
const arrowComb = makeExitArrow(waveColor);  // 合成波（Y+Z）

// 矢印を成分ベクトル (0, vy, vz) に合わせて伸縮させる
function setArrow(arrow, vy, vz) {
  const len = Math.hypot(vy, vz);
  if (len < 0.02) { arrow.visible = false; return; }
  arrow.visible = true;
  arrow.setDirection(new THREE.Vector3(0, vy, vz).normalize());
  arrow.setLength(len, Math.min(0.22, len * 0.35), Math.min(0.14, len * 0.24));
}

// ---------- 静的な再構築（φ/δ/λ 変更時）----------
function amps() {
  return { Ef: A * Math.cos(stateP.phi), Es: A * Math.sin(stateP.phi) };
}

function rebuildStatic() {
  // 透過軸バーを φ 回転（+Y を (0,cosφ,sinφ) へ）
  axisBar.rotation.x = stateP.phi;

  // 波の色
  const col = new THREE.Color(wavelengthToColor(stateP.lambda));
  incoming.line.material.color.copy(col);
  combined.line.material.color.copy(col);
  combLines.material.color.copy(col);
  combOutLines.material.color.copy(col);
  ellipse.material.color.copy(col);
  exitArrow.setColor(col);
  arrowComb.setColor(col);

  // スクリーン上の楕円リング: ψ を 0..2π 掃引
  const { Ef, Es } = amps();
  const d = stateP.delta;
  for (let i = 0; i <= N_ELL; i++) {
    const psi = (i / N_ELL) * 2 * Math.PI;
    ellPos[i * 3]     = X_SCREEN;
    ellPos[i * 3 + 1] = Ef * Math.cos(psi);
    ellPos[i * 3 + 2] = Es * Math.cos(psi - d);
  }
  ellGeom.attributes.position.needsUpdate = true;

  updateStatus();
}

// ---------- 状態テキスト ----------
const statusEl = document.getElementById('status');
const dotHtml = c => `<span class="dot" style="background:${c}"></span>`;

function classifyOutput() {
  const phiDeg = THREE.MathUtils.radToDeg(stateP.phi);
  const dDeg = THREE.MathUtils.radToDeg(stateP.delta);
  const { Ef, Es } = amps();
  const near = (a, b, t = 6) => Math.abs(((a - b + 540) % 360) - 180) < t;
  // 成分が片方ゼロ → 直線（軸に一致）
  if (Math.abs(Ef) < 1e-3 || Math.abs(Es) < 1e-3) return '直線偏光（軸に一致）';
  if (near(dDeg, 0) || near(dDeg, 360)) return '直線偏光（入射と同じ）';
  if (near(dDeg, 180)) return '直線偏光（進相軸で反転）';
  const circ = (near(dDeg, 90) || near(dDeg, 270)) && Math.abs(Math.abs(phiDeg % 180) - 45) < 4;
  if (circ) return '円偏光';
  // 回転の向き（y z' − z y' の符号 = −Ef·Es·sinδ）
  const hand = -Ef * Es * Math.sin(stateP.delta);
  return `楕円偏光（${hand < 0 ? '右回り' : '左回り'}）`;
}

function updateStatus() {
  const phiDeg = Math.round(THREE.MathUtils.radToDeg(stateP.phi));
  const dDeg = Math.round(THREE.MathUtils.radToDeg(stateP.delta));
  const { Ef, Es } = amps();
  const col = wavelengthToColor(stateP.lambda);
  let plateName = '';
  if (Math.abs(dDeg - 90) < 4) plateName = ' (λ/4 板)';
  else if (Math.abs(dDeg - 180) < 4) plateName = ' (λ/2 板)';
  else if (Math.abs(dDeg - 360) < 4 || dDeg < 4) plateName = ' (λ 板)';
  statusEl.innerHTML =
    `${dotHtml(col)}入射: 直線偏光　φ = ${phiDeg}°\n` +
    `分解 → ${dotHtml('#36d1c4')}進相 Ef=${Ef.toFixed(2)}　` +
    `${dotHtml('#ff9d3c')}遅相 Es=${Es.toFixed(2)}\n` +
    `位相差 δ = ${dDeg}°${plateName}\n` +
    `出力: <b>${classifyOutput()}</b>`;
}

// ---------- 波の更新（毎フレーム）----------
function updateWaves(t) {
  const { Ef, Es } = amps();
  const u = new THREE.Vector3(0, Math.cos(stateP.phi), Math.sin(stateP.phi));

  // 入射（合成の直線偏光）: E = A cos(kx − ωt) u
  for (let i = 0; i <= N_IN; i++) {
    const x = X_POL + (X_IN - X_POL) * (i / N_IN);
    const s = A * Math.cos(K * x - OMEGA * t);
    incoming.positions[i * 3]     = x;
    incoming.positions[i * 3 + 1] = s * u.y;
    incoming.positions[i * 3 + 2] = s * u.z;
  }
  incoming.line.geometry.attributes.position.needsUpdate = true;

  // 櫛（電場ベクトルの束）
  for (let j = 0; j < N_COMB; j++) {
    const x = X_POL + (X_IN - X_POL) * ((j + 0.5) / N_COMB);
    const s = A * Math.cos(K * x - OMEGA * t);
    combPos[j * 6]     = x; combPos[j * 6 + 1] = 0;       combPos[j * 6 + 2] = 0;
    combPos[j * 6 + 3] = x; combPos[j * 6 + 4] = s * u.y; combPos[j * 6 + 5] = s * u.z;
  }
  combGeom.attributes.position.needsUpdate = true;

  // 板内（X_IN〜X_OUT）: 進相(Y)・遅相(Z)成分だけを描く（合成波は出さない）
  const span = X_OUT - X_IN;
  for (let i = 0; i <= N_PLATE; i++) {
    const x = X_IN + span * (i / N_PLATE);
    const frac = (x - X_IN) / span;                     // 板内で 0→1
    const yf = Ef * Math.cos(K * x - OMEGA * t);        // 進相軸: 遅れなし
    const zs = Es * Math.cos(K * x - OMEGA * t - stateP.delta * frac); // 遅相軸: δ だけ遅れる
    fastComp.positions[i * 3]     = x;
    fastComp.positions[i * 3 + 1] = yf;
    fastComp.positions[i * 3 + 2] = 0;
    slowComp.positions[i * 3]     = x;
    slowComp.positions[i * 3 + 1] = 0;
    slowComp.positions[i * 3 + 2] = zs;
  }
  fastComp.line.geometry.attributes.position.needsUpdate = true;
  slowComp.line.geometry.attributes.position.needsUpdate = true;

  // 板通過後（X_OUT〜X_SCREEN）: 合成した電場だけを描く（分岐波は出さない）
  // 遅相軸は板を出た時点で位相が δ だけ遅れており、以降その差を保つ（frac = 1 で一定）
  for (let i = 0; i <= N_AFTER; i++) {
    const x = X_OUT + (X_SCREEN - X_OUT) * (i / N_AFTER);
    const yf = Ef * Math.cos(K * x - OMEGA * t);
    const zs = Es * Math.cos(K * x - OMEGA * t - stateP.delta); // 一定の位相差 δ
    combined.positions[i * 3]     = x;
    combined.positions[i * 3 + 1] = yf;
    combined.positions[i * 3 + 2] = zs;
  }
  combined.line.geometry.attributes.position.needsUpdate = true;

  // 通過後の合成波の櫛: 軸(x,0,0) から波の先端(x,yf,zs) までの補助線
  for (let j = 0; j < N_COMB_OUT; j++) {
    const x = X_OUT + (X_SCREEN - X_OUT) * ((j + 0.5) / N_COMB_OUT);
    const yf = Ef * Math.cos(K * x - OMEGA * t);
    const zs = Es * Math.cos(K * x - OMEGA * t - stateP.delta);
    combOutPos[j * 6]     = x; combOutPos[j * 6 + 1] = 0;  combOutPos[j * 6 + 2] = 0;
    combOutPos[j * 6 + 3] = x; combOutPos[j * 6 + 4] = yf; combOutPos[j * 6 + 5] = zs;
  }
  combOutGeom.attributes.position.needsUpdate = true;

  // 出口面（到達面）の伸縮矢印: X_OUT での各成分（遅相軸は位相差 δ）
  const yfE = Ef * Math.cos(K * X_OUT - OMEGA * t);
  const zsE = Es * Math.cos(K * X_OUT - OMEGA * t - stateP.delta);
  setArrow(arrowFast, yfE, 0);   // 進相波（Y方向に伸縮）
  setArrow(arrowSlow, 0, zsE);   // 遅相波（Z方向に伸縮）
  setArrow(arrowComb, yfE, zsE); // 合成波（Y+Z の合成ベクトル）

  // スクリーン上の回転ベクトル: ψ = k·X_SCREEN − ωt
  const psi = K * X_SCREEN - OMEGA * t;
  const ey = Ef * Math.cos(psi), ez = Es * Math.cos(psi - stateP.delta);
  const len = Math.hypot(ey, ez);
  if (len > 1e-4) {
    exitArrow.setDirection(new THREE.Vector3(0, ey, ez).normalize());
    exitArrow.setLength(len, Math.min(0.3, len * 0.3), Math.min(0.2, len * 0.2));
  }
}

// ---------- カメラ・レンダラ ----------
const viewEl = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({
  canvas: viewEl.querySelector('canvas'), antialias: true });

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
camera.up.set(0, 0, 1);
camera.position.set(3, -16, 8);

const controls = new OrbitControls(camera, viewEl);
controls.enableDamping = true;
controls.target.set(1, 0, 0.4);
controls.minDistance = 6;
controls.maxDistance = 60;

const sizeVec = new THREE.Vector2();
let t = 0, last = performance.now();

function render(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (stateP.playing) t += dt * stateP.speed;
  updateWaves(t);
  controls.update();

  const dpr = window.devicePixelRatio || 1;
  const w = viewEl.clientWidth, h = viewEl.clientHeight;
  if (w > 0 && h > 0) {
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    renderer.getSize(sizeVec);
    if (sizeVec.x !== w || sizeVec.y !== h) renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(render);
}

// ---------- UI ----------
const phiEl = document.getElementById('phi');
const phiValEl = document.getElementById('phiVal');
const deltaEl = document.getElementById('delta');
const deltaValEl = document.getElementById('deltaVal');
const speedEl = document.getElementById('speed');
const speedValEl = document.getElementById('speedVal');
const lambdaEl = document.getElementById('lambda');
const lambdaValEl = document.getElementById('lambdaVal');
const playBtn = document.getElementById('playBtn');
const deltaBtns = document.getElementById('deltaBtns');

phiEl.addEventListener('input', () => {
  stateP.phi = THREE.MathUtils.degToRad(parseFloat(phiEl.value));
  phiValEl.textContent = `${phiEl.value}°`;
  rebuildStatic();
});
deltaEl.addEventListener('input', () => {
  stateP.delta = THREE.MathUtils.degToRad(parseFloat(deltaEl.value));
  deltaValEl.textContent = `${deltaEl.value}°`;
  syncDeltaButtons();
  rebuildStatic();
});
speedEl.addEventListener('input', () => {
  stateP.speed = parseFloat(speedEl.value);
  speedValEl.textContent = `${stateP.speed.toFixed(1)}×`;
});
lambdaEl.addEventListener('input', () => {
  stateP.lambda = parseFloat(lambdaEl.value);
  lambdaValEl.textContent = `${lambdaEl.value}nm`;
  rebuildStatic();
});
playBtn.addEventListener('click', () => {
  stateP.playing = !stateP.playing;
  playBtn.textContent = stateP.playing ? '⏸ 一時停止' : '▶ 再生';
});
deltaBtns.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    deltaEl.value = btn.dataset.delta;
    stateP.delta = THREE.MathUtils.degToRad(parseFloat(btn.dataset.delta));
    deltaValEl.textContent = `${btn.dataset.delta}°`;
    syncDeltaButtons();
    rebuildStatic();
  });
});
function syncDeltaButtons() {
  deltaBtns.querySelectorAll('button').forEach(btn =>
    btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.delta) - parseFloat(deltaEl.value)) < 1));
}

syncDeltaButtons();
rebuildStatic();
requestAnimationFrame(render);
