/*!
 * plants.js — 草と土の絵を描く (canvas)。
 *
 * 草の見た目は looks.js の LOOKS (層の並び) にデータとして書いてある。ここはそれを読んで描くだけ。
 * 草を足すときは LOOKS に1行足せばよく、ここは書き直さなくてよい。
 * 届いた画像 (looks.js の IMAGES) がある草は、描かずにその画像を使う。
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

  // 光は左上の奥から当たる (草・石・影はすべてこの向きにそろえる)
  const LIGHT = { x: -0.62, y: -0.78 };

  const Looks = root.KusaLooks || { LOOKS: {}, IMAGES: {} };
  const FALLBACK = { layers: [{ t: 'blades', n: 20, h: 0.5, spread: 0.5, w: 2.4, colors: ['#355f22', '#8fbf4c'] }] };
  function lookOf(species) { return Looks.LOOKS[species.id] || FALLBACK; }
  function imageOf(species) {
    const e = Looks.IMAGES[species.id];
    return e ? (typeof e === 'string' ? e : e.src) : null;
  }
  /** 牧場での見た目の大きさ (1 = マスいっぱい)。画像に書いてあればそれ、無ければ 1 */
  function sizeOf(species) {
    const e = Looks.IMAGES[species.id];
    return e && typeof e === 'object' && e.size ? e.size : 1;
  }

  /** 草の背の高さ (0〜1)。影の長さ・濃さに使う。 */
  function heightOf(species) {
    if (imageOf(species)) return Math.min(1, 0.25 + sizeOf(species) * 0.55);
    let h = 0.2;
    lookOf(species).layers.forEach((L) => {
      if (L.h) h = Math.max(h, L.h);
      if (L.t === 'clover') h = Math.max(h, L.size * 0.9);
      if (L.t === 'rosette') h = Math.max(h, 0.18);
      if (L.t === 'sprout') h = Math.max(h, 0.28);
    });
    return Math.min(1, h);
  }

  // ---- 層ごとの描き方 ----
  // ctx, layer, rng, info (info.tops: 葉先の位置を覚えておき、穂や光の粒を載せる)

  /**
   * 細い葉を1枚。根元から先へ細くなり、少しS字に曲がる。
   * 光の当たる側 (左) を明るく、反対側を暗くし、葉脈と光沢を入れる。
   */
  function blade(ctx, o) {
    const by = o.by;
    const len = o.len;
    // 葉先が箱から出ないように傾きを抑える (出ると光や葉が四角く切れる)
    let lean = o.lean;
    const room = W * 0.47 - Math.abs(o.x - W / 2) * (Math.sign(lean) === Math.sign(o.x - W / 2) ? 1 : -1);
    if (Math.abs(lean * len) > room) lean = Math.sign(lean) * room / len;
    const droop = o.droop || 0;
    const p0 = { x: o.x, y: by };
    const p1 = { x: o.x + lean * len * 0.08, y: by - len * 0.45 };
    const p2 = { x: o.x + lean * len * 0.6, y: by - len * (0.88 - droop * 0.2) };
    const p3 = { x: o.x + lean * len, y: by - len * (1 - droop) };
    const N = 12;
    const mid = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const u = 1 - t;
      mid.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        t: t
      });
    }
    const left = [];
    const right = [];
    mid.forEach((m, k) => {
      const a = mid[Math.max(0, k - 1)];
      const b = mid[Math.min(N, k + 1)];
      let nx = -(b.y - a.y);
      let ny = b.x - a.x;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      const w = o.bw * Math.pow(1 - m.t, 0.75) * (m.t < 0.06 ? 0.75 + m.t * 4 : 1);
      left.push({ x: m.x + nx * w, y: m.y + ny * w });
      right.push({ x: m.x - nx * w, y: m.y - ny * w });
    });
    const tip = mid[N];
    const g = ctx.createLinearGradient(p0.x, p0.y, tip.x, tip.y);
    g.addColorStop(0, o.c0);
    g.addColorStop(0.5, mix(o.c0, o.c1, 0.65));
    g.addColorStop(1, o.c1);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    left.forEach((p) => ctx.lineTo(p.x, p.y));
    for (let k = N; k >= 0; k--) ctx.lineTo(right[k].x, right[k].y);
    ctx.closePath();
    ctx.fill();
    // 光の当たる側の半分を明るく、反対側を暗く (どちらが光の側かは、葉の向きで決まる)
    const side = left[Math.floor(N / 2)].x < right[Math.floor(N / 2)].x ? left : right;
    const shade = side === left ? right : left;
    halfFill(ctx, mid, side, 'rgba(255,250,215,' + (0.16 * o.lit).toFixed(3) + ')');
    halfFill(ctx, mid, shade, 'rgba(10,25,5,' + (0.18 * (1.2 - o.lit)).toFixed(3) + ')');
    if (o.rib) {
      ctx.strokeStyle = o.rib;
      ctx.lineWidth = Math.max(0.5, o.bw * 0.22);
      ctx.beginPath();
      ctx.moveTo(mid[1].x, mid[1].y);
      for (let k = 2; k < N; k++) ctx.lineTo(mid[k].x, mid[k].y);
      ctx.stroke();
    }
    if (o.gloss > 0) {
      // 光沢: 葉の中ほど、光の側に細い白い筋
      ctx.strokeStyle = 'rgba(255,255,240,' + (0.32 * o.gloss).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.6, o.bw * 0.35);
      ctx.beginPath();
      for (let k = 4; k <= 8; k++) {
        const m = mid[k];
        const sp = side[k];
        const x = m.x + (sp.x - m.x) * 0.45;
        const y = m.y + (sp.y - m.y) * 0.45;
        if (k === 4) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return { x: tip.x, y: tip.y };
  }

  function halfFill(ctx, mid, edge, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(mid[0].x, mid[0].y);
    mid.forEach((p) => ctx.lineTo(p.x, p.y));
    for (let k = edge.length - 1; k >= 0; k--) ctx.lineTo(edge[k].x, edge[k].y);
    ctx.closePath();
    ctx.fill();
  }

  const DRAW = {
    blades(ctx, L, rng, info) {
      const cx = W / 2;
      const items = [];
      for (let i = 0; i < L.n; i++) {
        const off = (rng() - 0.5) * 2;
        items.push({ off: off, depth: rng(), r: [rng(), rng(), rng(), rng(), rng(), rng(), rng()] });
      }
      // 奥の葉 (depth 小) から手前の葉へ。奥ほど暗く、少し青みがかり、根元が少し上 (奥) にある
      items.sort((a, b) => a.depth - b.depth);
      items.forEach((it) => {
        const r = it.r;
        const x0 = cx + it.off * L.spread * W * 0.4;
        let len = L.h * H * (0.55 + 0.45 * r[0]);
        if (L.dome) len *= 1 - Math.abs(it.off) * L.spread * 0.45;
        const lean = it.off * 0.5 + (r[1] - 0.5) * 0.5;
        const bw = (L.w || 2.4) * (0.7 + r[2] * 0.7);
        const dark = (1 - it.depth) * 0.3;
        let c0 = vary(L.colors[0], (r[3] - 0.5) * 0.2 - dark);
        let c1 = vary(L.colors[1], (r[4] - 0.5) * 0.25 - dark * 0.8);
        if (!L.dry && r[5] < 0.14) c1 = mix(c1, '#b8a860', 0.45); // 先の枯れかけた葉 (色むら)
        if (it.depth < 0.35) { c0 = mix(c0, '#1a2a30', 0.15); c1 = mix(c1, '#2a3a40', 0.12); }
        const tip = blade(ctx, {
          x: x0, by: BASE_Y - 3 - (1 - it.depth) * 5 + r[6] * 4, len: len, lean: lean,
          droop: r[5] < 0.3 ? 0.08 + r[6] * 0.12 : 0, bw: bw, c0: c0, c1: c1, rib: L.rib,
          lit: 0.4 + it.depth * 0.8, gloss: L.gloss === undefined ? 0.5 : L.gloss
        });
        info.tops.push(tip);
      });
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
      const leaves = [];
      for (let i = 0; i < L.n; i++) {
        const off = L.n === 1 ? 0 : (i / (L.n - 1) - 0.5) * 2;
        leaves.push({
          x: cx + off * W * 0.24 + (rng() - 0.5) * 22,
          y: BASE_Y - L.size * H * (0.25 + rng() * 0.5),
          off: off,
          size: 0.75 + rng() * 0.5,
          flat: 0.42 + rng() * 0.4,       // 葉の面の傾き (斜めに見える度合い)
          rot: (rng() - 0.5) * 0.9,
          tone: (rng() - 0.5) * 0.18
        });
      }
      // 背の高い (奥の) 葉から描く
      leaves.sort((a, b) => a.y - b.y);
      leaves.forEach((lf, idx) => {
        const back = 1 - idx / Math.max(1, leaves.length - 1); // 1 = いちばん奥
        // 茎: 根元から少し曲がって伸びる
        ctx.strokeStyle = vary(L.colors[0], 0.1 - back * 0.15);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(cx + lf.off * 10, BASE_Y);
        ctx.quadraticCurveTo(lf.x + lf.off * 10, (BASE_Y + lf.y) / 2 + 8, lf.x, lf.y);
        ctx.stroke();
        const leafLen = L.size * W * 0.3 * lf.size;
        const k = L.leaflets;
        const rot0 = -Math.PI / 2 + lf.rot;
        ctx.save();
        ctx.translate(lf.x, lf.y);
        ctx.rotate(lf.rot * 0.3);
        ctx.scale(1, lf.flat);
        for (let j = 0; j < k; j++) {
          const a = rot0 + (j / k) * Math.PI * 2;
          ctx.save();
          ctx.rotate(a - Math.PI / 2);
          // 光は左上から。光の側を向いた小葉は明るい
          const facing = -(Math.cos(a) * LIGHT.x + Math.sin(a) * LIGHT.y * lf.flat);
          const lt = lf.tone - back * 0.18 + facing * 0.1;
          const g = ctx.createLinearGradient(0, 0, 0, leafLen);
          g.addColorStop(0, vary(L.colors[0], lt - 0.05));
          g.addColorStop(1, vary(L.colors[1], lt));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(-leafLen * 0.72, leafLen * 0.22, -leafLen * 0.78, leafLen * 1.06, -leafLen * 0.06, leafLen * 0.87);
          ctx.lineTo(0, leafLen * 0.8);
          ctx.lineTo(leafLen * 0.06, leafLen * 0.87);
          ctx.bezierCurveTo(leafLen * 0.78, leafLen * 1.06, leafLen * 0.72, leafLen * 0.22, 0, 0);
          ctx.fill();
          // ふち (少し濃く)
          ctx.strokeStyle = 'rgba(20,50,20,0.28)';
          ctx.lineWidth = 0.9;
          ctx.stroke();
          // 葉脈: 中央の1本と、そこから斜めに
          ctx.strokeStyle = 'rgba(20,55,20,0.28)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(0, 2);
          ctx.lineTo(0, leafLen * 0.78);
          for (let v = 1; v <= 3; v++) {
            const y = leafLen * (0.18 + v * 0.17);
            ctx.moveTo(0, y);
            ctx.lineTo(-leafLen * 0.38, y + leafLen * 0.14);
            ctx.moveTo(0, y);
            ctx.lineTo(leafLen * 0.38, y + leafLen * 0.14);
          }
          ctx.stroke();
          // 本物のシロツメクサにある、白っぽい V の模様
          ctx.strokeStyle = 'rgba(230,248,220,0.42)';
          ctx.lineWidth = leafLen * 0.07;
          ctx.beginPath();
          ctx.moveTo(-leafLen * 0.32, leafLen * 0.62);
          ctx.lineTo(0, leafLen * 0.42);
          ctx.lineTo(leafLen * 0.32, leafLen * 0.62);
          ctx.stroke();
          // 光沢
          if (facing > -0.2) {
            ctx.fillStyle = 'rgba(255,255,240,' + (0.1 + 0.12 * Math.max(0, facing)).toFixed(3) + ')';
            ctx.beginPath();
            ctx.ellipse(-leafLen * 0.22, leafLen * 0.55, leafLen * 0.14, leafLen * 0.07, -0.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
        ctx.restore();
        info.tops.push({ x: lf.x, y: lf.y - leafLen * 0.5 });
      });
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

  /** 根元: 茎の下の方を土の色で暗く沈め、土の粒を少し載せる (土から生えているように見せる)。 */
  function mound(ctx, rng) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const fade = ctx.createLinearGradient(0, BASE_Y - 22, 0, BASE_Y + 6);
    fade.addColorStop(0, 'rgba(30,20,10,0)');
    fade.addColorStop(1, 'rgba(30,20,10,0.8)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, BASE_Y - 22, W, 40);
    ctx.restore();
    // 根元を覆う小さな土の盛り上がり。上のふちを凸凹にして、茎の切り口が横一線に見えないようにする
    for (let i = 0; i < 9; i++) {
      // 真ん中ほど高い、ゆるい山の形に置く
      const u = (rng() - 0.5) * 2;
      const x = W / 2 + u * W * 0.2;
      const y = BASE_Y + 3 - (1 - u * u) * 4 + rng() * 3;
      const rx = 5 + rng() * 9;
      const ry = 2.5 + rng() * 3;
      const g = ctx.createRadialGradient(x - rx * 0.3, y - ry * 0.6, 0, x, y, rx);
      g.addColorStop(0, 'rgba(110,80,54,0.9)');
      g.addColorStop(0.7, 'rgba(70,48,30,0.75)');
      g.addColorStop(1, 'rgba(50,34,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, (rng() - 0.5) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 14; i++) {
      const u = (rng() - 0.5) * 2;
      const x = W / 2 + u * W * 0.24;
      const y = BASE_Y + 2 - (1 - u * u) * 3 + rng() * 5;
      const t = 70 + rng() * 60;
      ctx.fillStyle = 'rgba(' + Math.round(t * 1.4) + ',' + Math.round(t) + ',' + Math.round(t * 0.65) + ',0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 0.9 + rng() * 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- 植物1つを描く ----
  function drawPlant(species) {
    const look = lookOf(species);
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
    if (imageOf(species)) return imageOf(species);
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
    if (imageOf(species) && !(species.id in alpha)) {
      alpha[species.id] = null; // 読み込み中
      const img = new Image();
      img.onload = function () {
        const c = makeCanvas(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, 0, 0);
        keepAlpha(species.id, c);
      };
      img.src = imageOf(species);
    }
    if (!imageOf(species) && !alpha[species.id]) url(species);
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
  function glow(species) { return lookOf(species).glow || null; }

  /** 合成のとき飛ばす葉の色。 */
  function leafColor(species) {
    const L = lookOf(species).layers.find((l) => l.colors || l.color);
    if (!L) return '#78b84a';
    return L.colors ? L.colors[1] : L.color;
  }

  // ---- 土 ----

  /** なめらかな雑音 (値の格子をなめらかにつなぐ)。同じ seed なら同じ模様。 */
  function noise2(seed) {
    const rng = rngFor(seed);
    const G = 64;
    const v = new Float32Array(G * G);
    for (let i = 0; i < v.length; i++) v[i] = rng();
    const at = (x, y) => v[((y % G + G) % G) * G + ((x % G + G) % G)];
    const sm = (t) => t * t * (3 - 2 * t);
    return function (x, y) {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const tx = sm(x - xi);
      const ty = sm(y - yi);
      const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * tx;
      const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * tx;
      return a + (b - a) * ty;
    };
  }

  /**
   * ジオラマの土を描く。動かないので最初に1回だけ。
   *   高さの雑音から凹凸の陰影 (光は左上の奥から) と、湿った所・乾いた所の色むらを作る。
   *   その上に、大きさのばらついた小石と枯れ葉 (影は光と反対の右手前へ)、
   *   飾りの苔と小さな草を、合成用の草が生える場所 (各マスの根元) を避けて群れで置く。
   * opts.cols / opts.rows: マスの数、opts.baseY: マスの上から根元までの割合
   */
  function soil(canvas, seed, opts) {
    const o = opts || {};
    const cols = o.cols || 4;
    const rows = o.rows || 4;
    const baseY = o.baseY || 0.78;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const rng = rngFor(seed || 7);

    // 1. 凹凸と色むら: 小さい絵に1画素ずつ作り、なめらかに引き伸ばす (細かい雑音にしない)
    const sw = Math.round(w / 4);
    const sh = Math.round(h / 4);
    const hN = [noise2(11), noise2(23), noise2(37)];
    const wet = noise2(51);
    const tint = noise2(73);
    const height = (x, y) => hN[0](x / 46, y / 46) * 0.6 + hN[1](x / 18, y / 18) * 0.28 + hN[2](x / 7, y / 7) * 0.12;
    const small = makeCanvas(sw, sh);
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(sw, sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const hz = height(x, y);
        const dx = height(x + 1, y) - hz;
        const dy = height(x, y + 1) - hz;
        // 光の側へ上がっている面は明るく、反対は暗く
        const shade = 1 - (dx * LIGHT.x + dy * LIGHT.y) * 4.2 + (hz - 0.5) * 0.18;
        const m = Math.min(1, Math.max(0, (wet(x / 30, y / 30) - 0.3) * 1.6)); // 湿り気
        const t = tint(x / 22, y / 22) - 0.5;
        // 乾いた土 (明るい茶) と湿った土 (黒褐色) を混ぜる
        let r = 104 + (58 - 104) * m + t * 18;
        let g = 76 + (40 - 76) * m + t * 10;
        let b = 52 + (26 - 52) * m;
        // ふち近くは少し暗く (台の切り口へ向かって落ちる)
        const edge = Math.min(x, y, sw - 1 - x, sh - 1 - y) / 10;
        const ao = edge < 1 ? 0.78 + 0.22 * edge : 1;
        const k = Math.max(0.72, Math.min(1.22, shade)) * ao;
        const p = (y * sw + x) * 4;
        img.data[p] = r * k;
        img.data[p + 1] = g * k;
        img.data[p + 2] = b * k;
        img.data[p + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, w, h);

    // 合成用の草の根元 (各マス) の近くには、飾りを置かない
    const cw = w / cols;
    const ch = h / rows;
    function nearBase(x, y, k) {
      const c = Math.floor(x / cw);
      const r = Math.floor(y / ch);
      for (let rr = r - 1; rr <= r + 1; rr++) {
        for (let cc = c - 1; cc <= c + 1; cc++) {
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const bx = (cc + 0.5) * cw;
          const by = (rr + baseY) * ch;
          const ex = (x - bx) / (cw * 0.42 * k);
          const ey = (y - by) / (ch * 0.26 * k);
          if (ex * ex + ey * ey < 1) return true;
        }
      }
      return false;
    }
    function spot(k, tries) {
      for (let t = 0; t < (tries || 30); t++) {
        const x = rng() * w;
        const y = rng() * h;
        if (!nearBase(x, y, k)) return { x: x, y: y };
      }
      return null;
    }

    // 2. 土の粒: 数を抑え、色の差も小さく (ノイズに見せない)
    const grains = Math.round(w * h / 700);
    for (let i = 0; i < grains; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 0.6 + Math.pow(rng(), 3) * 2.2;
      ctx.fillStyle = 'rgba(15,8,3,0.28)';
      ctx.beginPath();
      ctx.arc(x + r * 0.5, y + r * 0.6, r, 0, Math.PI * 2);
      ctx.fill();
      const tone = 0.85 + rng() * 0.5;
      ctx.fillStyle = 'rgba(' + Math.round(128 * tone) + ',' + Math.round(96 * tone) + ',' + Math.round(66 * tone) + ',0.7)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 苔: 群れで。中心が濃く、ふちはまばら
    const mossN = 7;
    for (let i = 0; i < mossN; i++) {
      const p = spot(1.1);
      if (!p) continue;
      const R = (0.02 + rng() * 0.035) * w;
      for (let k = 0; k < 220; k++) {
        const a = rng() * Math.PI * 2;
        const d = Math.pow(rng(), 0.7) * R;
        const x = p.x + Math.cos(a) * d * 1.3;
        const y = p.y + Math.sin(a) * d * 0.8;
        const lit = rng();
        if (nearBase(x, y, 1.12)) continue; // 群れの真ん中だけでなく、粒ごとに根元を避ける
        ctx.fillStyle = 'rgba(' + Math.round(62 + lit * 50) + ',' + Math.round(96 + lit * 50) + ',' + Math.round(34 + lit * 16) + ',' + (0.85 - d / R * 0.5).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + rng() * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. 飾りの小さな草: 同じ種類が少しずつまとまって生える (地面に低く、色も控えめ)
    //    合成用の草 (起きて立ち、影を落とす) と見分けがつくよう、小さく・くすんだ色・平たくする
    const tuftKinds = [
      { c0: '#4a5a2a', c1: '#8a9a52', n: 7, l: 12 },  // 細い若草
      { c0: '#5a5a30', c1: '#a59a5a', n: 5, l: 10 },  // 枯れかけた草
      { c0: '#3e5a2e', c1: '#6f8f4a', n: 4, l: 7, round: true }, // 小さな丸葉
      { c0: '#4a5a2a', c1: '#8a9a52', n: 6, l: 11, flower: '#f4f1e4' }, // 白い小花の混じる草
      { c0: '#4a5a2a', c1: '#8a9a52', n: 6, l: 11, flower: '#e9c94a' }  // 黄色い小花の混じる草
    ];
    const groups = 14;
    for (let gI = 0; gI < groups; gI++) {
      const kind = tuftKinds[Math.floor(rng() * tuftKinds.length)];
      const center = spot(1.15);
      if (!center) continue;
      const members = 3 + Math.floor(rng() * 5);
      for (let m = 0; m < members; m++) {
        const x = center.x + (rng() - 0.5) * 60;
        const y = center.y + (rng() - 0.5) * 36;
        if (nearBase(x, y, 1.3)) continue; // 葉は点から伸びるので、そのぶん広めに避ける
        drawTuft(ctx, x, y, kind, rng);
      }
    }

    // 5. 小石: 大きさは小さい物が多く、大きい物は少ない。いくつかは寄り集まる
    const stones = 26;
    for (let i = 0; i < stones; i++) {
      const p = spot(0.8);
      if (!p) continue;
      const cluster = rng() < 0.35 ? 2 + Math.floor(rng() * 3) : 1;
      for (let c = 0; c < cluster; c++) {
        const r = (0.004 + Math.pow(rng(), 2.2) * 0.022) * w;
        drawStone(ctx, p.x + (c ? (rng() - 0.5) * 30 : 0), p.y + (c ? (rng() - 0.5) * 18 : 0), r, rng);
      }
    }

    // 6. 枯れ葉: 大きさと向きを変え、少し反ったものも
    for (let i = 0; i < 14; i++) {
      const p = spot(0.8);
      if (!p) continue;
      drawDeadLeaf(ctx, p.x, p.y, (0.012 + Math.pow(rng(), 1.5) * 0.026) * w, rng);
    }
  }

  function drawTuft(ctx, x, y, kind, rng) {
    if (kind.flower && rng() < 0.6) {
      drawTuftBlades(ctx, x, y, kind, rng);
      // 小さな花 (地面すれすれに、数輪)
      for (let f = 0; f < 1 + Math.floor(rng() * 3); f++) {
        const fx = x + (rng() - 0.5) * kind.l * 1.2;
        const fy = y - rng() * kind.l * 0.5;
        ctx.fillStyle = 'rgba(15,8,3,0.25)';
        ctx.beginPath();
        ctx.arc(fx + 1.5, fy + 1.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = kind.flower;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(a) * 1.8, fy + Math.sin(a) * 1.3, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#d9a52b';
        ctx.beginPath();
        ctx.arc(fx, fy, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    drawTuftBlades(ctx, x, y, kind, rng);
  }

  function drawTuftBlades(ctx, x, y, kind, rng) {
    // 影 (光と反対の右手前へ)
    ctx.fillStyle = 'rgba(15,8,3,0.22)';
    ctx.beginPath();
    ctx.ellipse(x + 4, y + 2, kind.l * 0.8, kind.l * 0.3, 0.3, 0, Math.PI * 2);
    ctx.fill();
    if (kind.round) {
      for (let k = 0; k < kind.n; k++) {
        const a = rng() * Math.PI * 2;
        const d = rng() * kind.l * 0.6;
        ctx.fillStyle = vary(rng() < 0.5 ? kind.c0 : kind.c1, (rng() - 0.5) * 0.2);
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, 3 + rng() * 2.5, 2 + rng() * 1.5, a, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    for (let k = 0; k < kind.n; k++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 1.8;
      const l = kind.l * (0.6 + rng() * 0.6);
      ctx.strokeStyle = vary(mix(kind.c0, kind.c1, rng()), (rng() - 0.5) * 0.2);
      ctx.lineWidth = 1.4 + rng() * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5 * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l * 0.55);
      ctx.stroke();
    }
  }

  function drawStone(ctx, x, y, r, rng) {
    const tilt = (rng() - 0.5) * 1.2;
    const sx = 1 + rng() * 0.5;
    const g0 = 115 + rng() * 70;
    const warm = rng() * 12;
    // 接地の影は右手前へ (光は左上の奥)
    ctx.fillStyle = 'rgba(12,6,2,0.42)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.45, y + r * 0.4, r * sx * 1.1, r * 0.8, tilt, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.45, y - r * 0.45, r * 0.1, x, y, r * 1.2);
    g.addColorStop(0, 'rgb(' + Math.round(g0 + 55 + warm) + ',' + Math.round(g0 + 50) + ',' + Math.round(g0 + 42) + ')');
    g.addColorStop(1, 'rgb(' + Math.round(g0 * 0.55 + warm) + ',' + Math.round(g0 * 0.52) + ',' + Math.round(g0 * 0.48) + ')');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r * sx, r * 0.78, tilt, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDeadLeaf(ctx, x, y, l, rng) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * Math.PI * 2);
    const curl = rng() < 0.4;
    ctx.fillStyle = 'rgba(15,8,3,0.32)';
    ctx.beginPath();
    ctx.ellipse(2.5, 2.5, l, l * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    const base = ['#8a5a2a', '#a0703a', '#6e4a26', '#b08440', '#7a6230'][Math.floor(rng() * 5)];
    const g = ctx.createLinearGradient(0, -l * 0.4, 0, l * 0.4);
    g.addColorStop(0, vary(base, 0.15));
    g.addColorStop(1, vary(base, curl ? -0.35 : -0.1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-l, 0);
    ctx.quadraticCurveTo(-l * 0.2, -l * 0.5, l, 0);
    ctx.quadraticCurveTo(-l * 0.2, l * (curl ? 0.2 : 0.5), -l, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,35,15,0.55)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-l, 0);
    ctx.lineTo(l * 0.9, 0);
    for (let v = 1; v <= 3; v++) {
      const vx = -l + (v / 4) * l * 1.8;
      ctx.moveTo(vx, 0);
      ctx.lineTo(vx + l * 0.25, -l * 0.22);
    }
    ctx.stroke();
    ctx.restore();
  }


  // ---- 机の麻布と朝の光 (背景) ----
  /** 麻布の織り目、左上から差す朝の光、四隅へ落ちる暗がり。動かないので1回だけ (大きさが変わったら描き直す)。 */
  function linen(canvas, cssW, cssH, scale) {
    const k = scale || 1;
    canvas.width = Math.round(cssW * k);
    canvas.height = Math.round(cssH * k);
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const rng = rngFor(91);
    ctx.fillStyle = '#ebe3cf';
    ctx.fillRect(0, 0, w, h);
    // 大きなむら (布のたるみ)
    const n = noise2(5);
    const small = makeCanvas(Math.ceil(w / 8), Math.ceil(h / 8));
    const sc = small.getContext('2d');
    const im = sc.createImageData(small.width, small.height);
    for (let y = 0; y < small.height; y++) {
      for (let x = 0; x < small.width; x++) {
        const v = n(x / 9, y / 9) - 0.5;
        const p = (y * small.width + x) * 4;
        im.data[p] = 236 + v * 14;
        im.data[p + 1] = 227 + v * 14;
        im.data[p + 2] = 206 + v * 12;
        im.data[p + 3] = 255;
      }
    }
    sc.putImageData(im, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, w, h);
    // 織り目: 細い縦糸と横糸 (濃さを少しずつ変える)
    for (let y = 0; y < h; y += 2 * k) {
      ctx.fillStyle = 'rgba(110,90,55,' + (0.025 + rng() * 0.035).toFixed(3) + ')';
      ctx.fillRect(0, y, w, k * 0.8);
    }
    for (let x = 0; x < w; x += 2 * k) {
      ctx.fillStyle = 'rgba(255,255,245,' + (0.02 + rng() * 0.04).toFixed(3) + ')';
      ctx.fillRect(x, 0, k * 0.8, h);
    }
    // 糸のふし
    for (let i = 0; i < w * h / (900 * k * k); i++) {
      ctx.fillStyle = 'rgba(120,95,55,' + (0.05 + rng() * 0.08).toFixed(3) + ')';
      ctx.fillRect(rng() * w, rng() * h, (2 + rng() * 6) * k, k);
    }
    // 朝の光 (左上) と、四隅の暗がり
    const light = ctx.createRadialGradient(w * 0.15, h * 0.05, 0, w * 0.15, h * 0.05, Math.max(w, h) * 0.9);
    light.addColorStop(0, 'rgba(255,248,226,0.65)');
    light.addColorStop(0.5, 'rgba(255,248,226,0.12)');
    light.addColorStop(1, 'rgba(255,248,226,0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, w, h);
    const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.35, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    vig.addColorStop(0, 'rgba(60,45,20,0)');
    vig.addColorStop(1, 'rgba(60,45,20,0.22)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  // ---- 台の切り口 ----
  /** 台の手前の切り口: 表土・粘土・砂利の層、細い根、埋まった小石。光は左から。 */
  function strata(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const rng = rngFor(29);
    const n = noise2(17);
    // 層の境目は波打たせる
    const bands = [
      { top: 0, color: [58, 40, 26] },     // 表土 (黒っぽい)
      { top: 0.26, color: [86, 62, 40] },  // 粘土まじり
      { top: 0.58, color: [110, 86, 58] }, // 砂
      { top: 0.8, color: [70, 52, 36] }    // 下の層
    ];
    for (let x = 0; x < w; x += 2) {
      for (let b = 0; b < bands.length; b++) {
        const t0 = b === 0 ? 0 : bands[b].top * h + (n(x / 40, b * 3) - 0.5) * h * 0.14;
        const t1 = b === bands.length - 1 ? h : bands[b + 1].top * h + (n(x / 40, (b + 1) * 3) - 0.5) * h * 0.14;
        const v = (n(x / 9, b * 7 + 1) - 0.5) * 18;
        const lit = 1.12 - (x / w) * 0.3; // 左ほど明るい
        const c = bands[b].color;
        ctx.fillStyle = 'rgb(' + Math.round((c[0] + v) * lit) + ',' + Math.round((c[1] + v * 0.8) * lit) + ',' + Math.round((c[2] + v * 0.6) * lit) + ')';
        ctx.fillRect(x, t0, 2, t1 - t0);
      }
    }
    // 細い根: 上から垂れて、くねる
    for (let i = 0; i < 26; i++) {
      let x = rng() * w;
      let y = 0;
      const len = h * (0.25 + rng() * 0.6);
      ctx.strokeStyle = 'rgba(214,190,150,' + (0.25 + rng() * 0.35).toFixed(2) + ')';
      ctx.lineWidth = 0.8 + rng() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      while (y < len) {
        x += (rng() - 0.5) * 8;
        y += 4 + rng() * 6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // 埋まった小石
    for (let i = 0; i < 40; i++) {
      const x = rng() * w;
      const y = h * (0.3 + rng() * 0.65);
      const r = 2 + Math.pow(rng(), 2) * 9;
      const g0 = 110 + rng() * 60;
      const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 0, x, y, r);
      g.addColorStop(0, 'rgb(' + Math.round(g0 + 40) + ',' + Math.round(g0 + 34) + ',' + Math.round(g0 + 26) + ')');
      g.addColorStop(1, 'rgb(' + Math.round(g0 * 0.55) + ',' + Math.round(g0 * 0.5) + ',' + Math.round(g0 * 0.45) + ')');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.2, r * 0.85, rng(), 0, Math.PI * 2);
      ctx.fill();
    }
    // 上のふち: 表土の上面が光を受ける細い明るい線と、下へ向かう影
    const top = ctx.createLinearGradient(0, 0, 0, h * 0.22);
    top.addColorStop(0, 'rgba(255,230,190,0.28)');
    top.addColorStop(1, 'rgba(255,230,190,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * 0.22);
    const bottom = ctx.createLinearGradient(0, h * 0.5, 0, h);
    bottom.addColorStop(0, 'rgba(0,0,0,0)');
    bottom.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
  }

  root.KusaArt = { url: url, opaqueAt: opaqueAt, heightOf: heightOf, sizeOf: sizeOf, imageOf: imageOf, lookOf: lookOf, glow: glow, leafColor: leafColor, soil: soil, linen: linen, strata: strata, drawPlant: drawPlant, W: W, H: H };
})(typeof globalThis !== 'undefined' ? globalThis : this);
