// Scena 3D di JARVIS: orb di particelle reattivo alla voce + rete neurale viva.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// Simplex noise 3D (Ashima Arts / Stefan Gustavson, MIT)
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const SOFT_DOT = /* glsl */ `
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a = a * a * 1.4 + smoothstep(0.18, 0.0, d) * 0.6;
  gl_FragColor = vec4(vec3(1.0), a * vAlpha);
}`;

const additive = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending };
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

// Materiale generico per punti con alpha e dimensione per-vertice
function dotsMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uOpacity: { value: 1 }, uPx: { value: 1 }, ...uniforms },
    vertexShader: /* glsl */ `
      attribute float aAlpha; attribute float aSize;
      uniform float uOpacity; uniform float uPx;
      varying float vAlpha;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPx * (12.0 / -mv.z);
        vAlpha = aAlpha * uOpacity;
      }`,
    fragmentShader: SOFT_DOT,
  });
}

export function createScene(canvas, labelLayer) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  const px = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(px);
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 0, 17);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.08);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- stato animato ----------
  const S = {
    mode: "boot",
    awake: 0, awakeT: 0,
    think: 0, thinkT: 0,
    level: 0, levelT: 0,
    mic: 0, micT: 0,
    reveal: 0, revealT: 0,
    burst: 0,
    swirl: 0,
    flash: 0,
    shock: -1,
    camZ: 17,
    mouseX: 0, mouseY: 0,
    synapses: 0,
  };

  // ---------- polvere di fondo ----------
  {
    const n = 1400, pos = new Float32Array(n * 3), a = new Float32Array(n), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = rand(9, 40), th = rand(0, Math.PI * 2), ph = Math.acos(rand(-1, 1));
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.6, r * Math.cos(ph) - 10], i * 3);
      a[i] = rand(0.05, 0.35);
      s[i] = rand(0.6, 2.2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(a, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(s, 1));
    var dust = new THREE.Points(g, dotsMaterial());
    dust.material.uniforms.uPx.value = px;
    scene.add(dust);
  }

  // ---------- ORB ----------
  const orb = new THREE.Group();
  scene.add(orb);
  const ORB_N = 9000;
  const orbUniforms = {
    uTime: { value: 0 }, uLevel: { value: 0 }, uAwake: { value: 0 }, uThink: { value: 0 },
    uBurst: { value: 0 }, uSwirl: { value: 0 }, uPx: { value: px }, uMic: { value: 0 },
  };
  {
    const dir = new Float32Array(ORB_N * 3), rnd = new Float32Array(ORB_N), shell = new Float32Array(ORB_N);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < ORB_N; i++) {
      const y = 1 - (i / (ORB_N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
      const j = 0.035; // leggero jitter: niente griglia visibile
      const v = new THREE.Vector3(Math.cos(th) * r + gauss() * j, y + gauss() * j, Math.sin(th) * r + gauss() * j).normalize();
      dir.set([v.x, v.y, v.z], i * 3);
      rnd[i] = Math.random();
      const k = Math.random();
      shell[i] = k < 0.78 ? 1 + gauss() * 0.012 : k < 0.94 ? Math.pow(Math.random(), 0.6) * 0.95 : 1 + Math.random() * 0.22;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ORB_N * 3), 3));
    g.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    g.setAttribute("aShell", new THREE.BufferAttribute(shell, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    const m = new THREE.ShaderMaterial({
      ...additive,
      uniforms: orbUniforms,
      vertexShader: /* glsl */ `
        ${NOISE}
        uniform float uTime, uLevel, uAwake, uThink, uBurst, uSwirl, uPx, uMic;
        attribute vec3 aDir; attribute float aRand; attribute float aShell;
        varying float vAlpha;
        vec3 rotY(vec3 p, float a){ float c=cos(a), s=sin(a); return vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z); }
        void main(){
          // vortice: le fasce a latitudini diverse ruotano a velocità diverse
          vec3 d = rotY(aDir, uSwirl * (0.35 + 0.9 * (1.0 - abs(aDir.y))) + aRand * 0.02);
          float t = uTime;
          float n1 = snoise(d * 1.6 + vec3(0.0, t * 0.22, t * 0.13));
          float n2 = snoise(d * 4.2 - vec3(t * 0.45));
          float amp = 0.045 + uLevel * 0.55 + uThink * 0.12 + uMic * 0.18;
          float r = 1.0 + n1 * amp + n2 * amp * 0.38;
          r += sin(d.y * 11.0 - t * 7.0) * uLevel * 0.035;            // onde concentriche quando parla
          r += sin(d.x * 7.0 + d.z * 7.0 + t * 3.0) * uThink * 0.03;  // ronzio mentre ragiona
          float base = mix(0.42, 1.0, uAwake) * 1.6;
          vec3 p = d * r * aShell * base;
          // esplosione/assemblaggio al risveglio
          p *= 1.0 + uBurst * (1.2 + aRand * 5.5);
          p += vec3(sin(aRand * 91.0), cos(aRand * 57.0), sin(aRand * 23.0)) * uBurst * 1.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float nz = (modelViewMatrix * vec4(d, 0.0)).z;      // >0 = lato verso la camera
          float facing = 0.18 + 0.82 * smoothstep(-0.7, 0.9, nz);
          float rim = pow(1.0 - abs(nz), 3.0) * 0.55;           // bordo luminoso tipo Siri
          float peak = max(n1, 0.0) * (uLevel * 1.4 + uThink * 0.5);
          float inner = aShell < 0.97 ? 0.45 : 1.0;
          vAlpha = (facing + rim + peak) * inner * (0.35 + 0.4 * aRand) * mix(0.5, 0.42, uAwake) * (1.0 - uBurst * 0.35);
          gl_PointSize = (0.8 + aRand * 1.3 + uLevel * 1.1 + peak * 1.0) * uPx * (12.0 / -mv.z);
        }`,
      fragmentShader: SOFT_DOT,
    });
    var orbPoints = new THREE.Points(g, m);
    orb.add(orbPoints);
  }

  // bagliore interno
  function glowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d"), gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.18, "rgba(255,255,255,.45)");
    gr.addColorStop(0.45, "rgba(255,255,255,.08)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }
  const glowTex = glowTexture();
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, ...additive, opacity: 0.2 }));
  core.scale.setScalar(3);
  orb.add(core);

  // anelli HUD tratteggiati che orbitano attorno all'orb
  const rings = [];
  [[2.25, 0.35, 0.0, 900, 0.12], [2.55, -0.25, 0.6, 700, -0.08], [3.05, 1.2, 0.2, 1100, 0.05]].forEach(([R, tiltX, tiltZ, n, speed], k) => {
    const pos = new Float32Array(n * 3), a = new Float32Array(n), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      pos.set([Math.cos(th) * R, 0, Math.sin(th) * R], i * 3);
      const seg = Math.floor((i / n) * (k === 2 ? 90 : 24));
      const on = k === 2 ? seg % 2 === 0 : (seg * 7919) % 5 !== 0;
      a[i] = on ? (k === 2 ? 0.35 : 0.5) : 0.0;
      s[i] = k === 2 ? 1.0 : 1.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(a, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(s, 1));
    const mat = dotsMaterial();
    mat.uniforms.uPx.value = px;
    const pts = new THREE.Points(g, mat);
    const holder = new THREE.Group();
    holder.rotation.set(tiltX, 0, tiltZ);
    holder.add(pts);
    orb.add(holder);
    rings.push({ pts, mat, speed, holder });
  });

  // onda d'urto del risveglio
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 128), new THREE.MeshBasicMaterial({ color: 0xffffff, ...additive, opacity: 0, side: THREE.DoubleSide }));
  scene.add(shock);

  // ---------- RETE NEURALE ----------
  const net = new THREE.Group();
  scene.add(net);
  const nodes = []; // {base, pos, phase, glow, cluster, inner, neighbors:[edgeIdx]}
  const clusters = [];
  for (let i = 0; i < 11; i++) {
    const th = rand(0, Math.PI * 2), y = rand(-0.75, 0.75), r = rand(3.6, 5.6);
    const h = Math.sqrt(1 - y * y);
    clusters.push(new THREE.Vector3(Math.cos(th) * h * r * 1.25, y * r * 0.85, Math.sin(th) * h * r));
  }
  for (let i = 0; i < 300; i++) {
    let v;
    const c = i % clusters.length;
    if (i < 250) v = clusters[c].clone().add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(0.85));
    else {
      const d = new THREE.Vector3(gauss(), gauss(), gauss()).normalize();
      v = d.multiplyScalar(rand(2.5, 3.2)); // nodi "ponte" vicino all'orb
    }
    if (v.length() < 2.4) v.setLength(2.4 + Math.random() * 0.6);
    nodes.push({ base: v, pos: v.clone(), phase: rand(0, 100), glow: 0, inner: i >= 250, neighbors: [], size: rand(1.2, 3.2) });
  }
  // ancore sulla superficie dell'orb (assoni verso il nucleo)
  const anchors = [];
  for (let i = 0; i < 26; i++) {
    const d = new THREE.Vector3(gauss(), gauss(), gauss()).normalize().multiplyScalar(1.65);
    anchors.push(nodes.length);
    nodes.push({ base: d, pos: d.clone(), phase: rand(0, 100), glow: 0, anchor: true, neighbors: [], size: 1.4 });
  }
  const edges = []; // {a, b, order, act}
  const edgeKey = new Set();
  const addEdge = (a, b) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || edgeKey.has(k)) return;
    edgeKey.add(k);
    const e = edges.length;
    edges.push({ a, b, order: 0, act: 0 });
    nodes[a].neighbors.push(e);
    nodes[b].neighbors.push(e);
  };
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].anchor) continue;
    const near = [];
    for (let j = 0; j < nodes.length; j++) {
      if (j === i || nodes[j].anchor) continue;
      near.push([nodes[i].base.distanceTo(nodes[j].base), j]);
    }
    near.sort((x, y) => x[0] - y[0]);
    const k = nodes[i].inner ? 2 : 3;
    for (let q = 0; q < k; q++) if (near[q][0] < 2.2) addEdge(i, near[q][1]);
    if (Math.random() < 0.05) addEdge(i, near[Math.floor(rand(6, 14))][1]); // connessioni a lungo raggio
  }
  anchors.forEach((ai) => {
    const a = nodes[ai].base;
    const near = nodes.map((n, j) => [n.inner ? a.distanceTo(n.base) : Infinity, j]).sort((x, y) => x[0] - y[0]);
    addEdge(ai, near[0][1]);
    if (Math.random() < 0.5) addEdge(ai, near[1][1]);
  });
  // ordine di rivelazione: BFS dal nucleo verso l'esterno (la rete "cresce" dall'orb)
  {
    const dist = new Array(nodes.length).fill(Infinity);
    const queue = [...anchors];
    anchors.forEach((a) => (dist[a] = 0));
    while (queue.length) {
      const i = queue.shift();
      for (const e of nodes[i].neighbors) {
        const j = edges[e].a === i ? edges[e].b : edges[e].a;
        if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; queue.push(j); }
      }
    }
    const max = Math.max(...dist.filter(Number.isFinite)) || 1;
    nodes.forEach((n, i) => (n.order = Number.isFinite(dist[i]) ? dist[i] / max : rand(0.5, 1)));
    edges.forEach((e) => (e.order = Math.max(nodes[e.a].order, nodes[e.b].order)));
  }

  const NODE_N = nodes.length, EDGE_N = edges.length;
  const nodePos = new Float32Array(NODE_N * 3), nodeAlpha = new Float32Array(NODE_N), nodeSize = new Float32Array(NODE_N);
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute("position", new THREE.BufferAttribute(nodePos, 3));
  nodeGeo.setAttribute("aAlpha", new THREE.BufferAttribute(nodeAlpha, 1));
  nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(nodeSize, 1));
  nodeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  const nodeMat = dotsMaterial();
  nodeMat.uniforms.uPx.value = px;
  net.add(new THREE.Points(nodeGeo, nodeMat));

  const edgePos = new Float32Array(EDGE_N * 6), edgeAlpha = new Float32Array(EDGE_N * 2);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
  edgeGeo.setAttribute("aAlpha", new THREE.BufferAttribute(edgeAlpha, 1));
  edgeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  const edgeMat = new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uOpacity: { value: 1 } },
    vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(1.0,1.0,1.0, vA * uOpacity); }`,
  });
  net.add(new THREE.LineSegments(edgeGeo, edgeMat));

  // impulsi sinaptici con scia
  const PULSE_MAX = 420, TRAIL = 5;
  const pulses = [];
  const pulsePos = new Float32Array(PULSE_MAX * TRAIL * 3), pulseAlpha = new Float32Array(PULSE_MAX * TRAIL), pulseSize = new Float32Array(PULSE_MAX * TRAIL);
  const pulseGeo = new THREE.BufferGeometry();
  pulseGeo.setAttribute("position", new THREE.BufferAttribute(pulsePos, 3));
  pulseGeo.setAttribute("aAlpha", new THREE.BufferAttribute(pulseAlpha, 1));
  pulseGeo.setAttribute("aSize", new THREE.BufferAttribute(pulseSize, 1));
  pulseGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  const pulseMat = dotsMaterial();
  pulseMat.uniforms.uPx.value = px;
  net.add(new THREE.Points(pulseGeo, pulseMat));

  function spawnPulse(edge, fromNode, energy = 1, depth = 0) {
    if (pulses.length >= PULSE_MAX || edge == null) return;
    const e = edges[edge];
    if (e.order > S.reveal + 0.02) return;
    const forward = e.a === fromNode;
    pulses.push({ e: edge, from: forward ? e.a : e.b, to: forward ? e.b : e.a, t: 0, speed: rand(0.9, 1.8) * (1 + S.think * 1.2), energy, depth });
    S.synapses++;
  }
  function fireFrom(nodeIndex, energy = 1, depth = 0) {
    const n = nodes[nodeIndex];
    if (!n.neighbors.length) return;
    spawnPulse(n.neighbors[Math.floor(Math.random() * n.neighbors.length)], nodeIndex, energy, depth);
  }
  let spawnAcc = 0;

  // ---------- etichette HUD agganciate ai nodi ----------
  let labels = [];
  const labelCandidates = nodes
    .map((n, i) => ({ i, n }))
    .filter(({ n }) => !n.anchor && !n.inner && Math.abs(n.base.x) > 3.2 && Math.abs(n.base.y) < 2.6)
    .sort((a, b) => Math.abs(b.n.base.z) - Math.abs(a.n.base.z));
  function setLabels(items) {
    labelLayer.innerHTML = "";
    const used = [];
    labels = items.slice(0, 8).map((item, k) => {
      const pick = labelCandidates.find(({ i, n }) => !used.includes(i) && (k % 2 ? n.base.x < 0 : n.base.x > 0) && used.every((u) => nodes[u].base.distanceTo(n.base) > 1.8)) || labelCandidates.find(({ i }) => !used.includes(i));
      if (!pick) return null;
      used.push(pick.i);
      const el = document.createElement("div");
      el.className = "node-label";
      el.innerHTML = `<i></i><small></small><span></span>`;
      el.querySelector("small").textContent = item.kind;
      el.querySelector("span").textContent = item.text;
      labelLayer.appendChild(el);
      return { el, node: pick.i, hot: 0 };
    }).filter(Boolean);
  }
  const tmp = new THREE.Vector3();
  function placeLabels() {
    const w = innerWidth, h = innerHeight;
    const show = S.reveal > 0.85 && S.think < 0.5 && S.mode !== "sleep";
    const pad = w > 900 ? w * 0.3 + 190 : 0;
    for (const L of labels) {
      tmp.copy(nodes[L.node].pos).applyMatrix4(net.matrixWorld).project(camera);
      const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h;
      const left = x < w / 2;
      L.el.style.transform = `translate(${x}px, ${y}px)`;
      L.el.classList.toggle("left", left);
      L.el.classList.toggle("on", show && tmp.z < 1 && (left ? x > pad : x < w - pad) && y > h * 0.14 && y < h * 0.78);
      L.el.classList.toggle("hot", L.hot > 0.05);
      L.hot *= 0.97;
    }
  }

  // ---------- input ----------
  addEventListener("pointermove", (e) => {
    S.mouseX = (e.clientX / innerWidth - 0.5) * 2;
    S.mouseY = (e.clientY / innerHeight - 0.5) * 2;
  });
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    bloom.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let time = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;

    S.awake = damp(S.awake, S.awakeT, S.awakeT > S.awake ? 2.2 : 1.2, dt);
    S.think = damp(S.think, S.thinkT, 3, dt);
    S.level = damp(S.level, S.levelT, S.levelT > S.level ? 22 : 9, dt);
    S.mic = damp(S.mic, S.micT, 10, dt);
    S.reveal = damp(S.reveal, S.revealT, S.revealT > S.reveal ? 0.55 : 2, dt);
    S.burst = damp(S.burst, 0, 1.7, dt);
    S.flash = damp(S.flash, 0, 2.2, dt);
    S.swirl += dt * (0.06 + S.think * 1.6 + S.level * 0.25);

    // camera: avvicinamento al risveglio + parallasse
    const aspectZoom = innerWidth / innerHeight < 1 ? 1.8 : 1;
    S.camZ = damp(S.camZ, (S.awakeT ? 11.2 : 15) * aspectZoom, 1.1, dt);
    camera.position.x = damp(camera.position.x, S.mouseX * 0.9 + Math.sin(time * 0.07) * 0.6, 1.5, dt);
    camera.position.y = damp(camera.position.y, -S.mouseY * 0.6 + Math.cos(time * 0.09) * 0.3, 1.5, dt);
    camera.position.z = S.camZ;
    camera.lookAt(0, 0, 0);

    // orb
    orbUniforms.uTime.value = time;
    orbUniforms.uLevel.value = S.level;
    orbUniforms.uAwake.value = S.awake;
    orbUniforms.uThink.value = S.think;
    orbUniforms.uBurst.value = S.burst;
    orbUniforms.uSwirl.value = S.swirl;
    orbUniforms.uMic.value = S.mic * (1 - Math.min(1, S.level * 3));
    orb.rotation.y += dt * (0.08 + S.think * 0.35);
    orb.rotation.x = Math.sin(time * 0.13) * 0.18;
    const breath = 1 + Math.sin(time * 1.4) * 0.015 * (1 - S.awake * 0.5);
    orb.scale.setScalar(breath);
    core.material.opacity = 0.04 + S.awake * 0.05 + S.level * 0.22 + S.think * 0.06 + S.flash * 0.7 + S.mic * 0.06;
    core.scale.setScalar(1.4 + S.awake * 1.2 + S.level * 1.6 + S.flash * 6);
    rings.forEach((r, k) => {
      r.pts.rotation.y += dt * r.speed * (1 + S.think * 6 + S.level * 2);
      r.mat.uniforms.uOpacity.value = S.awake * (0.55 + S.level * 0.6 + S.think * 0.4) * (k === 2 ? S.reveal : 1);
      const sc = 1 + S.level * 0.06 * (k + 1) + S.burst * (2 + k);
      r.holder.scale.setScalar(sc);
    });
    if (S.shock >= 0) {
      S.shock += dt;
      const p = S.shock / 1.6;
      shock.scale.setScalar(1.5 + p * 14);
      shock.material.opacity = Math.max(0, 0.7 * (1 - p));
      shock.lookAt(camera.position);
      if (p >= 1) S.shock = -1;
    }

    // rete neurale
    net.rotation.y += dt * (0.025 + S.think * 0.06);
    net.rotation.x = Math.sin(time * 0.05) * 0.08;
    const netVis = S.reveal;
    for (let i = 0; i < NODE_N; i++) {
      const n = nodes[i];
      const w = n.anchor ? 0 : 0.09 + S.think * 0.05;
      n.pos.set(
        n.base.x + Math.sin(time * 0.6 + n.phase) * w,
        n.base.y + Math.cos(time * 0.5 + n.phase * 1.3) * w,
        n.base.z + Math.sin(time * 0.4 + n.phase * 0.7) * w,
      );
      if (n.anchor) n.pos.multiplyScalar(S.awake * breath * (1 + S.burst * 3));
      n.glow *= Math.exp(-dt * 2.6);
      const vis = THREE.MathUtils.smoothstep(netVis, n.order - 0.05, n.order + 0.1);
      nodePos[i * 3] = n.pos.x; nodePos[i * 3 + 1] = n.pos.y; nodePos[i * 3 + 2] = n.pos.z;
      nodeAlpha[i] = vis * ((n.anchor ? 0.0 : 0.22 + S.think * 0.12) + n.glow * 0.9);
      nodeSize[i] = n.size * (1 + n.glow * 1.8) * (n.anchor ? 0.6 : 1);
    }
    for (let e = 0; e < EDGE_N; e++) {
      const E = edges[e], a = nodes[E.a].pos, b = nodes[E.b].pos;
      edgePos.set([a.x, a.y, a.z, b.x, b.y, b.z], e * 6);
      E.act *= Math.exp(-dt * 1.8);
      const vis = THREE.MathUtils.smoothstep(netVis, E.order - 0.05, E.order + 0.12);
      const al = vis * (0.03 + S.think * 0.035 + E.act * 0.3);
      edgeAlpha[e * 2] = al; edgeAlpha[e * 2 + 1] = al;
    }

    // generazione impulsi: pochi a riposo, tempesta quando ragiona
    if (S.mode !== "sleep" && S.reveal > 0.2) {
      const rate = 3 + S.think * 75 + S.level * 22 + S.mic * 10;
      spawnAcc += rate * dt;
      while (spawnAcc > 1) {
        spawnAcc--;
        const src = S.think > 0.4 && Math.random() < 0.6 ? anchors[Math.floor(Math.random() * anchors.length)] : Math.floor(Math.random() * 300);
        fireFrom(src, 1, 0);
      }
    }
    let w = 0;
    for (let k = pulses.length - 1; k >= 0; k--) {
      const P = pulses[k];
      const a = nodes[P.from].pos, b = nodes[P.to].pos;
      const len = a.distanceTo(b) || 1;
      P.t += (dt * P.speed * 2.2) / len;
      edges[P.e].act = Math.max(edges[P.e].act, 0.6 * P.energy);
      if (P.t >= 1) {
        nodes[P.to].glow = Math.min(1.6, nodes[P.to].glow + 0.7 * P.energy);
        pulses.splice(k, 1);
        // propagazione a cascata
        const chance = (0.28 + S.think * 0.5) * P.energy;
        if (P.depth < 9 && Math.random() < chance) {
          const out = nodes[P.to].neighbors.filter((e) => e !== P.e);
          const branches = Math.random() < S.think * 0.35 ? 2 : 1;
          for (let q = 0; q < branches && out.length; q++) {
            const e = out.splice(Math.floor(Math.random() * out.length), 1)[0];
            spawnPulse(e, P.to, P.energy * 0.92, P.depth + 1);
          }
        }
        continue;
      }
    }
    for (const P of pulses) {
      const a = nodes[P.from].pos, b = nodes[P.to].pos;
      for (let s = 0; s < TRAIL; s++) {
        const t = Math.max(0, P.t - s * 0.035);
        pulsePos[w * 3] = a.x + (b.x - a.x) * t;
        pulsePos[w * 3 + 1] = a.y + (b.y - a.y) * t;
        pulsePos[w * 3 + 2] = a.z + (b.z - a.z) * t;
        pulseAlpha[w] = (1 - s / TRAIL) * 0.95 * P.energy;
        pulseSize[w] = (3.2 - s * 0.45) * (0.8 + P.energy * 0.4);
        w++;
      }
    }
    pulseGeo.setDrawRange(0, w);
    nodeGeo.attributes.position.needsUpdate = nodeGeo.attributes.aAlpha.needsUpdate = nodeGeo.attributes.aSize.needsUpdate = true;
    edgeGeo.attributes.position.needsUpdate = edgeGeo.attributes.aAlpha.needsUpdate = true;
    pulseGeo.attributes.position.needsUpdate = pulseGeo.attributes.aAlpha.needsUpdate = pulseGeo.attributes.aSize.needsUpdate = true;

    dust.rotation.y += dt * 0.006;
    dust.material.uniforms.uOpacity.value = 0.5 + S.awake * 0.5;

    bloom.strength = 0.6 + S.awake * 0.15 + S.level * 0.45 + S.think * 0.2 + S.flash * 1.4;
    bloom.radius = 0.5 + S.level * 0.2;

    net.updateMatrixWorld();
    placeLabels();
    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- API pubblica ----------
  return {
    get synapses() { return S.synapses; },
    setMode(mode) {
      S.mode = mode;
      S.awakeT = mode === "sleep" || mode === "boot" ? 0 : 1;
      S.thinkT = mode === "think" ? 1 : 0;
      S.revealT = mode === "sleep" || mode === "boot" ? 0 : 1;
      if (mode !== "speak") S.levelT = 0;
    },
    wake() {
      S.burst = 1;
      S.flash = 1;
      S.shock = 0;
      S.reveal = 0;
      this.setMode("listen");
    },
    setLevel(v) { S.levelT = Math.min(1, v); },
    setMic(v) { S.micT = Math.min(1, v); },
    setLabels,
    // un ricordo recuperato: scarica di impulsi dal nucleo e etichetta evidenziata
    highlight(k = -1) {
      const L = labels[k >= 0 ? k % labels.length : Math.floor(Math.random() * labels.length)];
      for (let i = 0; i < 14; i++) fireFrom(anchors[Math.floor(Math.random() * anchors.length)], 1.2, 0);
      if (L) { L.hot = 1; nodes[L.node].glow = 1.6; }
      S.flash = Math.max(S.flash, 0.25);
    },
    burstSynapses(n = 30) { for (let i = 0; i < n; i++) fireFrom(anchors[Math.floor(Math.random() * anchors.length)], 1, 0); },
  };
}
