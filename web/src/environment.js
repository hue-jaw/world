// ============================================================================
// METROPOLIS — environment.js
// Cycle jour/nuit (soleil, lune, ciel, étoiles), météo à états avec
// transitions douces (pluie, orage+éclairs, brouillard, nuages) et ses
// effets gameplay : adhérence, vitesse du trafic, phares automatiques.
// Équivalent UE5 : SkyAtmosphere + VolumetricCloud + Ultra Dynamic Sky maison.
// ============================================================================
import * as THREE from 'three';
import { CFG, Bus, clamp, lerp, rand, randRange, pick, WEATHER_STATES } from './core.js';
import { headlightGlowMat } from './vehicles.js';

// Keyframes du ciel sur 24 h (interpolation linéaire entre clés)
const SKY_KEYS = [
  { h: 0.0,  sky: 0x0a1120, fog: 0x0a1120, sun: 0x8fb4ff, sunI: 0.22, hemiI: 0.16, cloudCol: 0x131c2e },
  { h: 4.5,  sky: 0x0c1424, fog: 0x0c1424, sun: 0x8fb4ff, sunI: 0.22, hemiI: 0.16, cloudCol: 0x16203a },
  { h: 6.0,  sky: 0x35466b, fog: 0x4a5a7d, sun: 0xffb37a, sunI: 0.5,  hemiI: 0.34, cloudCol: 0x5a6a8f },
  { h: 7.5,  sky: 0x87b5dd, fog: 0xa8c4e2, sun: 0xffd9a8, sunI: 1.6,  hemiI: 0.62, cloudCol: 0xe8eef5 },
  { h: 12.0, sky: 0x6fb1e8, fog: 0xbdd7ee, sun: 0xfff3e0, sunI: 2.5,  hemiI: 0.85, cloudCol: 0xffffff },
  { h: 16.5, sky: 0x6ea8de, fog: 0xb4cfe8, sun: 0xffe9c4, sunI: 2.1,  hemiI: 0.75, cloudCol: 0xf5f2ec },
  { h: 18.5, sky: 0xe8956b, fog: 0xd9a07c, sun: 0xff9a52, sunI: 1.0,  hemiI: 0.45, cloudCol: 0xe8a583 },
  { h: 19.8, sky: 0x2c3a5e, fog: 0x35466b, sun: 0xff8a5c, sunI: 0.25, hemiI: 0.24, cloudCol: 0x3a4a70 },
  { h: 21.0, sky: 0x0a1120, fog: 0x0a1120, sun: 0x8fb4ff, sunI: 0.22, hemiI: 0.16, cloudCol: 0x131c2e },
  { h: 24.0, sky: 0x0a1120, fog: 0x0a1120, sun: 0x8fb4ff, sunI: 0.22, hemiI: 0.16, cloudCol: 0x131c2e },
];
function skyAt(hour) {
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (hour >= SKY_KEYS[i].h && hour <= SKY_KEYS[i + 1].h) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const t = (hour - a.h) / Math.max(0.001, b.h - a.h);
  const col = (ka, kb) => new THREE.Color(ka).lerp(new THREE.Color(kb), t);
  return {
    sky: col(a.sky, b.sky), fog: col(a.fog, b.fog), sun: col(a.sun, b.sun),
    cloudCol: col(a.cloudCol, b.cloudCol),
    sunI: lerp(a.sunI, b.sunI, t), hemiI: lerp(a.hemiI, b.hemiI, t),
  };
}

function makeRainTexture() {
  const c = document.createElement('canvas'); c.width = 8; c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, 'rgba(160,190,230,0)');
  grad.addColorStop(0.5, 'rgba(170,200,240,0.85)');
  grad.addColorStop(1, 'rgba(160,190,230,0)');
  g.fillStyle = grad; g.fillRect(3, 0, 2, 32);
  return new THREE.CanvasTexture(c);
}

/**
 * Texture de nuage : plusieurs lobes radiaux doux sur un canvas 256².
 * Une seule texture partagée par les 64 sprites (1 upload, 0 coût réseau).
 */
