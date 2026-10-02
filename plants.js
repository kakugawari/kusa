/*!
 * plants.js — 草と土の絵を描く (canvas)。
 *
 * 草の見た目は core.js の LOOKS (層の並び) にデータとして書いてある。ここはそれを読んで描くだけ。
 * 草を足すときは LOOKS に1行足せばよく、ここは書き直さなくてよい。
 * 届いた画像 (species.image) がある草は、描かずにその画像を使う。
 *
 * 描いた絵は草ごとに1回だけ作って、data URL として使い回す。
 */
(function (root) {
  'use strict';

  const W = 240;          // 植物の箱 (縦長 4:5)。画面ではこれを縮めて出す
  const H = 300;
  const BASE_Y = H * 0.94; // 根元の高さ
  const PAD = 0.84;        // 絵を箱より少し小さく描く割合

  // ---- 道具 ----
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rngFor(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function parse(c) {
    if (c[0] === '#') {
      const n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const m = c.match(/[\d.]+/g).map(Number);
    return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1];
  }
  function mix(a, b, t) {
    const x = parse(a);
    const y = parse(b);
    return 'rgba(' + [0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t)).join(',') + ',' + (x[3] + (y[3] - x[3]) * t) + ')';
  }
  /** 色むら: 明るさを少しずらす */
  function vary(c, d) {
    const x = parse(c);
    const k = 1 + d;
    return 'rgba(' + [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(x[i] * k)))).join(',') + ',' + x[3] + ')';
  }
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // ---- 層ごとの描き方 ----
  // ctx, layer, rng, info (info.tops: 葉先の位置を覚えておき、穂や光の粒を載せる)

  function blade(ctx, x0, len, lean, bw, c0, c1, rib, by) {
    const BASE_Y = by;
    // 葉先が絵の箱から出ないように傾きを抑える (出ると光や葉が四角く切れる)
    const room = W * 0.47 - Math.abs(x0 - W / 2) * (Math.sign(lean) === Math.sign(x0 - W / 2) ? 1 : -1);
    if (Math.abs(lean * len) > room) lean = Math.sign(lean) * room / len;
    const tipX = x0 + lean * len;
    const tipY = BASE_Y - len * Math.sqrt(Math.max(0.15, 1 - lean * lean * 0.5));
    const cx = x0 + lean * len * 0.25;
    const cy = BASE_Y - len * 0.62;
    const g = ctx.createLinearGradient(x0, BASE_Y, tipX, tipY);
    g.addColorStop(0, c0);
    g.addColorStop(0.55, mix(c0, c1, 0.7));
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - bw, BASE_Y);
    ctx.quadraticCurveTo(cx - bw * 0.8, cy, tipX, tipY);
    ctx.quadraticCurveTo(cx + bw * 0.8, cy, x0 + bw, BASE_Y);
    ctx.closePath();
    ctx.fill();
    if (rib) {
      ctx.strokeStyle = rib;
      ctx.lineWidth = Math.max(0.6, bw * 0.28);
      ctx.beginPath();
      ctx.moveTo(x0, BASE_Y - 2);
      ctx.quadraticCurveTo(cx, cy, tipX, tipY);
      ctx.stroke();
    }
    return { x: tipX, y: tipY };
  }

  const DRAW = {
    blades(ctx, L, rng, info) {
      const cx = W / 2;
      // 奥の葉 (暗い) から手前の葉 (明るい) の順に重ねる
      for (let i = 0; i < L.n; i++) {
        const depth = i / Math.max(1, L.n - 1);
        const off = (rng() - 0.5) * 2;
        const x0 = cx + off * L.spread * W * 0.4;
        let len = L.h * H * (0.6 + 0.4 * rng());
        if (L.dome) len *= 1 - Math.abs(off) * L.spread * 0.45;
        const lean = off * 0.55 + (rng() - 0.5) * 0.45;
        const bw = (L.w || 2.4) * (0.8 + rng() * 0.5);
        const shade = (rng() - 0.5) * 0.25 - (1 - depth) * 0.22;
        const tip = blade(ctx, x0, len, lean, bw, vary(L.colors[0], shade), vary(L.colors[1], shade), L.rib, BASE_Y - 4 + rng() * 9);
        info.tops.push(tip);
      }
    },

    heads(ctx, L, rng, info) {
      const tops = info.tops.slice().sort((a, b) => a.y - b.y).slice(0, L.n * 2);
      for (let i = 0; i < L.n && tops.length; i++) {
        const t = tops.splice(Math.floor(rng() * tops.length), 1)[0];
        // 小さな穂: 少し垂れた軸に粒が並ぶ
        const dir = rng() < 0.5 ? -1 : 1;
        for (let k = 0; k < 6; k++) {
          const px = t.x + dir * k * 2.6;
          const py = t.y - 8 + k * 3.2;
          ctx.fillStyle = vary(L.color, (rng() - 0.5) * 0.3);
          ctx.beginPath();
          ctx.ellipse(px, py, 2.4, 4.2, dir * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },

    clover(ctx, L, rng, info) {
      const cx = W / 2;
      for (let i = 0; i < L.n; i++) {
        const off = L.n === 1 ? 0 : (i / (L.n - 1) - 0.5) * 2;
        const x = cx + off * W * 0.24 + (rng() - 0.5) * 18;
        const y = BASE_Y - L.size * H * (0.32 + rng() * 0.4);
        // 茎
        ctx.strokeStyle = vary(L.colors[0], 0.15);
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(cx + off * 12, BASE_Y);
        ctx.quadraticCurveTo(x + off * 6, (BASE_Y + y) / 2, x, y);
        ctx.stroke();
        // 小葉 (ハート形) を放射状に。真上からではなく斜めに見るので、縦をつぶす
        const leafLen = L.size * W * 0.3 * (0.85 + rng() * 0.3);
        const k = L.leaflets;
        const rot0 = -Math.PI / 2 + (rng() - 0.5) * 0.6;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, 0.62);
        for (let j = 0; j < k; j++) {
          const a = rot0 + (j / k) * Math.PI * 2;
          ctx.save();
          ctx.rotate(a - Math.PI / 2);
          const front = Math.sin(a) > 0; // 手前の小葉は明るい
          const g = ctx.createLinearGradient(0, 0, 0, leafLen);
          g.addColorStop(0, vary(L.colors[0], front ? 0.05 : -0.1));
          g.addColorStop(1, vary(L.colors[1], front ? 0.08 : -0.08));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(-leafLen * 0.7, leafLen * 0.25, -leafLen * 0.75, leafLen * 1.05, -leafLen * 0.05, leafLen * 0.86);
          ctx.lineTo(0, leafLen * 0.8);
          ctx.lineTo(leafLen * 0.05, leafLen * 0.86);
          ctx.bezierCurveTo(leafLen * 0.75, leafLen * 1.05, leafLen * 0.7, leafLen * 0.25, 0, 0);
          ctx.fill();
          // 本物のシロツメクサにある、白っぽい V の模様と、中央の葉脈
          ctx.strokeStyle = 'rgba(235,250,225,0.45)';
          ctx.lineWidth = leafLen * 0.07;
          ctx.beginPath();
          ctx.moveTo(-leafLen * 0.32, leafLen * 0.62);
          ctx.lineTo(0, leafLen * 0.42);
          ctx.lineTo(leafLen * 0.32, leafLen * 0.62);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(20,50,20,0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, 2);
          ctx.lineTo(0, leafLen * 0.78);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
        info.tops.push({ x: x, y: y - leafLen * 0.5 });
      }
    },

    sprout(ctx, L, rng, info) {
      const cx = W / 2 + (rng() - 0.5) * 10;
      const top = BASE_Y - H * 0.26;
      ctx.strokeStyle = vary(L.color, -0.1);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, BASE_Y);
      ctx.quadraticCurveTo(cx - 4, (BASE_Y + top) / 2, cx, top);
      ctx.stroke();
      [-1, 1].forEach((d) => {
        ctx.save();
        ctx.translate(cx, top);
        ctx.rotate(d * 0.9 - 0.1);
        const g = ctx.createLinearGradient(0, 0, 0, -26);
        g.addColorStop(0, vary(L.color, -0.15));
        g.addColorStop(1, vary(L.color, 0.2));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, -18, 11, 19, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,60,20,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -34);
        ctx.stroke();
        ctx.restore();
      });
      info.tops.push({ x: cx, y: top - 20 });
    },

    rosette(ctx, L, rng, info) {
      const cx = W / 2;
      const by = BASE_Y - 6;
      const len = L.size * W * 0.55;
      for (let i = 0; i < L.n; i++) {
        const a = (i / L.n) * Math.PI * 2 + rng() * 0.4;
        const l = len * (0.7 + rng() * 0.35);
        const back = Math.sin(a) < 0; // 奥へ伸びる葉は先に描いて暗く
        ctx.save();
        ctx.translate(cx, by);
        ctx.scale(1, 0.45);
        ctx.rotate(a);
        const g = ctx.createLinearGradient(0, 0, l, 0);
        g.addColorStop(0, vary(L.colors[0], back ? -0.15 : 0));
        g.addColorStop(1, vary(L.colors[1], back ? -0.1 : 0.05));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        const steps = 10;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          let w = Math.sin(Math.PI * Math.min(1, t * 1.1)) * l * 0.16;
          if (L.toothed && s % 2 === 0) w *= 0.55; // タンポポのぎざぎざ (後ろ向きの歯)
          ctx.lineTo(l * t, -w);
        }
        for (let s = steps; s >= 1; s--) {
          const t = s / steps;
          let w = Math.sin(Math.PI * Math.min(1, t * 1.1)) * l * 0.16;
          if (L.toothed && s % 2 === 1) w *= 0.55;
          ctx.lineTo(l * t, w);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(235,245,215,0.35)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(l * 0.9, 0);
        ctx.stroke();
        ctx.restore();
      }
      info.tops.push({ x: cx, y: by - 10 });
    },

    flower(ctx, L, rng, info) {
      const cx = W / 2;
      for (let i = 0; i < L.n; i++) {
        const off = L.n === 1 ? (rng() - 0.5) * 0.3 : (i / (L.n - 1) - 0.5) * 1.4;
        const x = cx + off * W * 0.25;
        const y = BASE_Y - L.h * H * (0.85 + rng() * 0.2);
        const r = L.size * W * 0.5;
        // 中が空洞の茎 (少し白っぽい緑)
        ctx.strokeStyle = '#8fb065';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + off * 10, BASE_Y - 4);
        ctx.quadraticCurveTo(x - off * 8, (BASE_Y + y) / 2, x, y + r * 0.3);
        ctx.stroke();
        // がく
        ctx.fillStyle = '#5f8a3a';
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.35, r * 0.45, r * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        // 花びら: 細い舌状花を何重にも。斜めに見るので縦をつぶす
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, 0.62);
        for (let ring = 0; ring < 3; ring++) {
          const rr = r * (1 - ring * 0.28);
          const cnt = 26 - ring * 6;
          for (let k = 0; k < cnt; k++) {
            const a = (k / cnt) * Math.PI * 2 + ring * 0.2;
            ctx.save();
            ctx.rotate(a);
            ctx.fillStyle = vary(L.color, (rng() - 0.5) * 0.2 + ring * 0.06 - (Math.sin(a) < 0 ? 0.12 : 0));
            ctx.beginPath();
            ctx.ellipse(rr * 0.55, 0, rr * 0.5, rr * 0.09, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
        ctx.fillStyle = vary(L.color, -0.18);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        info.tops.push({ x: x, y: y - r * 0.4 });
      }
    },

    puff(ctx, L, rng, info) {
      const cx = W / 2;
      for (let i = 0; i < L.n; i++) {
        const off = L.n === 1 ? 0.15 : (i / (L.n - 1) - 0.5) * 1.6;
        const x = cx + off * W * 0.24 + (rng() - 0.5) * 12;
        const y = BASE_Y - L.h * H * (0.8 + rng() * 0.25);
        const r = L.size * W * 0.5;
        ctx.strokeStyle = '#9ab478';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(cx + off * 8, BASE_Y - 4);
        ctx.quadraticCurveTo(x - off * 6, (BASE_Y + y) / 2, x, y);
        ctx.stroke();
        // 綿毛: 中心から細い毛が放射状に。先に小さな白い傘
        const cnt = 70;
        for (let k = 0; k < cnt; k++) {
          const a = rng() * Math.PI * 2;
          const z = rng() * 2 - 1;               // 球の上の点 (奥行き)
          const rad = r * Math.sqrt(1 - z * z * 0.3);
          const ex = x + Math.cos(a) * rad * Math.sqrt(1 - z * z);
          const ey = y + Math.sin(a) * rad * Math.sqrt(1 - z * z) * 0.95;
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.35 * (z + 1) / 2) + ')';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,' + (0.45 + 0.4 * (z + 1) / 2) + ')';
          ctx.beginPath();
          ctx.arc(ex, ey, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#7a6a4a';
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        info.tops.push({ x: x, y: y - r });
      }
    },

    plume(ctx, L, rng, info) {
      const cx = W / 2;
      for (let i = 0; i < L.n; i++) {
        const off = L.n === 1 ? 0.1 : (i / (L.n - 1) - 0.5) * 1.5;
        const x = cx + off * W * 0.22 + (rng() - 0.5) * 10;
        const y = BASE_Y - L.h * H * (0.85 + rng() * 0.15);
        const len = L.size * H;
        const bend = (off >= 0 ? 1 : -1) * (0.4 + rng() * 0.4);
        // 茎
        ctx.strokeStyle = '#8a8a58';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx + off * 10, BASE_Y);
        ctx.quadraticCurveTo(x, (BASE_Y + y) / 2 + 20, x, y + len * 0.6);
        ctx.stroke();
        // 穂: 先から下へ垂れる細い枝に、ふわっとした毛
        for (let k = 0; k < 16; k++) {
          const t = k / 15;
          const sx = x + bend * t * 6;
          const sy = y + t * len * 0.6;
          const ex = sx + bend * (12 + rng() * 18) * (0.4 + t);
          const ey = sy + 10 + rng() * 22;
          ctx.strokeStyle = vary(L.color, (rng() - 0.5) * 0.25);
          ctx.globalAlpha = 0.75;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo((sx + ex) / 2 + bend * 4, sy, ex, ey);
          ctx.stroke();
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        info.tops.push({ x: x, y: y });
      }
    },

    drops(ctx, L, rng, info) {
      const tops = info.tops.length ? info.tops : [{ x: W / 2, y: BASE_Y - 60 }];
      for (let i = 0; i < L.n; i++) {
        const t = tops[Math.floor(rng() * tops.length)];
        const k = 0.3 + rng() * 0.6;
        const x = t.x + (W / 2 - t.x) * k * 0.4;
        const y = t.y + (BASE_Y - t.y) * k;
        const r = 2.2 + rng() * 2.4;
        ctx.fillStyle = 'rgba(200,235,255,0.55)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    sparkle(ctx, L, rng, info) {
      const tops = info.tops.length ? info.tops : [{ x: W / 2, y: BASE_Y - 80 }];
      for (let i = 0; i < L.n; i++) {
        const t = tops[Math.floor(rng() * tops.length)];
        // 絵の端からはみ出さない所にだけ置く (はみ出すと光が四角く切れる)
        const x = Math.max(W * 0.12, Math.min(W * 0.88, t.x + (rng() - 0.5) * 40));
        const y = Math.max(H * 0.14, t.y + (rng() - 0.3) * 50);
        const r = 1.6 + rng() * 2.4;
        ctx.save();
        if (L.glow) { ctx.shadowColor = L.color; ctx.shadowBlur = 10; }
        ctx.fillStyle = L.color;
        ctx.beginPath();
        // 4つの角の光
        ctx.moveTo(x, y - r * 2.2);
        ctx.quadraticCurveTo(x, y, x + r * 2.2, y);
        ctx.quadraticCurveTo(x, y, x, y + r * 2.2);
        ctx.quadraticCurveTo(x, y, x - r * 2.2, y);
        ctx.quadraticCurveTo(x, y, x, y - r * 2.2);
        ctx.fill();
        ctx.restore();
      }
    },

    tint(ctx, L) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = L.alpha;
      const g = ctx.createLinearGradient(0, BASE_Y, W, 0);
      L.colors.forEach((c, i) => g.addColorStop(i / Math.max(1, L.colors.length - 1), c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    },

    crystal(ctx, L) {
      ctx.save();
      // 全体を少し透かし、上から白い光の筋を入れる (透き通った結晶)
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0,0,0,' + L.alpha + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-atop';
      for (let i = 0; i < 6; i++) {
        const g = ctx.createLinearGradient(i * 40, 0, i * 40 + 30, H);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }
  };

  /** 根元の土のかたまり。茎の切り口を隠し、土から生えているように見せる。 */
  function mound(ctx, rng) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const fade = ctx.createLinearGradient(0, BASE_Y - 14, 0, BASE_Y + 6);
    fade.addColorStop(0, 'rgba(40,26,14,0)');
    fade.addColorStop(1, 'rgba(40,26,14,0.85)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, BASE_Y - 14, W, 30);
    ctx.restore();
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, BASE_Y + 4, 2, W / 2, BASE_Y + 4, W * 0.3);
    g.addColorStop(0, 'rgba(62,42,24,0.8)');
    g.addColorStop(0.6, 'rgba(70,48,28,0.45)');
    g.addColorStop(1, 'rgba(70,48,28,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(W / 2, BASE_Y + 4, W * 0.28, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng());
      const t = 70 + rng() * 60;
      ctx.fillStyle = 'rgba(' + Math.round(t * 1.4) + ',' + Math.round(t) + ',' + Math.round(t * 0.65) + ',0.8)';
      ctx.beginPath();
      ctx.arc(W / 2 + Math.cos(a) * d * W * 0.25, BASE_Y + 4 + Math.sin(a) * d * 8, 0.8 + rng() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- 植物1つを描く ----
  function drawPlant(species) {
    const look = species.look || { layers: [{ t: 'blades', n: 20, h: 0.5, spread: 0.5, w: 2.4, colors: ['#355f22', '#8fbf4c'] }] };
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const rng = rngFor(hash(species.id));
    const info = { tops: [] };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // まわりに余白を残して描く (光をにじませる場所。端で光が四角く切れないように)
    ctx.translate(W / 2, BASE_Y);
    ctx.scale(PAD, PAD);
    ctx.translate(-W / 2, -BASE_Y);
    look.layers.forEach((L) => { if (DRAW[L.t]) DRAW[L.t](ctx, L, rng, info); });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    mound(ctx, rng);
    if (!look.glow) return c;
    // 光る草: 絵のまわりに同じ色の光をにじませる (光を貼り付けず、草そのものから出す)
    const out = makeCanvas(W, H);
    const o = out.getContext('2d');
    o.shadowColor = look.glow;
    o.shadowBlur = 22;
    o.drawImage(c, 0, 0);
    o.shadowBlur = 8;
    o.drawImage(c, 0, 0);
    o.shadowBlur = 0;
    o.drawImage(c, 0, 0);
    return out;
  }

  const cache = {};   // id → data URL
  const alpha = {};   // id → { w, h, data } (指が草の葉に触れたかを調べるための透明度)

  /** 草の絵の URL。届いた画像があればそれ、無ければ描いた絵。 */
  function url(species) {
    if (species.image) return species.image;
    if (!cache[species.id]) {
      const c = drawPlant(species);
      cache[species.id] = c.toDataURL('image/png');
      keepAlpha(species.id, c);
    }
    return cache[species.id];
  }

  function keepAlpha(id, c) {
    try {
      alpha[id] = { w: c.width, h: c.height, data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
    } catch (e) { /* 読めない画像なら、箱全体を草とみなす */ }
  }

  /**
   * 絵の (u, v) (0〜1、左上から) に葉や花があるか。透明な所なら false。
   * 奥のマスに重なって見える手前の草の、すき間を押したときに、奥のマスへ通すために使う。
   */
  function opaqueAt(species, u, v) {
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    if (species.image && !(species.id in alpha)) {
      alpha[species.id] = null; // 読み込み中
      const img = new Image();
      img.onload = function () {
        const c = makeCanvas(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, 0, 0);
        keepAlpha(species.id, c);
      };
      img.src = species.image;
    }
    if (!species.image && !alpha[species.id]) url(species);
    const a = alpha[species.id];
    if (!a) return true;
    // 指の太さぶん、まわりも見る
    const r = 6;
    const cx = Math.round(u * (a.w - 1));
    const cy = Math.round(v * (a.h - 1));
    for (let dy = -r; dy <= r; dy += 3) {
      for (let dx = -r; dx <= r; dx += 3) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue;
        if (a.data[(y * a.w + x) * 4 + 3] > 40) return true;
      }
    }
    return false;
  }

  /** 草が光るなら、その色 (根元の土への照り返しに使う)。 */
  function glow(species) { return (species.look && species.look.glow) || null; }

  /** 合成のとき飛ばす葉の色。 */
  function leafColor(species) {
    const L = species.look && species.look.layers.find((l) => l.colors || l.color);
    if (!L) return '#78b84a';
    return L.colors ? L.colors[1] : L.color;
  }

  // ---- 土 ----
  /**
   * ジオラマの土を描く。凹凸と色むら、小石、苔、枯れ葉。
   * 動かないので最初に1回だけ描く (毎コマ塗らない)。
   */
  function soil(canvas, seed) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const rng = rngFor(seed || 7);
    ctx.fillStyle = '#4a3424';
    ctx.fillRect(0, 0, w, h);
    // 大きなむら (湿った所・乾いた所)
    for (let i = 0; i < 40; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = (0.08 + rng() * 0.18) * w;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rng() < 0.5;
      g.addColorStop(0, dark ? 'rgba(30,18,10,0.35)' : 'rgba(120,90,60,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // 土の粒 (凹凸): 上が明るく下に影 (光は左上から)
    const grains = Math.round(w * h / 90);
    for (let i = 0; i < grains; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 0.6 + rng() * 2.4;
      const tone = 40 + rng() * 60;
      ctx.fillStyle = 'rgba(15,8,4,0.35)';
      ctx.beginPath();
      ctx.arc(x + r * 0.4, y + r * 0.5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgb(' + Math.round(tone * 1.5) + ',' + Math.round(tone * 1.05) + ',' + Math.round(tone * 0.7) + ')';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 苔
    for (let i = 0; i < 9; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = (0.025 + rng() * 0.04) * w;
      for (let k = 0; k < 160; k++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * r;
        ctx.fillStyle = 'rgba(' + Math.round(70 + rng() * 50) + ',' + Math.round(110 + rng() * 50) + ',' + Math.round(40 + rng() * 20) + ',' + (0.5 + rng() * 0.4) + ')';
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, 1 + rng() * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 枯れ葉
    for (let i = 0; i < 16; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const l = (0.018 + rng() * 0.022) * w;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng() * Math.PI * 2);
      ctx.fillStyle = 'rgba(20,10,5,0.4)';
      ctx.beginPath();
      ctx.ellipse(2, 2, l, l * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ['#8a5a2a', '#a0703a', '#6e4a26', '#b08440'][Math.floor(rng() * 4)];
      ctx.beginPath();
      ctx.ellipse(0, 0, l, l * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,35,15,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-l, 0);
      ctx.lineTo(l, 0);
      ctx.stroke();
      ctx.restore();
    }
    // 小石
    for (let i = 0; i < 22; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = (0.006 + rng() * 0.014) * w;
      const g0 = 120 + rng() * 60;
      ctx.fillStyle = 'rgba(10,5,2,0.45)';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.35, y + r * 0.45, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 0, x, y, r * 1.1);
      g.addColorStop(0, 'rgb(' + Math.round(g0 + 50) + ',' + Math.round(g0 + 45) + ',' + Math.round(g0 + 35) + ')');
      g.addColorStop(1, 'rgb(' + Math.round(g0 * 0.6) + ',' + Math.round(g0 * 0.56) + ',' + Math.round(g0 * 0.5) + ')');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.1, r * 0.8, rng(), 0, Math.PI * 2);
      ctx.fill();
    }
    // 光: 左上を少し明るく、手前のふちを少し暗く
    const light = ctx.createLinearGradient(0, 0, w, h);
    light.addColorStop(0, 'rgba(255,235,200,0.10)');
    light.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, w, h);
  }

  root.KusaArt = { url: url, opaqueAt: opaqueAt, glow: glow, leafColor: leafColor, soil: soil, drawPlant: drawPlant, W: W, H: H };
})(typeof globalThis !== 'undefined' ? globalThis : this);
