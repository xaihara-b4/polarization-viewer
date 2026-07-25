import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 座標系: three.js の (x, y, z) = (S1, S2, S3)、上方向は +S3

// ---------- 物理計算 ----------

// 入力ストークスベクトルを正規化（ゼロベクトルは null）
function normalizeStokes(s1, s2, s3) {
  const len = Math.hypot(s1, s2, s3);
  if (!isFinite(len) || len < 1e-12) return null;
  return new THREE.Vector3(s1 / len, s2 / len, s3 / len);
}

// 位相差 δ [rad] = 2π R / λ
function retardancePhase(retNm, lambdaNm) {
  return 2 * Math.PI * retNm / lambdaNm;
}

// 位相差板（進相軸角度 θ）の回転軸 a = (cos2θ, sin2θ, 0)
function waveplateAxis(thetaRad) {
  return new THREE.Vector3(Math.cos(2 * thetaRad), Math.sin(2 * thetaRad), 0);
}

// 入力 S を軸 a まわりに −δ 回転（CLAUDE.md の Mueller 行列規約）
function applyWaveplate(sIn, axis, delta) {
  return sIn.clone().applyAxisAngle(axis, -delta);
}

// ---------- シーン構築 ----------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(3, -4, 5);
scene.add(dirLight);

// 半透明の球体
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 48, 32),
  new THREE.MeshStandardMaterial({
    color: 0x3a6ea5, transparent: true, opacity: 0.18,
    depthWrite: false, side: THREE.DoubleSide,
  })
);
scene.add(sphere);

// 緯線・経線
function addGrid() {
  const mat = new THREE.LineBasicMaterial({ color: 0x3a4150, transparent: true, opacity: 0.6 });
  const eqMat = new THREE.LineBasicMaterial({ color: 0x5a6478 });
  for (let i = 1; i < 6; i++) {                       // 緯線
    const lat = (i / 6 - 0.5) * Math.PI;
    const r = Math.cos(lat), z = Math.sin(lat);
    const pts = [];
    for (let j = 0; j <= 64; j++) {
      const a = (j / 64) * 2 * Math.PI;
      pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), z === 0 ? eqMat : mat));
  }
  for (let i = 0; i < 12; i++) {                      // 経線
    const lon = (i / 12) * 2 * Math.PI;
    const pts = [];
    for (let j = 0; j <= 64; j++) {
      const a = (j / 64) * Math.PI - Math.PI / 2;
      pts.push(new THREE.Vector3(
        Math.cos(a) * Math.cos(lon), Math.cos(a) * Math.sin(lon), Math.sin(a)));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
}
addGrid();

// 軸（矢印）とラベル
function makeTextSprite(text, color, scale = 0.28) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false,
  }));
  sprite.scale.set(scale * 2, scale, 1);
  return sprite;
}

// ラベル用レイヤー番号。正投影ビューでは視線方向（画面中心）に重なるラベルを
// カメラの layers で非表示にする
const LAYER_S1 = 1, LAYER_S2 = 2, LAYER_S3 = 3, LAYER_RCP = 4, LAYER_LCP = 5;
const LABEL_LAYERS = [LAYER_S1, LAYER_S2, LAYER_S3, LAYER_RCP, LAYER_LCP];

function addAxis(dir, color, label, labelLayer) {
  scene.add(new THREE.ArrowHelper(dir, dir.clone().multiplyScalar(-1.3), 2.6, color, 0.09, 0.05));
  const sprite = makeTextSprite(label, '#e6e9ef');
  sprite.position.copy(dir.clone().multiplyScalar(1.45));
  sprite.layers.set(labelLayer);
  scene.add(sprite);
}
addAxis(new THREE.Vector3(1, 0, 0), 0xd06060, 'S1', LAYER_S1);
addAxis(new THREE.Vector3(0, 1, 0), 0x60b060, 'S2', LAYER_S2);
addAxis(new THREE.Vector3(0, 0, 1), 0x6080d0, 'S3', LAYER_S3);

const rcpLabel = makeTextSprite('右円偏光', '#9aa4b2', 0.2);
rcpLabel.position.set(0.28, 0, 1.12);
rcpLabel.layers.set(LAYER_RCP);
scene.add(rcpLabel);
const lcpLabel = makeTextSprite('左円偏光', '#9aa4b2', 0.2);
lcpLabel.position.set(0.28, 0, -1.12);
lcpLabel.layers.set(LAYER_LCP);
scene.add(lcpLabel);

