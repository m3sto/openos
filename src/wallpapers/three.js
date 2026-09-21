/* ==========================================================================
   OpenOS · wallpapers/three.js — WebGL duvar kâğıtları

   Three.js sisteme dekoratif olarak değil, gerçekten kazandığı yerden
   giriyor. Canvas 2D duvar kâğıtları güzel ama düz: her kare CPU'da
   çiziliyor, derinlik yok, ışık yok. Bunlar GPU'da çalışıyor, derinliği ve
   ışığı gerçekten hesaplıyor ve 15 kare/sn yerine ekranın hızında akıyor.

   Motor **tembel yükleniyor**: Three.js sıkıştırılmış hâlde bile birkaç yüz
   kilobayt ve sistemin açılışı onu beklememeli. `import('three')` yalnızca
   kullanıcı 3B bir duvar kâğıdı seçtiğinde çalışıyor; seçmezse hiç
   indirilmiyor.

   Her 3B duvar kâğıdının bir de ucuz 2D `draw()` karşılığı var. İki işe
   yarıyor: Ayarlar'daki küçük önizlemeler eşzamanlı çiziliyor (hepsi için
   ayrı WebGL bağlamı açmak saçma olurdu) ve WebGL yoksa duvar kâğıdı yine
   de görünüyor — boş ekran yerine yaklaşık bir görüntü.
   ========================================================================== */

let THREE = null;

/** Motoru bir kez yükler. */
async function motor() {
  if (!THREE) THREE = await import('three');
  return THREE;
}

/** Tarayıcı WebGL verebiliyor mu — spesifikasyona değil canlı yoklamaya bakılır. */
export function webglVarMi() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/* ------------------------------------------------------------ ortak iskelet */

/**
 * Sahneyi kurar ve ortak denetleyiciyi döndürür.
 * @returns {{ciz:(t:number)=>void, boyut:(w:number,h:number)=>void, yok:()=>void}}
 */
