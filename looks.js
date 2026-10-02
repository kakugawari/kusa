/*!
 * looks.js — 草の見た目のデータ。ゲームのデータ (core.js) とは別に持つ。
 *
 *   core.js   草の名前・レア度・系統・レシピ (遊びのルール)
 *   looks.js  草の見た目 (描くための層・光る色)・届いた画像の置き場所
 *   plants.js ここを読んで描く (描き方の処理)
 *
 * 草を足すときは core.js に1行、ここに1行。描き方 (plants.js) は書き直さない。
 * ブラウザでは window.KusaLooks、node からは require() で読める。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.KusaLooks = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 草の見た目は「層」の並びで決める (新しい種類の層が要るときだけ plants.js に描き方を足す)。
  // 画像が届いた草は IMAGES に「id: パス」を足す。画像があればそちらを使い、無ければ層から描く。
  //
  // 層の種類 (位置・大きさは植物の箱に対する割合 0〜1):
  //   blades  細い葉の束        n 本数 / h 高さ / spread 広がり / w 太さ / colors [根元, 先] / rib 葉脈の色
  //   heads   穂先の粒          n / color
  //   clover  クローバー        n 葉の数 / leaflets 小葉の数 / size / colors
  //   sprout  双葉の芽          color
  //   rosette 地面に広がる葉    n / size / colors / toothed ぎざぎざ
  //   flower  タンポポの花      n / h / size / color
  //   puff    綿毛の玉          n / h / size
  //   plume   ススキの穂        n / h / size / color
  //   drops   しずく            n
  //   sparkle 光の粒            n / color / glow 光らせるか
  //   tint    上から色をかける  colors / alpha (虹・星空など)
  //   crystal 透き通らせる      alpha
  // look の glow は、草が光る色。根元の土にも同じ色の照り返しを落とす (光を貼り付けたように見せないため)。
  const LAYER_TYPES = ['blades', 'heads', 'clover', 'sprout', 'rosette', 'flower', 'puff', 'plume', 'drops', 'sparkle', 'tint', 'crystal'];

  const G_YOUNG = ['#4f7a2a', '#a6cf5a'];
  const G_LAWN = ['#355f22', '#8fbf4c'];
  const G_DEEP = ['#264c1a', '#6fa63e'];
  const G_CLOVER = ['#2f6b2c', '#6fae4c'];
  const G_SUSUKI = ['#4d6a34', '#a9b97a'];

  const LOOKS = {
    chibi_shiba: { layers: [{ t: 'blades', n: 12, h: 0.32, spread: 0.3, w: 2.2, colors: G_YOUNG }] },
    fusafusa_shiba: { layers: [{ t: 'blades', n: 34, h: 0.5, spread: 0.55, w: 2.4, colors: G_LAWN }] },
    konmori_shiba: { layers: [{ t: 'blades', n: 80, h: 0.66, spread: 0.85, w: 2.6, colors: G_DEEP, dome: true }] },
    ougon_shiba: { glow: 'rgba(255,210,90,0.55)', layers: [
      { t: 'blades', n: 70, h: 0.68, spread: 0.8, w: 2.6, colors: ['#4a5a1c', '#c9b44a'], dome: true },
      { t: 'heads', n: 11, color: '#e8b830' }, { t: 'sparkle', n: 6, color: '#ffe9a0' }] },

    mitsuba: { layers: [{ t: 'clover', n: 4, leaflets: 3, size: 0.5, colors: G_CLOVER }] },
    yotsuba: { layers: [{ t: 'clover', n: 5, leaflets: 4, size: 0.56, colors: G_CLOVER }] },
    itsuba: { layers: [{ t: 'clover', n: 6, leaflets: 5, size: 0.6, colors: ['#2b6a3a', '#7cc06a'] }] },
    kouun_clover: { glow: 'rgba(190,255,150,0.5)', layers: [
      { t: 'clover', n: 7, leaflets: 4, size: 0.68, colors: ['#2f7a3a', '#9de07a'] }, { t: 'sparkle', n: 8, color: '#fff6c0', glow: true }] },

    tanpopo_me: { layers: [{ t: 'sprout', color: '#7fb04a' }] },
    tanpopo: { layers: [{ t: 'rosette', n: 10, size: 0.62, colors: ['#3a6a26', '#7fae46'], toothed: true },
      { t: 'flower', n: 1, h: 0.5, size: 0.25, color: '#f2c218' }] },
    watage: { layers: [{ t: 'rosette', n: 10, size: 0.62, colors: ['#3a6a26', '#7fae46'], toothed: true },
      { t: 'flower', n: 1, h: 0.42, size: 0.22, color: '#f2c218' }, { t: 'puff', n: 2, h: 0.72, size: 0.22 }] },
    kyodai_tanpopo: { layers: [{ t: 'rosette', n: 13, size: 0.78, colors: ['#335f22', '#86b44c'], toothed: true },
      { t: 'flower', n: 3, h: 0.62, size: 0.27, color: '#f5c010' }, { t: 'puff', n: 2, h: 0.85, size: 0.26 }] },

    susuki_me: { layers: [{ t: 'sprout', color: '#8aa75a' }, { t: 'blades', n: 3, h: 0.3, spread: 0.15, w: 2, colors: G_SUSUKI }] },
    susuki: { layers: [{ t: 'blades', n: 12, h: 0.78, spread: 0.45, w: 3, colors: G_SUSUKI, rib: 'rgba(255,255,240,0.6)' },
      { t: 'plume', n: 2, h: 0.92, size: 0.22, color: '#d9d2bd' }] },
    ooki_susuki: { layers: [{ t: 'blades', n: 20, h: 0.85, spread: 0.6, w: 3.2, colors: G_SUSUKI, rib: 'rgba(255,255,240,0.6)' },
      { t: 'plume', n: 4, h: 0.97, size: 0.26, color: '#e6dfcc' }] },
    ougon_susuki: { glow: 'rgba(255,200,80,0.45)', layers: [
      { t: 'blades', n: 20, h: 0.85, spread: 0.6, w: 3.2, colors: ['#6a5a24', '#d7b85a'], rib: 'rgba(255,240,200,0.7)' },
      { t: 'plume', n: 5, h: 0.97, size: 0.27, color: '#f0c45a' }, { t: 'sparkle', n: 6, color: '#ffe4a0' }] },

    hikaru_kusa: { glow: 'rgba(150,255,170,0.6)', layers: [
      { t: 'blades', n: 26, h: 0.58, spread: 0.6, w: 2.8, colors: ['#1f5a3a', '#6fd99a'], rib: 'rgba(210,255,220,0.95)' }] },
    hoshi_kusa: { glow: 'rgba(170,200,255,0.6)', layers: [
      { t: 'blades', n: 28, h: 0.62, spread: 0.65, w: 2.6, colors: ['#1f3a5a', '#7fa8e0'], rib: 'rgba(230,240,255,0.9)' },
      { t: 'sparkle', n: 14, color: '#ffffff', glow: true }] },
    gekkou_kusa: { glow: 'rgba(120,210,255,0.8)', layers: [
      { t: 'blades', n: 32, h: 0.7, spread: 0.7, w: 2.8, colors: ['#1d4a7a', '#c8f0ff'], rib: 'rgba(255,255,255,0.95)' },
      { t: 'sparkle', n: 8, color: '#e8fbff', glow: true }] },
    niji_kusa: { glow: 'rgba(230,180,255,0.7)', layers: [
      { t: 'blades', n: 30, h: 0.72, spread: 0.7, w: 3, colors: ['#5a6aa0', '#f0f4ff'], rib: 'rgba(255,255,255,0.95)' },
      { t: 'crystal', alpha: 0.8 },
      { t: 'tint', colors: ['#ff6a8a', '#ffd25a', '#7aff9a', '#5ad2ff', '#b07aff'], alpha: 0.45 },
      { t: 'sparkle', n: 10, color: '#ffffff', glow: true }] },

    zassou: { layers: [{ t: 'rosette', n: 9, size: 0.62, colors: ['#3f6a2a', '#8ab456'] },
      { t: 'blades', n: 14, h: 0.55, spread: 0.7, w: 2.8, colors: ['#4a6a2a', '#9ab85a'] }] },
    mizube_kusa: { layers: [{ t: 'blades', n: 16, h: 0.75, spread: 0.4, w: 2.6, colors: ['#22503f', '#6fb39a'], rib: 'rgba(220,255,240,0.5)' },
      { t: 'drops', n: 9 }] },
    clover_shiba: { layers: [{ t: 'blades', n: 30, h: 0.5, spread: 0.7, w: 2.4, colors: G_LAWN },
      { t: 'clover', n: 4, leaflets: 3, size: 0.42, colors: G_CLOVER }] },
    watage_daigunsei: { layers: [{ t: 'rosette', n: 9, size: 0.55, colors: ['#3a6a26', '#7fae46'], toothed: true },
      { t: 'puff', n: 6, h: 0.75, size: 0.2 }] },
    ougon_sougen: { glow: 'rgba(255,205,90,0.55)', layers: [
      { t: 'blades', n: 60, h: 0.7, spread: 0.9, w: 2.6, colors: ['#6a5418', '#e0c25a'], dome: true },
      { t: 'plume', n: 4, h: 0.92, size: 0.22, color: '#f2c45a' }, { t: 'heads', n: 8, color: '#f0c040' },
      { t: 'sparkle', n: 8, color: '#fff0b0' }] },
    kouun_hikarigusa: { glow: 'rgba(170,255,140,0.75)', layers: [
      { t: 'clover', n: 6, leaflets: 4, size: 0.62, colors: ['#2f8a4a', '#c8ffa0'] },
      { t: 'sparkle', n: 12, color: '#fffbd0', glow: true }] },
    hotaru_kusa: { glow: 'rgba(200,255,120,0.5)', layers: [
      { t: 'blades', n: 22, h: 0.72, spread: 0.55, w: 2.6, colors: ['#1d3a26', '#4f8a5a'] },
      { t: 'sparkle', n: 9, color: '#e4ff80', glow: true }] },
    uchuu_kusa: { glow: 'rgba(170,130,255,0.75)', layers: [
      { t: 'blades', n: 30, h: 0.78, spread: 0.7, w: 3, colors: ['#120f3a', '#4a3a9a'], rib: 'rgba(200,190,255,0.8)' },
      { t: 'tint', colors: ['#2a1a6a', '#5a2a9a', '#1a4a8a'], alpha: 0.35 },
      { t: 'sparkle', n: 18, color: '#ffffff', glow: true }] }
  };

  /** 届いた草の絵 (背景を抜いた PNG)。例: chibi_shiba: './img/chibi_shiba.png' */
  const IMAGES = {};

  return { LAYER_TYPES: LAYER_TYPES, LOOKS: LOOKS, IMAGES: IMAGES };
});