// 入力点・出力点・軌跡・回転軸（更新のたびに作り直すグループ）
const IN_COLOR = '#ffffff', AXIS_COLOR = 0xb08cff;
const OUT_OF_VISIBLE_COLOR = '#9aa4b2';

// 波長 [nm] を近似的な可視光の色に変換（可視域外はグレー）。条件行の色に使う
function wavelengthToColor(nm) {
  if (!isFinite(nm) || nm < 380 || nm > 780) return OUT_OF_VISIBLE_COLOR;
  let r = 0, g = 0, b = 0;
  if (nm < 440)      { r = (440 - nm) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = (645 - nm) / 65; }
  else               { r = 1; }
  // 暗背景で見やすいよう軽くガンマ補正して明るめに
  const hex = v => Math.round(255 * Math.pow(v, 0.8)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
const dynamicGroup = new THREE.Group();
scene.add(dynamicGroup);

function makePoint(pos, color) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 24, 16),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 })
  );
  m.position.copy(pos);
  return m;
}

// results: [{ delta, sOut, color }]（条件行ごとの計算結果）
function rebuildDynamic(sIn, axis, results) {
  dynamicGroup.clear();

  // 回転軸（破線、球を貫通）
  const axisGeom = new THREE.BufferGeometry().setFromPoints([
    axis.clone().multiplyScalar(-1.15), axis.clone().multiplyScalar(1.15)]);
  const axisLine = new THREE.Line(axisGeom,
    new THREE.LineDashedMaterial({ color: AXIS_COLOR, dashSize: 0.06, gapSize: 0.04 }));
  axisLine.computeLineDistances();
  dynamicGroup.add(axisLine);

  results.forEach((r, idx) => {
    // 回転軌跡（0 → −δ の円弧）。半径をわずかにずらし軌跡同士の重なりを回避
    const n = Math.max(2, Math.ceil(Math.abs(r.delta) / (Math.PI / 90)));
    const radius = 1.002 + 0.004 * (idx % 6);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      pts.push(sIn.clone().applyAxisAngle(axis, -r.delta * (i / n)).multiplyScalar(radius));
    }
    dynamicGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: r.color })));
    dynamicGroup.add(makePoint(r.sOut, r.color));
  });

  dynamicGroup.add(makePoint(sIn, IN_COLOR));
}

// ---------- カメラ・4 ビュー ----------
// ビューごとに独立した canvas + WebGLRenderer を持ち、1 つのシーンを共有して描画する。
// （1 canvas のシザー分割は座標計算が環境依存でずれやすいため使わない）

const mainCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
mainCamera.up.set(0, 0, 1);
mainCamera.position.set(2.4, -2.4, 1.5);
LABEL_LAYERS.forEach(l => mainCamera.layers.enable(l));

const controls = new OrbitControls(mainCamera, document.getElementById('view-main'));
controls.enableDamping = true;
controls.minDistance = 1.5;
controls.maxDistance = 12;

// 正投影カメラ。labelLayers に列挙したラベルだけ表示する
// （視線方向＝画面中心に重なる軸・極のラベルは列挙せず非表示にする）
function makeOrthoCamera(pos, up, labelLayers) {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  cam.up.copy(up);
  cam.position.copy(pos);
  cam.lookAt(0, 0, 0);
  labelLayers.forEach(l => cam.layers.enable(l));
  return cam;
}

function makeView(id, camera, ortho) {
  const el = document.getElementById(id);
  const renderer = new THREE.WebGLRenderer({
    canvas: el.querySelector('canvas'), antialias: true,
  });
  return { el, renderer, camera, ortho };
}

const ORTHO_HALF = 1.6;
const views = [
  makeView('view-main', mainCamera, false),
  // 平面図: 北極側（S3+）から −S3 方向を見る、上 = +S2・右 = +S1
  makeView('view-bottom',
    makeOrthoCamera(new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 1, 0),
      [LAYER_S1, LAYER_S2]), true),
  makeView('view-s1',
    makeOrthoCamera(new THREE.Vector3(3, 0, 0), new THREE.Vector3(0, 0, 1),
      [LAYER_S2, LAYER_S3, LAYER_RCP, LAYER_LCP]), true),
  makeView('view-s2',
    makeOrthoCamera(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 0, 1),
      [LAYER_S1, LAYER_S3, LAYER_RCP, LAYER_LCP]), true),
];

const sizeVec = new THREE.Vector2();