function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, 256, 256);
  // amas de gouttes : des cercles de rayon variable, très flous
  for (let i = 0; i < 26; i++) {
    const x = 128 + randRange(-70, 70), y = 128 + randRange(-46, 46);
    const r = randRange(26, 74);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.34)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Halo circulaire additif (soleil). */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,248,225,0.95)');
  grad.addColorStop(0.25, 'rgba(255,236,190,0.45)');
  grad.addColorStop(0.6, 'rgba(255,220,160,0.12)');
  grad.addColorStop(1, 'rgba(255,210,140,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Environment {
  constructor(scene, city, renderer) {
    this.scene = scene;
    this.city = city;
    this.hour = CFG.time.startHour;
    this.timeScale = 1;
    this.weatherName = 'Clear';
    this.params = { ...WEATHER_STATES.Clear };
    this._target = { ...WEATHER_STATES.Clear };
    this._autoT = randRange(80, 140);
    this.autoWeather = true;
    this.rainIntensity = 0;
    this.gripFactor = 1; this.trafficFactor = 1;
    this.nightFactor = 0;
    this.headlightsOn = false;
    this.headlightOverride = null;   // null=auto, true/false=forcé (touche L)
    this._lightningT = randRange(4, 12);
    this._flash = 0;

    // --- lumières ---
    this.renderer = renderer || null;
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    const sc = this.sun.shadow.camera;
    sc.left = -100; sc.right = 100; sc.top = 100; sc.bottom = -100; sc.near = 10; sc.far = 460;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbdd7ee, 0x4a4238, 0.8);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xbdd7ee, 0.0012);
    scene.background = new THREE.Color(0x6fb1e8);

    // --- environnement réfléchissant (PMREM) ---
    // Une équirectangulaire dégradée est régénérée quand le ciel change :
    // les carrosseries, le verre et la chaussée mouillée reflètent réellement
    // la couleur du ciel et l'horizon (brief §19 : rendu cinématique).
    this._envCanvas = document.createElement('canvas');
    this._envCanvas.width = 256; this._envCanvas.height = 128;
    this._envTex = new THREE.CanvasTexture(this._envCanvas);
    this._envTex.mapping = THREE.EquirectangularReflectionMapping;
    this._envTex.colorSpace = THREE.SRGBColorSpace;
    this._envPMREM = null;
    this._envHour = -99; this._envWeather = '';
    if (this.renderer) {
      try { this._pmremGenerator = new THREE.PMREMGenerator(this.renderer); }
      catch (e) { console.warn('[env] PMREM indisponible :', e?.message); }
    }

    // --- étoiles ---
    const starGeo = new THREE.BufferGeometry();
    const sp = [];
    for (let i = 0; i < 900; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.03) v.y = Math.abs(v.y) + 0.03;
      v.normalize().multiplyScalar(880); sp.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xdceaff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    scene.add(this.stars);

    // --- soleil/lune visibles (sprites simples) ---
    const disc = (color, size) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(size, 24), new THREE.MeshBasicMaterial({ color, fog: false, transparent: true }));
      scene.add(m); return m;
    };
    this.sunDisc = disc(0xfff2c8, 34);
    this.moonDisc = disc(0xdfe9f7, 20);

    // --- dôme atmosphérique (v0.9) -------------------------------------------
    // Avant : `scene.background` = une couleur unie. Résultat : un mur bleu
    // derrière les immeubles, aucun dégradé, aucun halo solaire — l'un des
    // plus gros « ça fait amateur » du rendu.
    // Maintenant : un dôme qui suit le joueur, avec dégradé zénith/horizon,
    // halo de soleil et bande de brume à l'horizon. Coût : 1 draw call.
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        topColor:     { value: new THREE.Color(0x2f6bb0) },
        horizonColor: { value: new THREE.Color(0xbdd7ee) },
        sunColor:     { value: new THREE.Color(0xfff3e0) },
        sunDir:       { value: new THREE.Vector3(0.3, 0.6, 0.4) },
        sunPower:     { value: 1 },
        haze:         { value: 0.35 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor, horizonColor, sunColor, sunDir;
        uniform float sunPower, haze;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float t = pow(clamp(d.y, 0.0, 1.0), 0.55);
          vec3 col = mix(horizonColor, topColor, t);
          // halo solaire : large diffusion + cœur serré (deux lobes)
          float c = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(c, 6.0) * 0.16 + pow(c, 260.0) * 1.1) * sunPower;
          // brume d'horizon : donne la profondeur atmosphérique
          float band = exp(-abs(d.y) * 14.0);
          col = mix(col, horizonColor, band * haze);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(1500, 40, 24), this.skyMat);
    this.skyDome.frustumCulled = false;
    this.skyDome.renderOrder = -1000;
    scene.add(this.skyDome);

    // --- nuages (v0.9) ------------------------------------------------------
    // Avant : 42 boîtes planes — visibles comme des parallélépipèdes. Maintenant
    // des sprites à dégradé doux, toujours face caméra, qui dérivent.
    this.clouds = new THREE.Group();
    const cloudTex = makeCloudTexture();
    this.cloudMat = new THREE.SpriteMaterial({
      map: cloudTex, color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, fog: false,
    });
    for (let i = 0; i < 64; i++) {
      const sp = new THREE.Sprite(this.cloudMat);
      const sc = randRange(190, 520);
      sp.scale.set(sc, sc * randRange(0.32, 0.52), 1);
      sp.position.set(randRange(-900, 900), randRange(150, 320), randRange(-900, 900));
      sp.userData.speed = randRange(1.4, 4.2);
      this.clouds.add(sp);
    }
    scene.add(this.clouds);

    // halo de soleil (sprite additif) : le disque seul faisait « autocollant »
    this.sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: 0xfff0c0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    }));
    this.sunHalo.scale.setScalar(360);
    scene.add(this.sunHalo);

    // --- pluie (particules recyclées autour de la caméra) ---
    const RAIN_N = 2400;
    this._rainPos = new Float32Array(RAIN_N * 3);
    for (let i = 0; i < RAIN_N; i++) {
      this._rainPos[i * 3] = randRange(-46, 46);
      this._rainPos[i * 3 + 1] = randRange(0, 42);
      this._rainPos[i * 3 + 2] = randRange(-46, 46);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this._rainPos, 3));
    this.rainMat = new THREE.PointsMaterial({
      map: makeRainTexture(), size: 1.15, transparent: true, opacity: 0,
      color: 0xaecbe8, depthWrite: false, sizeAttenuation: true });
    this.rain = new THREE.Points(rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);
  }

  setWeather(name, instant = false) {
    if (!WEATHER_STATES[name]) return;
    this.weatherName = name;
    this._target = { ...WEATHER_STATES[name] };
    if (instant) this.params = { ...this._target };
    Bus.emit('toast', { text: `Météo : ${WEATHER_STATES[name].label}`, kind: '' });
  }
  cycleWeather() {
    const order = ['Clear', 'Cloudy', 'Rain', 'Storm', 'Fog'];
    this.setWeather(order[(order.indexOf(this.weatherName) + 1) % order.length]);
  }
  randomWeather() {
    // transitions plausibles pondérées
    const table = { Clear: ['Clear', 'Cloudy', 'Cloudy', 'Fog'], Cloudy: ['Clear', 'Rain', 'Cloudy'], Rain: ['Cloudy', 'Storm', 'Rain'], Storm: ['Rain', 'Cloudy'], Fog: ['Clear', 'Cloudy'] };
    this.setWeather(pick(table[this.weatherName] || ['Clear']));
  }
  /**
   * Régénère la carte d'environnement (réflexions) quand le ciel change
   * sensiblement. Coût : quelques ms, au maximum toutes les ~0,5 h de jeu.
   */
  updateEnvironment(sky) {
    if (!this._pmremGenerator) return;
    const bucket = Math.floor(this.hour * 2) / 2;
    const weatherKey = this.weatherName + ':' + Math.round(this.params.cloud * 4) + ':' + Math.round(this.rainIntensity * 3);
    if (bucket === this._envHour && weatherKey === this._envWeather) return;
    this._envHour = bucket; this._envWeather = weatherKey;
    const g = this._envCanvas.getContext('2d');
    const top = '#' + new THREE.Color(sky.sky).getHexString();
    const hor = '#' + new THREE.Color(sky.fog).getHexString();
    const gnd = '#' + new THREE.Color(0x2a2c30).getHexString();
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, top); grad.addColorStop(0.48, hor);
    grad.addColorStop(0.52, hor); grad.addColorStop(1, gnd);
    g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
    this._envTex.needsUpdate = true;
    try {
      this._envPMREM?.dispose();
      this._envPMREM = this._pmremGenerator.fromEquirectangular(this._envTex);
      this.scene.environment = this._envPMREM.texture;
    } catch (e) { /* environnement optionnel : jamais bloquant */ }
  }

  advanceTime(hours) { this.hour = (this.hour + hours) % 24; }
  formatHour() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  update(dt, ctx) {
    // ----- horloge -----
    // Cycle réaliste : 20 min de jour (06→20 h) puis 20 min de nuit (20→06 h),
    // soit 40 minutes réelles pour 24 h de jeu (accélérable via timeScale).
    const daylight = this.hour >= CFG.time.dayStart && this.hour < CFG.time.dayEnd;
    const hoursPerSec = daylight
      ? (CFG.time.dayEnd - CFG.time.dayStart) / CFG.time.daySeconds
      : (24 - (CFG.time.dayEnd - CFG.time.dayStart)) / CFG.time.nightSeconds;
    this.hour = (this.hour + dt * hoursPerSec * this.timeScale) % 24;

    // ----- météo : transitions douces + auto -----
    const k = 1 - Math.exp(-dt * 0.25);
    for (const key of ['rain', 'cloud', 'fogDensity', 'gripFactor', 'trafficFactor'])
      this.params[key] = lerp(this.params[key], this._target[key], k);
    this.params.lightning = this._target.lightning && this.params.rain > 0.6;
    this.rainIntensity = this.params.rain;
    this.gripFactor = this.params.gripFactor;
    this.trafficFactor = this.params.trafficFactor;
    if (this.autoWeather) {
      this._autoT -= dt;
      if (this._autoT <= 0) { this._autoT = randRange(75, 140); this.randomWeather(); }
    }
    ctx.audio?.setRain(this.rainIntensity);

    // ----- ciel / soleil / lune -----
    const sky = skyAt(this.hour);
    const grey = this.params.cloud * 0.45;
    const skyCol = sky.sky.clone().lerp(new THREE.Color(0x6d7885), grey);
    this.scene.background.copy(skyCol);   // repli si le dôme est indisponible
    // dégradé du dôme : zénith plus saturé que l'horizon (physique du ciel)
    const topCol = skyCol.clone().multiplyScalar(0.82).lerp(sky.sky.clone().multiplyScalar(1.15), 0.5);
    this.skyMat.uniforms.topColor.value.copy(topCol);
    this.skyMat.uniforms.horizonColor.value.copy(sky.fog.clone().lerp(new THREE.Color(0x8a929c), grey));
    // --- reflets et chaussée mouillée ---
    this.updateEnvironment(sky);
    const wet = clamp(this.rainIntensity * 0.95 + (this.params.cloud > 0.8 ? 0.15 : 0), 0, 1);
    if (ctx?.city) {
      for (const mat of [ctx.city.metroGroundMat, ctx.city.groundMat]) {
        if (!mat) continue;
        mat.roughness = 0.92 - wet * 0.70;      // sol lisse = miroir partiel
        mat.metalness = 0.02 + wet * 0.42;
        mat.color.setScalar(1 - wet * 0.28);
        mat.envMapIntensity = 0.4 + wet * 1.3;
        mat.needsUpdate = false;
      }
    }
    this.scene.fog.color.copy(sky.fog.clone().lerp(new THREE.Color(0x757e89), grey));
    this.scene.fog.density = this.params.fogDensity;

    const dayProg = ((this.hour - 6) % 24 + 24) % 24 / 12;   // 0..1 sur 6h->18h (puis >1 la nuit)
    const isDay = this.hour > 5.4 && this.hour < 20.2;
    const theta = clamp(dayProg, 0, 1) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(theta), Math.max(Math.sin(theta), -0.25) * 0.95 + 0.04, 0.38).normalize();
    const moonTheta = ((((this.hour - 18) % 24) + 24) % 24 / 12) * Math.PI;
    const moonDir = new THREE.Vector3(Math.cos(moonTheta), Math.max(Math.sin(moonTheta), 0.06), -0.3).normalize();
    const pp = ctx.playerPos();

    const elevNow = Math.sin(((this.hour - 6) / 12) * Math.PI);
    const lightDir = (isDay && elevNow > -0.02) ? sunDir : moonDir;
    this.sun.position.set(pp.x + lightDir.x * 210, Math.max(lightDir.y, 0.12) * 210, pp.z + lightDir.z * 210);
    this.sun.target.position.set(pp.x, 0, pp.z);
    this.sun.target.updateMatrixWorld();
    this.sun.color.copy(sky.sun);
    const cloudDim = 1 - this.params.cloud * 0.72;
    this.sun.intensity = sky.sunI * cloudDim + this._flash * 3.2;
    this.hemi.intensity = sky.hemiI * (1 - this.params.cloud * 0.25) + this._flash * 1.4;
    this.hemi.color.copy(sky.fog);

    // disques célestes (suivent le joueur pour rester "à l'infini")
    this.sunDisc.position.set(pp.x + sunDir.x * 820, sunDir.y * 820, pp.z + sunDir.z * 820);
    this.sunDisc.lookAt(pp.x, 10, pp.z);
    this.sunDisc.material.opacity = sunDir.y > -0.02 ? (1 - this.params.cloud) : 0;
    this.sunDisc.material.color.copy(sky.sun);
    this.moonDisc.position.set(pp.x + moonDir.x * 820, moonDir.y * 820, pp.z + moonDir.z * 820);
    this.moonDisc.lookAt(pp.x, 10, pp.z);
    this.moonDisc.material.opacity = this.nightFactor * (1 - this.params.cloud * 0.8);
    this.stars.position.set(pp.x, 0, pp.z);

    // facteur nuit -> fenêtres, lampadaires, étoiles, phares
    const sunElev = Math.sin(((this.hour - 6) / 12) * Math.PI); // -1 minuit, +1 midi
    this.nightFactor = clamp(1 - (sunElev + 0.05) / 0.35, 0, 1);
    this.city.setNightFactor(this.nightFactor);
    this.starMat.opacity = this.nightFactor * (1 - this.params.cloud) * 0.95;
    const autoLights = this.nightFactor > 0.4 || this.rainIntensity > 0.45 || this.params.fogDensity > 0.008;
    this.headlightsOn = this.headlightOverride !== null ? this.headlightOverride : autoLights;
    headlightGlowMat.opacity = this.headlightsOn ? 0.15 : 0;

    // ----- dôme : suit le joueur et reçoit le soleil -----
    this.skyDome.position.set(pp.x, 0, pp.z);
    this.skyMat.uniforms.sunDir.value.copy(sunDir);
    this.skyMat.uniforms.sunColor.value.copy(sky.sun);
    this.skyMat.uniforms.sunPower.value = clamp(sunDir.y * 3, 0, 1) * (1 - this.params.cloud * 0.75) + 0.08;
    this.skyMat.uniforms.haze.value = 0.22 + this.params.cloud * 0.35 + this.params.fogDensity * 26;

    // ----- nuages (sprites) -----
    this.cloudMat.opacity = clamp(this.params.cloud * 0.85, 0, 0.85);
    this.cloudMat.color.copy(sky.cloudCol).lerp(new THREE.Color(0x606a76), this.params.cloud * 0.42);
    for (const cl of this.clouds.children) {
      cl.position.x += dt * (cl.userData.speed || 2) * (1 + this.params.cloud);
      if (cl.position.x > pp.x + 900) cl.position.x = pp.x - 900;
      if (cl.position.x < pp.x - 980) cl.position.x = pp.x + 880;
      if (cl.position.z > pp.z + 900) cl.position.z -= 1800;
      if (cl.position.z < pp.z - 980) cl.position.z += 1800;
    }

    // ----- halo solaire -----
    this.sunHalo.position.set(pp.x + sunDir.x * 800, sunDir.y * 800, pp.z + sunDir.z * 800);
    this.sunHalo.material.color.copy(sky.sun);
    this.sunHalo.material.opacity = clamp(sunDir.y * 4, 0, 1) * (0.55 - this.params.cloud * 0.45);

    // ----- pluie -----
    this.rain.visible = this.rainIntensity > 0.02;
    if (this.rain.visible) {
      this.rainMat.opacity = this.rainIntensity * 0.75;
      this.rain.position.set(pp.x, 0, pp.z);
      const arr = this._rainPos, fall = 52 * dt, wind = 6 * dt;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= fall; arr[i] += wind;
        if (arr[i + 1] < 0) { arr[i + 1] = 42; arr[i] = randRange(-46, 46); arr[i + 2] = randRange(-46, 46); }
        if (arr[i] > 46) arr[i] = -46;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // ----- éclairs d'orage -----
    this._flash = Math.max(0, this._flash - dt * 7);
    if (this.params.lightning) {
      this._lightningT -= dt;
      if (this._lightningT <= 0) {
        this._lightningT = randRange(3.5, 11);
        this._flash = randRange(0.7, 1.4);
        setTimeout(() => ctx.audio?.thunder(), randRange(250, 1100));
      }
    }
  }
}