async function iskelet(canvas, kurSahne) {
  const T = await motor();
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const sahne = new T.Scene();
  const kamera = new T.PerspectiveCamera(55, 1, 0.1, 100);
  kamera.position.set(0, 0, 8);

  const parca = kurSahne(T, sahne, kamera);

  return {
    ciz(t) { parca.guncelle?.(t); renderer.render(sahne, kamera); },
    boyut(w, h) {
      renderer.setSize(w, h, false);
      kamera.aspect = w / Math.max(1, h);
      kamera.updateProjectionMatrix();
      parca.boyut?.(w, h);
    },
    yok() {
      /* GPU kaynakları elle bırakılmalı: tarayıcı aynı anda sınırlı sayıda
         WebGL bağlamı tutuyor ve duvar kâğıdı değiştikçe sızdırırsak
         birkaç değişimden sonra "context lost" alıyoruz. */
      sahne.traverse(o => {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material?.dispose?.();
      });
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}

/* ------------------------------------------------------------------ Prizma */

function kurPrizma(T, sahne, kamera) {
  sahne.background = new T.Color('#05060f');
  sahne.fog = new T.FogExp2('#05060f', 0.055);

  const cisimler = [];
  const renkler = ['#0a84ff', '#bf5af2', '#64d2ff', '#ff375f', '#30d158'];
  for (let i = 0; i < 14; i++) {
    const g = new T.IcosahedronGeometry(0.5 + Math.random() * 0.75, 0);
    const m = new T.MeshPhongMaterial({
      color: new T.Color(renkler[i % renkler.length]),
      emissive: new T.Color(renkler[i % renkler.length]).multiplyScalar(0.16),
      shininess: 90, specular: 0x9fd2ff,
      flatShading: true, transparent: true, opacity: 0.86,
    });
    const mesh = new T.Mesh(g, m);
    mesh.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 9, -Math.random() * 14);
    mesh.userData.hiz = 0.1 + Math.random() * 0.25;
    mesh.userData.eksen = new T.Vector3(Math.random(), Math.random(), Math.random()).normalize();
    sahne.add(mesh);
    cisimler.push(mesh);
  }

  sahne.add(new T.AmbientLight(0x2b3a6b, 1.4));
  const l1 = new T.PointLight(0x0a84ff, 220, 40); l1.position.set(-9, 6, 6); sahne.add(l1);
  const l2 = new T.PointLight(0xbf5af2, 180, 40); l2.position.set(9, -5, 4);  sahne.add(l2);

  return {
    guncelle(t) {
      for (const o of cisimler) {
        o.rotateOnAxis(o.userData.eksen, 0.0032 * o.userData.hiz * 10);
        o.position.y += Math.sin(t * 0.0006 + o.position.x) * 0.0022;
      }
      kamera.position.x = Math.sin(t * 0.00018) * 1.1;
      kamera.position.y = Math.cos(t * 0.00014) * 0.7;
      kamera.lookAt(0, 0, -5);
    },
  };
}

/* ------------------------------------------------------------------- Dalga */

const DALGA_VERTEX = /* glsl */`
  uniform float uZaman;
  varying float vYukseklik;
  varying vec3  vNormal;
  varying vec2  vUv;

  /* Dört yön, dört frekans. Tek dalga yapay duruyor; farklı yönlerde ve
     hızlarda üst üste binen dalgalar su gibi kırılıyor. Genlikler frekansla
     ters orantılı — doğada da öyle: uzun dalga yüksek, kısa dalga alçak. */
  const vec2  Y1 = vec2( 1.00,  0.00);  const float F1 = 1.70, A1 = 0.200, H1 =  0.90;
  const vec2  Y2 = vec2( 0.00,  1.00);  const float F2 = 1.30, A2 = 0.160, H2 = -0.70;
  const vec2  Y3 = vec2( 0.71,  0.71);  const float F3 = 2.30, A3 = 0.110, H3 =  0.60;
  const vec2  Y4 = vec2(-0.60,  0.80);  const float F4 = 3.70, A4 = 0.060, H4 =  1.30;

  float dalga(vec2 p, float t) {
    return A1 * sin(F1 * dot(Y1, p) + H1 * t)
         + A2 * sin(F2 * dot(Y2, p) + H2 * t)
         + A3 * sin(F3 * dot(Y3, p) + H3 * t)
         + A4 * sin(F4 * dot(Y4, p) + H4 * t);
  }

  /* Normal, komşu noktaları örnekleyerek değil türevden çıkarılıyor:
     örnekleme ızgara sıklığına bağlı olarak takırdıyor, türev her
     çözünürlükte pürüzsüz. Yüzey aydınlatması olmadan dalgalar hiç
     okunmuyordu — ekranda tek düze bir leke gibi duruyordu. */
  vec3 normalHesapla(vec2 p, float t) {
    vec2 d = A1 * F1 * Y1 * cos(F1 * dot(Y1, p) + H1 * t)
           + A2 * F2 * Y2 * cos(F2 * dot(Y2, p) + H2 * t)
           + A3 * F3 * Y3 * cos(F3 * dot(Y3, p) + H3 * t)
           + A4 * F4 * Y4 * cos(F4 * dot(Y4, p) + H4 * t);
    return normalize(vec3(-d, 1.0));
  }

  void main() {
    vUv = uv;
    vec3 pos = position;
    float h = dalga(pos.xy, uZaman);
    pos.z += h;
    vYukseklik = h;
    vNormal = normalHesapla(pos.xy, uZaman);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const DALGA_FRAGMENT = /* glsl */`
  precision mediump float;
  uniform vec3 uDip;
  uniform vec3 uTepe;
  uniform vec3 uVurgu;
  varying float vYukseklik;
  varying vec3  vNormal;
  varying vec2  vUv;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 isik = normalize(vec3(-0.35, 0.55, 0.76));

    float yayinik = max(dot(n, isik), 0.0);
    /* Yansıma: bakış yönü sabit alınıyor (düzlem kameraya göre neredeyse
       sabit duruyor), böylece parlama dalga sırtlarında toplanıyor. */
    vec3 bakis = vec3(0.0, 0.0, 1.0);
    float parlama = pow(max(dot(reflect(-isik, n), bakis), 0.0), 34.0);

    float k = clamp(vYukseklik * 1.6 + 0.5, 0.0, 1.0);
    vec3 renk = mix(uDip, uTepe, k);
    renk *= 0.42 + 0.68 * yayinik;
    renk += uVurgu * parlama * 0.55;
    renk += uVurgu * pow(k, 8.0) * 0.28;

    /* Ufka doğru yumuşak kararma — düzlemin kesildiği yer belli olmasın.
       Yalnızca uzak kenarda, yüzeyin tamamını yutmayacak kadar. */
    float ufuk = smoothstep(0.0, 0.30, vUv.y);
    gl_FragColor = vec4(renk * mix(0.15, 1.0, ufuk), 1.0);
  }