function render() {
  controls.update();

  const dpr = window.devicePixelRatio || 1;
  for (const v of views) {
    const w = v.el.clientWidth, h = v.el.clientHeight;
    if (w <= 0 || h <= 0) continue;

    if (v.renderer.getPixelRatio() !== dpr) v.renderer.setPixelRatio(dpr);
    v.renderer.getSize(sizeVec);
    if (sizeVec.x !== w || sizeVec.y !== h) v.renderer.setSize(w, h, false);

    const aspect = w / h;
    if (v.ortho) {
      v.camera.left = -ORTHO_HALF * aspect;
      v.camera.right = ORTHO_HALF * aspect;
      v.camera.top = ORTHO_HALF;
      v.camera.bottom = -ORTHO_HALF;
    } else {
      v.camera.aspect = aspect;
    }
    v.camera.updateProjectionMatrix();

    v.renderer.render(scene, v.camera);
  }
  requestAnimationFrame(render);
}

// ---------- UI ----------

const inputs = ['s1', 's2', 's3', 'theta'].map(id => document.getElementById(id));
const resultEl = document.getElementById('result');
const condsEl = document.getElementById('conds');
const addCondBtn = document.getElementById('addCond');

// 測定条件（波長 λ [nm]・リタデーション R [nm]）の行。追加・削除可能
const conds = [
  { lambda: 450, ret: 132.5 },
  { lambda: 530, ret: 132.5 },
  { lambda: 633, ret: 132.5 },
];

function renderConds() {
  condsEl.innerHTML = '';
  conds.forEach((cond, i) => {
    const row = document.createElement('div');
    row.className = 'cond';

    // 色は行の波長から自動決定（可視光の色、可視域外はグレー）
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = wavelengthToColor(cond.lambda);
    row.appendChild(sw);

    for (const key of ['lambda', 'ret']) {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.value = cond[key];
      input.addEventListener('input', () => {
        cond[key] = parseFloat(input.value);
        sw.style.background = wavelengthToColor(cond.lambda);
        update();
      });
      row.appendChild(input);
    }

    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'この条件を削除';
    del.addEventListener('click', () => {
      conds.splice(i, 1);
      renderConds();
      update();
    });
    row.appendChild(del);

    condsEl.appendChild(row);
  });
}

addCondBtn.addEventListener('click', () => {
  const last = conds[conds.length - 1];
  conds.push({ lambda: last ? last.lambda : 530, ret: last ? last.ret : 132.5 });
  renderConds();
  update();
});

const fmt = x => (x >= 0 ? '+' : '') + x.toFixed(3);
const dot = color => `<span class="dot" style="background:${color}"></span>`;

function update() {
  const [s1, s2, s3, thetaDeg] = inputs.map(el => parseFloat(el.value));

  if ([s1, s2, s3, thetaDeg].some(v => !isFinite(v))) {
    resultEl.innerHTML = '<span class="err">S1〜S3・角度θに数値を入力してください</span>';
    return;
  }
  const sIn = normalizeStokes(s1, s2, s3);
  if (!sIn) {
    resultEl.innerHTML = '<span class="err">S1, S2, S3 がすべて 0 です（偏光状態を指定できません）</span>';
    return;
  }

  const axis = waveplateAxis(THREE.MathUtils.degToRad(thetaDeg));

  const results = [];
  const lines = [
    `${dot(IN_COLOR)}入力 S = (${fmt(sIn.x)}, ${fmt(sIn.y)}, ${fmt(sIn.z)})`,
    `回転軸 (cos2θ, sin2θ, 0) = (${fmt(axis.x)}, ${fmt(axis.y)}, 0)`,
  ];
  conds.forEach((cond) => {
    const color = wavelengthToColor(cond.lambda);
    if (!isFinite(cond.lambda) || !isFinite(cond.ret) || cond.lambda <= 0) {
      lines.push(`${dot(color)}<span class="err">λ・R が不正です</span>`);
      return;
    }
    const delta = retardancePhase(cond.ret, cond.lambda);
    const sOut = applyWaveplate(sIn, axis, delta);
    results.push({ delta, sOut, color });
    lines.push(
      `${dot(color)}λ=${cond.lambda} R=${cond.ret} → δ=<b>${THREE.MathUtils.radToDeg(delta).toFixed(1)}°</b>\n` +
      `　出力 S = (${fmt(sOut.x)}, ${fmt(sOut.y)}, ${fmt(sOut.z)})`);
  });
  if (conds.length === 0) {
    lines.push('測定条件がありません（「＋ 条件を追加」で追加）');
  }

  rebuildDynamic(sIn, axis, results);
  resultEl.innerHTML = lines.join('\n');
}

inputs.forEach(el => el.addEventListener('input', update));
renderConds();
update();
render();
