'use strict';

// 颜色科学工具：sRGB 十六进制 <-> 相对亮度（WCAG 2.x）、CIE Lab（D65）色差，
// 以及色觉缺陷（CVD）模拟。全部计算在本机内存完成，无任何外部调用。

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * 将十六进制颜色规范化为 #rrggbb 小写形式；非法输入抛出带路径信息的错误。
 */
function normalizeHex(input, path) {
  if (typeof input !== 'string') {
    throw new Error(`${path} 必须是十六进制颜色字符串`);
  }
  let value = input.trim();
  if (!HEX_RE.test(value)) {
    throw new Error(`${path} 颜色 "${input}" 无效，仅支持 #rgb 或 #rrggbb`);
  }
  if (value.length === 4) {
    value = '#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3];
  }
  return value.toLowerCase();
}

function hexToRgb(hex) {
  const h = hex.slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// sRGB 分量（0-255）-> 线性光
function srgbChannelToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 相对亮度 L = 0.2126R + 0.7152G + 0.0722B（线性分量）。
 */
function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/**
 * WCAG 对比度：(L1 + 0.05) / (L2 + 0.05)，结果 >= 1。
 */
function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------- 色觉缺陷（CVD）模拟 ----------
//
// 可选视型；normal 为恒等（不做模拟）。
const PROFILE_NAMES = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

// 固定模拟矩阵（README 同步公布）：取自 Machado, Oliveira & Fernandes (2009)
// 100% 严重度模型，作用于线性化 sRGB 分量。
const CVD_MATRICES = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.303900],
  ],
};

// 线性分量（0-1）-> sRGB 分量（0-255）
function linearToSrgbChannel(v) {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
}

/**
 * 模拟指定视型下看到的颜色，管线依次为：
 *   sRGB 线性化 -> 固定矩阵变换 -> 裁剪到 [0,1] -> 重新编码为 #rrggbb。
 * normal 视型原样返回输入。
 */
function simulateHex(hex, profile) {
  const m = CVD_MATRICES[profile];
  if (!m) return hex;
  const { r, g, b } = hexToRgb(hex);
  const lin = [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
  const out = m.map((row) =>
    Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]))
  );
  return '#' + out.map((v) => linearToSrgbChannel(v).toString(16).padStart(2, '0')).join('');
}

/**
 * 指定视型下的 WCAG 对比度：先对两端颜色做模拟，再按常规定义计算。
 */
function contrastRatioProfile(hexA, hexB, profile) {
  return contrastRatio(simulateHex(hexA, profile), simulateHex(hexB, profile));
}

// D65 参考白点
const REF_X = 0.95047;
const REF_Y = 1.0;
const REF_Z = 1.08883;

// sRGB -> XYZ（D65，sRGB 标准矩阵）
function hexToXyz(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);
  return {
    x: (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / REF_X,
    y: (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / REF_Y,
    z: (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / REF_Z,
  };
}

function labF(t) {
  const EPSILON = 216 / 24389; // (6/29)^3
  const KAPPA = 24389 / 27; // (29/3)^3
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

/**
 * sRGB 十六进制 -> CIE Lab（D65）。
 */
function hexToLab(hex) {
  const { x, y, z } = hexToXyz(hex);
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * CIE76 总色差 ΔE*ab = sqrt((ΔL)^2 + (Δa)^2 + (Δb)^2)。
 */
function deltaE(hexA, hexB) {
  const p = hexToLab(hexA);
  const q = hexToLab(hexB);
  const dL = p.L - q.L;
  const da = p.a - q.a;
  const db = p.b - q.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

module.exports = {
  normalizeHex,
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  hexToLab,
  deltaE,
  PROFILE_NAMES,
  CVD_MATRICES,
  simulateHex,
  contrastRatioProfile,
};