`;

function kurDalga(T, sahne, kamera) {
  sahne.background = new T.Color('#04060d');
  const g = new T.PlaneGeometry(46, 34, 240, 180);
  const m = new T.ShaderMaterial({
    vertexShader: DALGA_VERTEX,
    fragmentShader: DALGA_FRAGMENT,
    uniforms: {
      uZaman: { value: 0 },
      uDip:   { value: new T.Color('#05132e') },
      uTepe:  { value: new T.Color('#1d6bd8') },
      uVurgu: { value: new T.Color('#7fe9ff') },
    },
    wireframe: false,
  });
  const yuzey = new T.Mesh(g, m);
  /* Neredeyse yatık ve kameraya yakın: dik açıdan bakınca dalgalar düz bir
     doku gibi duruyor, sıyırma açısında ise derinlik kazanıyor. */
  yuzey.rotation.x = -1.33;
  yuzey.position.set(0, -1.1, -2.0);
  sahne.add(yuzey);

  kamera.position.set(0, 1.15, 4.2);
  kamera.lookAt(0, -0.35, -9);

  return {
    guncelle(t) { m.uniforms.uZaman.value = t * 0.001; },
  };
}

/* ------------------------------------------------- 2D karşılıkları (önizleme) */

const gradyan = (ctx, w, h, duraklar) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  duraklar.forEach(([p, c]) => g.addColorStop(p, c));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
};

function cizPrizma(ctx, w, h) {
  gradyan(ctx, w, h, [[0, '#070a1a'], [0.6, '#0b1130'], [1, '#05060f']]);
  const renkler = ['#0a84ff', '#bf5af2', '#64d2ff', '#ff375f', '#30d158'];
  for (let i = 0; i < 14; i++) {
    const x = (i * 97 % w), y = ((i * 211) % h), r = w * (0.03 + (i % 4) * 0.014);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(i);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = renkler[i % renkler.length];
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function cizDalga(ctx, w, h) {
  gradyan(ctx, w, h, [[0, '#04060d'], [0.55, '#0a1c3d'], [1, '#02040a']]);
  ctx.lineWidth = Math.max(1, w / 900);
  for (let i = 0; i < 28; i++) {
    const y = h * 0.42 + i * (h * 0.022);
    const k = i / 28;
    ctx.strokeStyle = `rgba(${Math.round(30 + k * 100)},${Math.round(110 + k * 110)},${Math.round(216 + k * 39)},${0.16 + k * 0.5})`;
    ctx.beginPath();
    for (let x = 0; x <= w; x += Math.max(2, w / 220)) {
      const yy = y + Math.sin(x * 0.011 + i * 0.5) * (h * 0.028) + Math.sin(x * 0.005 - i * 0.3) * (h * 0.016);
      x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
    }
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ katalog */

export const UC_BOYUTLU = [
  { id: 'prizma', name: 'Prizma (3B)', dark: true, animated: true, webgl: true,
    kur: (canvas) => iskelet(canvas, kurPrizma), draw: cizPrizma },
  { id: 'dalga',  name: 'Dalga (3B)',  dark: true, animated: true, webgl: true,
    kur: (canvas) => iskelet(canvas, kurDalga),  draw: cizDalga },
];

export default UC_BOYUTLU;
