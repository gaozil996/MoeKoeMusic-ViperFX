/*
 * 蝰蛇音效 v2 —— 模块化专业音效引擎
 * world:MAIN 主世界脚本。架构见 README。所有 DSP 节点在 claim 时一次性建好，
 * 各模块 apply 函数只改节点参数，保证切预设/拖滑块零重建、无爆音。
 */
'use strict';
if (window.__vfx_installed) { /* 允许重载时重新执行 UI 部分，但 hook 只装一次 */ }
window.__vfx_installed = true;

var STORE_KEY = 'viper_fx_state_v2';
var STORE_PRESETS = 'viper_fx_user_presets_v2';
var LOG = '[蝰蛇音效]';

// 10 段参数 EQ 默认中心频率（标准倍频程，可手动改 freq）
var EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function defaultState() {
  return {
    preset: 'off',
    intensity: 100,
    open: false,
    ab: null, // A/B 对照的快照
    modules: {
      input: { autoLoud: false, gain: 0 },          // gain 单位 dB
      bass:  { on: false, freq: 90, amount: 0.6 },   // 低音增强：谐波合成
      eq:    { bands: EQ_FREQS.map(function (f, i) { return { type: i < 2 ? 'lowshelf' : (i > 7 ? 'highshelf' : 'peaking'), freq: f, gain: 0, q: 1.0 }; }) },
      excite:{ type: 'off', drive: 0.3, air: 0 },     // 激励/饱和
      comp:  { th: -18, knee: 24, ratio: 3, at: 0.01, rel: 0.25, makeup: 0, limiter: true, ceiling: -1 },
      reverb:{ ir: 'none', wet: 0.15, predelay: 20, size: 2.0 }, // ir: none/room/hall/stage/plate/custom
      stereo:{ width: 0, mid: 0, side: 0, sideLowcut: 0 },        // mid/side dB, sideLowcut Hz(0=关)
      output:{ gain: 0 }                            // 输出增益 dB
    },
    smart: false
  };
}

var state = defaultState();
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function loadState() {
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    var o = JSON.parse(raw);
    if (o && o.modules) {
      // 合并，容忍旧字段缺失
      state.preset = (typeof o.preset === 'string') ? o.preset : 'off';
      state.intensity = (typeof o.intensity === 'number') ? o.intensity : 100;
      state.open = !!o.open;
      state.smart = !!o.smart;
      if (o.modules) {
        for (var k in o.modules) if (o.modules.hasOwnProperty(k) && state.modules[k]) {
          for (var j in o.modules[k]) if (o.modules[k].hasOwnProperty(j)) state.modules[k][j] = o.modules[k][j];
        }
        if (o.modules.eq && o.modules.eq.bands && o.modules.eq.bands.length === state.modules.eq.bands.length) {
          state.modules.eq.bands = o.modules.eq.bands;
        }
      }
    }
  } catch (e) {}
}
function saveState() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
function loadUserPresets() {
  try { var r = localStorage.getItem(STORE_PRESETS); if (r) return JSON.parse(r); } catch (e) {}
  return {};
}
function saveUserPresets(o) { try { localStorage.setItem(STORE_PRESETS, JSON.stringify(o)); } catch (e) {} }

// 内置混响空间（卷积 IR 类型）
var IR_DEFS = {
  none:  { label: '关闭', decay: 0.0, pre: 0, len: 0.05 },
  room:  { label: '小房间', decay: 1.8, pre: 0.006, len: 0.45 },
  hall:  { label: '大厅', decay: 2.6, pre: 0.012, len: 2.4 },
  stage: { label: '舞台', decay: 2.4, pre: 0.010, len: 2.0 },
  plate: { label: '钢板', decay: 3.0, pre: 0.004, len: 1.6 },
  church:{ label: '教堂', decay: 3.2, pre: 0.020, len: 3.2 },
  spring:{ label: '弹簧', decay: 2.0, pre: 0.003, len: 0.9 }
};

// ---------------- 预设库（流派 / 耳机 / 场景 / 官方旗舰 / 手动向） ----------------
// 每个预设是 modules 的覆盖。未列出的模块用 defaultState 的值。
function P(o) { return o; }
var PRESETS = [
  // —— 官方旗舰（对齐酷狗蝰蛇）——
  P({ id: 'v3d', name: '3D丽音', group: '官方旗舰', modules: { stereo: { width: 0.35 }, reverb: { ir: 'stage', wet: 0.28 }, eq: eqZero([2, -1, 1, 1, 2, 2]) } }),
  P({ id: 'vsuper', name: '超重低音', group: '官方旗舰', modules: { bass: { on: true, freq: 70, amount: 0.7 }, eq: eqZero([7, -3, -1, 1.5, 1.5, 9]) } }),
  P({ id: 'vpure', name: '纯净人声', group: '官方旗舰', modules: { excite: { type: 'tube', drive: 0.18, air: 3 }, eq: eqZero([-5, -3, 2, 5.5, 3, 0]), stereo: { mid: 2 } } }),
  P({ id: 'vhifi', name: 'HiFi现场', group: '官方旗舰', modules: { reverb: { ir: 'hall', wet: 0.32 }, stereo: { width: 0.25 }, eq: eqZero([3, 1, 3, 1, 1, 2]) } }),

  // —— 流派 ——
  P({ id: 'g_pop', name: '流行', group: '流派', modules: { eq: eqZero([4, -1.5, 0.5, 3, 1.5, 4]), comp: { th: -20, ratio: 3 } } }),
  P({ id: 'g_rock', name: '摇滚', group: '流派', modules: { bass: { on: true, freq: 75, amount: 0.5 }, eq: eqZero([5, -2, 2, 4, 2, 4]), comp: { th: -16, ratio: 4 } } }),
  P({ id: 'g_elec', name: '电子', group: '流派', modules: { bass: { on: true, freq: 60, amount: 0.45 }, eq: eqZero([6, -4, -2, 3, 5, 5]), reverb: { ir: 'plate', wet: 0.1 } } }),
  P({ id: 'g_jazz', name: '爵士', group: '流派', modules: { eq: eqZero([2, 1, 0, 1, 2, -1]), excite: { type: 'tape', drive: 0.15 } } }),
  P({ id: 'g_class', name: '古典', group: '流派', modules: { eq: eqZero([-2, -1, 0, 1, 3.5, 0]), comp: { th: -28, ratio: 2 }, reverb: { ir: 'hall', wet: 0.2 } } }),
  P({ id: 'g_hiphop', name: '嘻哈', group: '流派', modules: { bass: { on: true, freq: 60, amount: 0.8 }, eq: eqZero([6, -2, -1, 2, 3, 0]), comp: { th: -14, ratio: 5 } } }),
  P({ id: 'g_metal', name: '金属', group: '流派', modules: { eq: eqZero([5, -3, -1, 4, -1, 4]), comp: { th: -15, ratio: 4 }, excite: { type: 'tube', drive: 0.25 } } }),
  P({ id: 'g_vocal', name: '清唱人声', group: '流派', modules: { eq: eqZero([-3, -2, 3, 4, 1, -1]), stereo: { mid: 3 }, reverb: { ir: 'plate', wet: 0.12 } } }),
  P({ id: 'g_lofi', name: 'Lo-Fi', group: '流派', modules: { eq: eqZero([3, 2, 0, -2, -3, -4]), excite: { type: 'tape', drive: 0.3 }, comp: { th: -22, ratio: 3 } } }),
  P({ id: 'g_anime', name: '二次元', group: '流派', modules: { eq: eqZero([3, 0, 1, 2, 4, 2]), excite: { type: 'soft', drive: 0.2, air: 4 }, reverb: { ir: 'hall', wet: 0.22 } } }),

  // —— 耳机/设备 ——
  P({ id: 'h_earbud', name: '半入耳耳机', group: '耳机', modules: { bass: { on: true, freq: 80, amount: 0.5 }, eq: eqZero([5, 2, 0, 0, 2, 3]), excite: { type: 'soft', drive: 0.15, air: 5 } } }),
  P({ id: 'h_over', name: '头戴开放式', group: '耳机', modules: { eq: eqZero([0, 0, 0, 0, 1, 2]), stereo: { width: 0.15 } } }),
  P({ id: 'h_inear', name: '入耳监听', group: '耳机', modules: { eq: eqZero([-1, -1, 0, 1, 1, -2]), comp: { th: -20, ratio: 2.5 } } }),
  P({ id: 'h_speaker', name: '小音箱外放', group: '耳机', modules: { bass: { on: true, freq: 90, amount: 0.6 }, eq: eqZero([4, 3, 1, 1, 2, 2]), stereo: { sideLowcut: 150 } } }),
  P({ id: 'h_car', name: '车载', group: '耳机', modules: { bass: { on: true, freq: 65, amount: 0.7 }, reverb: { ir: 'stage', wet: 0.3 }, stereo: { width: 0.4 }, eq: eqZero([4, 1, 0, 1, 2, 1]) } }),

  // —— 场景 ——
  P({ id: 's_live', name: '现场演唱会', group: '场景', modules: { reverb: { ir: 'stage', wet: 0.36 }, stereo: { width: 0.3 }, eq: eqZero([3, 1, 3, 1, 1, 2]) } }),
  P({ id: 's_under', name: '水下', group: '场景', modules: { eq: eqZero([0, 3, 1, -2, -14, 6]), reverb: { ir: 'hall', wet: 0.45 } } }),
  P({ id: 's_concert', name: '演唱会(人声)', group: '场景', modules: { stereo: { mid: 2, width: 0.2 }, reverb: { ir: 'hall', wet: 0.3 }, eq: eqZero([2, 0, 2, 4, 1, 2]) } }),
  P({ id: 's_immersive', name: '沉浸环绕', group: '场景', modules: { stereo: { width: 0.45 }, reverb: { ir: 'church', wet: 0.3 }, eq: eqZero([2, 0, 1, 1, 3, 2]) } }),
  P({ id: 's_phone', name: '电话', group: '场景', modules: { eq: eqZero([0, 4, 7, 1, 0, 0]), excite: { type: 'off' } } }),
  P({ id: 's_radio', name: '电台', group: '场景', modules: { eq: eqZero([3, 3, 5, -1, 0, 0]), comp: { th: -16, ratio: 8 } } }),
  P({ id: 's_vinyl', name: '黑胶唱片', group: '场景', modules: { eq: eqZero([1, 1, -1, -2, -4, 2]), excite: { type: 'tape', drive: 0.35 }, reverb: { ir: 'room', wet: 0.12 } } }),

  // —— 监听/母带向（手动党最爱）——
  P({ id: 'm_studio', name: '录音棚', group: '监听', modules: { comp: { th: -20, ratio: 4 }, eq: eqZero([0, 0, 0, 0, 0.5, 0]) } }),
  P({ id: 'm_hires', name: 'Hi-Res监听', group: '监听', modules: { eq: eqZero([0, 0, 0, 0.5, 3, 0]), comp: { th: -30, ratio: 2 } } }),
  P({ id: 'm_master', name: '母带微光', group: '监听', modules: { eq: eqZero([0.5, 0, 0, 0, 1, 1.5]), excite: { type: 'soft', drive: 0.1, air: 3 }, comp: { th: -16, ratio: 2.5, makeup: 1 } } }),
  P({ id: 'm_trans', name: '通透清晰度', group: '监听', modules: { eq: eqZero([0, 0, 1, 3, 4, 5]), excite: { type: 'soft', drive: 0.15, air: 6 } } }),

  // —— 手动底（全关，留给用户自己调）——
  P({ id: 'off', name: '关闭', group: '基础', modules: {} })
];

function eqZero(arr) {
  // 用 [g0..g9] 覆盖，其余为 0
  var bands = EQ_FREQS.map(function (f, i) {
    return { type: i < 2 ? 'lowshelf' : (i > 7 ? 'highshelf' : 'peaking'), freq: f, gain: 0, q: 1.0 };
  });
  for (var i = 0; i < arr.length && i < 10; i++) if (typeof arr[i] === 'number') bands[i].gain = arr[i];
  return { bands: bands };
}
function findPreset(id) {
  for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
  return PRESETS[PRESETS.length - 1]; // off
}
var GROUPS = ['基础', '官方旗舰', '流派', '耳机', '场景', '监听'];
loadState();
var USER_PRESETS = loadUserPresets();
var CUSTOM_IR = null; // {buffer} 用户导入的卷积 IR
var CUSTOM_IR_NAME = '';


// ---------------- 运行时 ----------------
var ctx = null, nodes = null, claimed = null, srcNode = null;
var rms = 0, peak = 0, rmsBuf = null, freqBuf = null;
var claimedPlayed = false;
var diag = { chain: '-', src: '-', err: '-' };
var smartAccum = null, smartFrames = 0, smartTimer = null;

function dbToGain(db) { return Math.pow(10, db / 20); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function mono(n) { try { n.channelCount = 1; n.channelCountMode = 'explicit'; n.channelInterpretation = 'speakers'; } catch (e) {} return n; }

// 饱和曲线 tube/tape/soft
function makeCurve(kind, drive) {
  var n = 1024, c = new Float32Array(n), k = clamp(drive, 0, 1) * 8 + 0.0001;
  for (var i = 0; i < n; i++) {
    var x = (i / (n - 1)) * 2 - 1, y;
    if (kind === 'tube') y = Math.tanh(x * (1 + k)) / Math.tanh(1 + k) * (1 - 0.12 * Math.exp(-Math.abs(x) * 6));
    else if (kind === 'tape') y = Math.tanh(x * (1 + k * 0.5)) / Math.tanh(1 + k * 0.5);
    else if (kind === 'off') y = x;
    else y = x / (1 + Math.abs(x) * k * 0.5); // soft
    c[i] = y;
  }
  return c;
}

function makeIR(def, size) {
  var rate = ctx.sampleRate;
  var len = Math.max(1, Math.floor(rate * Math.min(4.0, def.len * (size / 2.0))));
  var buf = ctx.createBuffer(2, len, rate);
  var pre = Math.floor(rate * def.pre);
  for (var ch = 0; ch < 2; ch++) {
    var d = buf.getChannelData(ch);
    for (var i = 0; i < len; i++) {
      if (i < pre) { d[i] = 0; continue; }
      var t = (i - pre) / (len - pre);
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, def.decay) * 0.5;
    }
  }
  return buf;
}

function propDesc(proto, name) {
  while (proto) { var d = Object.getOwnPropertyDescriptor(proto, name); if (d) return d; proto = Object.getPrototypeOf(proto); }
  return null;
}
function hookProp(el, name, onChange) {
  var d = propDesc(Object.getPrototypeOf(el), name);
  if (!d || !d.get || !d.set) return false;
  try {
    Object.defineProperty(el, name, { configurable: true, enumerable: d.enumerable,
      get: function () { return d.get.call(this); }, set: function (v) { d.set.call(this, v); onChange(v, this); } });
  } catch (e) { return false; }
  return true;
}

// ---------------- 节点图（信号流一次搭对） ----------------
function buildChain() {
  var N = {}, i;
  N.input = ctx.createGain();                                   // 输入增益/自动响度
  // 低音谐波增强支路
  N.bassSum = ctx.createGain();
  N.bassLP = ctx.createBiquadFilter(); N.bassLP.type = 'lowpass'; N.bassLP.frequency.value = 90;
  N.bassWS = ctx.createWaveShaper(); N.bassWS.curve = makeCurve('tube', 0.6); N.bassWS.oversample = '2x';
  N.bassHP = ctx.createBiquadFilter(); N.bassHP.type = 'highpass'; N.bassHP.frequency.value = 200;
  N.bassGain = ctx.createGain(); N.bassGain.gain.value = 0;
  // 10 段参数 EQ
  N.eq = EQ_FREQS.map(function (f, idx) {
    var b = ctx.createBiquadFilter();
    b.type = idx < 2 ? 'lowshelf' : (idx > 7 ? 'highshelf' : 'peaking');
    b.frequency.value = f; b.Q.value = 1.0; b.gain.value = 0;
    return b;
  });
  // 激励/饱和
  N.exciteDry = ctx.createGain(); N.exciteDry.gain.value = 1;
  N.exciteWS = ctx.createWaveShaper(); N.exciteWS.curve = makeCurve('off', 0); N.exciteWS.oversample = '4x';
  N.exciteWet = ctx.createGain(); N.exciteWet.gain.value = 0;
  N.air = ctx.createBiquadFilter(); N.air.type = 'highshelf'; N.air.frequency.value = 10000; N.air.gain.value = 0;
  // 动态
  N.comp = ctx.createDynamicsCompressor();
  N.makeup = ctx.createGain();
  N.limiter = ctx.createDynamicsCompressor();
  N.limiter.threshold.value = -1; N.limiter.knee.value = 0; N.limiter.ratio.value = 20;
  N.limiter.attack.value = 0.003; N.limiter.release.value = 0.25;
  // 混响
  N.revSend = ctx.createGain(); N.revSend.gain.value = 0;
  N.predelay = ctx.createDelay(1.0); N.predelay.delayTime.value = 0.02;
  N.conv = ctx.createConvolver(); N.conv.normalize = true;
  N.revReturn = ctx.createGain(); N.revReturn.gain.value = 1;
  // 干湿汇总母线
  N.master = ctx.createGain(); N.master.channelCount = 2; N.master.channelCountMode = 'explicit'; N.master.channelInterpretation = 'speakers';
  // M/S 编码
  N.msSplit = ctx.createChannelSplitter(2);
  N.l2m = mono(ctx.createGain()); N.l2m.gain.value = 0.7071;
  N.r2m = mono(ctx.createGain()); N.r2m.gain.value = 0.7071;
  N.l2s = mono(ctx.createGain()); N.l2s.gain.value = 0.7071;
  N.r2s = mono(ctx.createGain()); N.r2s.gain.value = -0.7071;
  N.mid = mono(ctx.createGain()); N.mid.gain.value = 1;
  N.side = mono(ctx.createGain()); N.side.gain.value = 1;
  N.sideHP = mono(ctx.createBiquadFilter()); N.sideHP.type = 'highpass'; N.sideHP.frequency.value = 20;
  // M/S 解码
  N.m2l = mono(ctx.createGain()); N.m2l.gain.value = 0.7071;
  N.m2r = mono(ctx.createGain()); N.m2r.gain.value = 0.7071;
  N.s2l = mono(ctx.createGain()); N.s2l.gain.value = 0.7071;
  N.s2r = mono(ctx.createGain()); N.s2r.gain.value = -0.7071;
  N.outMerge = ctx.createChannelMerger(2);
  // 输出 + 分析：output=手动增益, vol=系统音量补偿, 二者独立
  N.output = ctx.createGain();
  N.vol = ctx.createGain();
  N.analyser = ctx.createAnalyser(); N.analyser.fftSize = 2048; N.analyser.smoothingTimeConstant = 0.8;

  // ---- 连线 ----
  // 输入分两路：干路 + 低音谐波支路，汇到 bassSum
  N.input.connect(N.bassSum);
  N.input.connect(N.bassLP); N.bassLP.connect(N.bassWS); N.bassWS.connect(N.bassHP); N.bassHP.connect(N.bassGain); N.bassGain.connect(N.bassSum);
  // EQ 串行
  N.bassSum.connect(N.eq[0]);
  for (i = 0; i < N.eq.length - 1; i++) N.eq[i].connect(N.eq[i + 1]);
  var eqEnd = N.eq[N.eq.length - 1];
  // 激励：干路 + 饱和湿路 汇入 air
  eqEnd.connect(N.exciteDry); eqEnd.connect(N.exciteWS);
  N.exciteWS.connect(N.exciteWet);
  N.exciteDry.connect(N.air); N.exciteWet.connect(N.air);
  // 动态
  N.air.connect(N.comp); N.comp.connect(N.makeup);
  // 干湿
  N.makeup.connect(N.master);
  N.makeup.connect(N.revSend); N.revSend.connect(N.predelay); N.predelay.connect(N.conv); N.conv.connect(N.revReturn); N.revReturn.connect(N.master);
  // M/S 编码：M=(L+R)*.7071, S=(L-R)*.7071
  N.master.connect(N.msSplit);
  N.msSplit.connect(N.l2m, 0, 0); N.msSplit.connect(N.r2m, 1, 0);
  N.msSplit.connect(N.l2s, 0, 0); N.msSplit.connect(N.r2s, 1, 0);
  N.l2m.connect(N.mid); N.r2m.connect(N.mid);
  N.l2s.connect(N.side); N.r2s.connect(N.side);
  N.side.connect(N.sideHP);
  // M/S 解码：L'=(M+S)*.7071, R'=(M-S)*.7071
  N.mid.connect(N.m2l); N.mid.connect(N.m2r);
  N.sideHP.connect(N.s2l); N.sideHP.connect(N.s2r);
  N.m2l.connect(N.outMerge, 0, 0); N.s2l.connect(N.outMerge, 0, 0);
  N.m2r.connect(N.outMerge, 0, 1); N.s2r.connect(N.outMerge, 0, 1);
  // 输出链：outMerge -> output(手动) -> vol(系统音量) -> limiter -> analyser -> destination
  N.outMerge.connect(N.output); N.output.connect(N.vol); N.vol.connect(N.limiter); N.limiter.connect(N.analyser); N.analyser.connect(ctx.destination);

  nodes = N;
  rmsBuf = new Float32Array(N.analyser.fftSize);
  freqBuf = new Float32Array(N.analyser.frequencyBinCount);
  N.conv.buffer = makeIR(IR_DEFS.room, 2.0);
  diag.chain = 'ok';
}

function syncVolume() { // 音量/静音补偿仍作用于 master 之后的最终输出：用 output 前的独立 volGain 更准确
  // 这里用 N.output 兼顾 output 增益与系统音量：见 applyAll 中的 volGain
  if (!nodes || !claimed) return;
  var v = (claimed.muted === true) ? 0 : (claimed.volume || 1);
  try { nodes.vol.gain.value = v; } catch (e) {}
}


// ---------------- 模块应用（只改节点参数，不重建图） ----------------
function applyInput() {
  if (!nodes) return;
  var m = state.modules.input;
  var g = clamp(m.gain || 0, -24, 24);
  // 自动响度目标由智能模块写入 m.autoGainDb
  var extra = (m.autoLoud && typeof m.autoGainDb === 'number') ? clamp(m.autoGainDb, -12, 12) : 0;
  try { nodes.input.gain.value = dbToGain(g + extra); } catch (e) {}
}
function applyBass() {
  if (!nodes) return;
  var m = state.modules.bass;
  try {
    nodes.bassLP.frequency.value = clamp(m.freq || 90, 30, 250);
    nodes.bassHP.frequency.value = clamp((m.freq || 90) * 2.2, 120, 600);
    nodes.bassGain.gain.value = m.on ? clamp(m.amount || 0, 0, 1) * 0.9 : 0;
  } catch (e) {}
}
function applyEQ() {
  if (!nodes) return;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands)) state.modules.eq = { bands: defaultState().modules.eq.bands };
  var bands = state.modules.eq.bands;
  var k = clamp(state.intensity, 0, 100) / 100;
  for (var i = 0; i < nodes.eq.length && i < bands.length; i++) {
    var b = bands[i], f = nodes.eq[i];
    try {
      f.type = b.type || 'peaking';
      f.frequency.value = clamp(b.freq || EQ_FREQS[i], 20, 20000);
      f.Q.value = clamp(b.q || 1, 0.1, 10);
      f.gain.value = (b.gain || 0) * k;
    } catch (e) {}
  }
}
function applyExcite() {
  if (!nodes) return;
  var m = state.modules.excite, k = clamp(state.intensity, 0, 100) / 100;
  try {
    var type = m.type || 'off';
    nodes.exciteWS.curve = makeCurve(type, m.drive || 0);
    // 饱和湿量随驱动，干量恒定；激励主要靠谐波，wet 不宜盖过原声
    nodes.exciteWet.gain.value = (type === 'off') ? 0 : clamp(0.4 + (m.drive || 0) * 0.6, 0, 1) * k;
    nodes.exciteDry.gain.value = 1;
    nodes.air.gain.value = (m.air || 0) * k;
  } catch (e) {}
}
function applyComp() {
  if (!nodes) return;
  var m = state.modules.comp;
  try {
    nodes.comp.threshold.value = clamp(m.th != null ? m.th : -18, -60, 0);
    nodes.comp.knee.value = clamp(m.knee != null ? m.knee : 24, 0, 40);
    nodes.comp.ratio.value = clamp(m.ratio != null ? m.ratio : 3, 1, 20);
    nodes.comp.attack.value = clamp(m.at != null ? m.at : 0.01, 0, 1);
    nodes.comp.release.value = clamp(m.rel != null ? m.rel : 0.25, 0, 1);
    nodes.makeup.gain.value = dbToGain(clamp(m.makeup || 0, -12, 12));
    nodes.limiter.threshold.value = m.limiter ? clamp(m.ceiling != null ? m.ceiling : -1, -12, 0) : 0;
    nodes.limiter.ratio.value = m.limiter ? 20 : 1;
  } catch (e) {}
}
function applyReverb() {
  if (!nodes) return;
  var m = state.modules.reverb;
  try {
    nodes.revSend.gain.value = (m.ir === 'none') ? 0 : clamp(m.wet != null ? m.wet : 0.15, 0, 1);
    nodes.predelay.delayTime.value = clamp((m.predelay || 0) / 1000, 0, 0.5);
    var def = IR_DEFS[m.ir] || IR_DEFS.room;
    if (m.ir === 'custom' && CUSTOM_IR) nodes.conv.buffer = CUSTOM_IR;
    else if (m.ir !== 'none') nodes.conv.buffer = makeIR(def, clamp(m.size || 2, 0.5, 4));
  } catch (e) {}
}
function applyStereo() {
  if (!nodes) return;
  var m = state.modules.stereo;
  try {
    var w = clamp(m.width || 0, -1, 1);
    // side 增益：宽度 + 手动 side(dB) + mid(dB) 独立
    var sideGain = dbToGain(clamp((m.side || 0), -12, 12)) * (1 + w);
    var midGain = dbToGain(clamp((m.mid || 0), -12, 12));
    nodes.side.gain.value = sideGain;
    nodes.mid.gain.value = midGain;
    nodes.sideHP.frequency.value = (m.sideLowcut && m.sideLowcut > 0) ? clamp(m.sideLowcut, 20, 1000) : 20;
  } catch (e) {}
}
function applyOutput() {
  if (!nodes) return;
  try { nodes.output.gain.value = dbToGain(clamp(state.modules.output.gain || 0, -24, 12)); } catch (e) {}
}
function applyAll() {
  applyInput(); applyBass(); applyEQ(); applyExcite(); applyComp(); applyReverb(); applyStereo(); applyOutput(); syncVolume();
  updateUI();
}

// ---------------- 预设应用 ----------------
function applyPreset(id, keepManual) {
  var p = findPreset(id);
  state.preset = p.id;
  if (!keepManual) {
    // 用 defaultState 作底，叠加预设覆盖，再叠强度
    var base = defaultState();
    if (p.modules) {
      for (var mk in p.modules) if (p.modules.hasOwnProperty(mk) && base.modules[mk]) {
        var ov = p.modules[mk], dst = base.modules[mk];
        for (var j in ov) if (ov.hasOwnProperty(j)) dst[j] = deepClone(ov[j]);
      }
    }
    base.intensity = state.intensity; // 强度保留用户全局设置
    base.open = state.open; base.smart = false;
    // 防御：eq.bands 必须是 10 段数组，坏数据一律回退默认，避免 renderBands 崩
    if (!Array.isArray(base.modules.eq.bands) || base.modules.eq.bands.length !== 10) {
      base.modules.eq = { bands: defaultState().modules.eq.bands };
    }
    state.modules = base.modules;
    state.smart = false;
  }
  saveState();
  applyAll();
}

// ---------------- 接管 audio ----------------
function resume() { if (ctx && ctx.state !== 'running') { try { ctx.resume().catch(function () {}); } catch (e) {} } }
function onPlay() { claimedPlayed = true; resume(); if (state.smart) startSmart(); }

function claim(el) {
  if (claimed === el) return;
  if (claimed) { try { if (srcNode) srcNode.disconnect(); } catch (e) {} }
  claimed = el;
  window.__vfx_el = el;
  diag.how = 'ctor';
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { diag.err = 'AudioContext: ' + e.message; return; }
  try { ctx.onstatechange = function () { updateDiag(); }; } catch (e) {}
  buildChain();
  try { srcNode = ctx.createMediaElementSource(el); srcNode.connect(nodes.input); diag.src = 'ok'; }
  catch (e) { diag.src = 'fail'; diag.err = 'capture: ' + e.message; return; }
  hookProp(el, 'volume', function () { syncVolume(); });
  hookProp(el, 'muted', function () { syncVolume(); });
  installSetSinkHook(el);
  el.addEventListener('play', onPlay, true);
  resume();
  setTimeout(resume, 300); setTimeout(resume, 1000);
  applyAll();
}
function installSetSinkHook(el) {
  var orig = el.setSinkId;
  if (typeof orig !== 'function') return;
  el.setSinkId = function () { var r = orig.apply(this, arguments); if (ctx && typeof ctx.setSinkId === 'function') { try { ctx.setSinkId(arguments[0]); } catch (e) {} } return r; };
}
function maybeClaim(el) { if (!claimed || el.preload !== 'metadata') { if (!claimed) claim(el); } }

var origPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
  if (this.tagName === 'AUDIO' && this.crossOrigin === 'anonymous' && this !== claimed && !claimedPlayed) claim(this);
  return origPlay.apply(this, arguments);
};
(function hookAudioCtor() {
  var OrigAudio = window.Audio;
  if (typeof OrigAudio !== 'function') return;
  window.Audio = function Audio() {
    var el = new OrigAudio();
    try {
      hookProp(el, 'crossOrigin', function (v) { if (v === 'anonymous') maybeClaim(el); });
      hookProp(el, 'preload', function (v) {
        if (v === 'metadata' && claimed === el) {
          try { if (srcNode) srcNode.disconnect(); } catch (e) {}
          claimed = null; srcNode = null; claimedPlayed = false; diag.src = 'skip:probe'; diag.chain = '-';
        }
      });
    } catch (e) {}
    return el;
  };
  window.Audio.prototype = OrigAudio.prototype;
  try { Object.setPrototypeOf(window.Audio, OrigAudio); } catch (e) {}
})();


// ---------------- 实时分析（频谱/电平/响度） ----------------
function readSpectrum() {
  if (!nodes) return null;
  try { nodes.analyser.getFloatFrequencyData(freqBuf); } catch (e) { return null; }
  return freqBuf;
}
function bandDb(spec, lo, hi) {
  if (!spec) return -90;
  var sr = ctx.sampleRate, n = spec.length;
  var a = Math.max(0, Math.floor(lo / (sr / 2) * n));
  var b = Math.min(n - 1, Math.ceil(hi / (sr / 2) * n));
  var s = 0, c = 0;
  for (var i = a; i <= b; i++) { if (spec[i] > -120) { s += Math.pow(10, spec[i] / 10); c++; } }
  return c ? 10 * Math.log10(s / c + 1e-12) : -90;
}
function diagTick() {
  if (nodes && nodes.analyser) {
    try {
      nodes.analyser.getFloatTimeDomainData(rmsBuf);
      var s = 0, p = 0;
      for (var i = 0; i < rmsBuf.length; i++) { s += rmsBuf[i] * rmsBuf[i]; var av = Math.abs(rmsBuf[i]); if (av > p) p = av; }
      rms = Math.sqrt(s / rmsBuf.length); peak = p;
    } catch (e) { rms = 0; peak = 0; }
  }
  updateDiag();
  drawViz();
}
function dbVal() { return rms > 0 ? (20 * Math.log10(rms + 1e-9)).toFixed(1) : '-∞'; }

// ---------------- 智能引擎 ----------------
// 采样数秒频谱，统计低频/中频/高频/人声带能量与立体声宽度，给出非平凡调参。
function startSmart() {
  smartAccum = { low: 0, mid: 0, high: 0, vocal: 0, n: 0, loud: 0 };
  smartFrames = 0;
  if (smartTimer) clearInterval(smartTimer);
  smartTimer = setInterval(function () {
    var spec = readSpectrum();
    if (!spec) return;
    var lo = bandDb(spec, 30, 160), mid = bandDb(spec, 300, 2000),
        hi = bandDb(spec, 6000, 16000), voc = bandDb(spec, 800, 3500);
    smartAccum.low += Math.pow(10, lo / 20); smartAccum.mid += Math.pow(10, mid / 20);
    smartAccum.high += Math.pow(10, hi / 20); smartAccum.vocal += Math.pow(10, voc / 20);
    smartAccum.loud += rms; smartAccum.n++; smartFrames++;
    if (smartFrames >= 20) { finishSmart(); }
  }, 150);
}
function finishSmart() {
  if (smartTimer) { clearInterval(smartTimer); smartTimer = null; }
  var a = smartAccum, n = Math.max(1, a.n);
  // 归一化到 -1..1 的"相对平衡"
  function lin(v) { return 20 * Math.log10(v / n + 1e-9); }
  var L = lin(a.low), M = lin(a.mid), H = lin(a.high), V = lin(a.vocal);
  var overall = (L + M + H) / 3;
  var bL = clamp((L - overall) / 12, -1, 1);   // 低频相对量
  var bH = clamp((H - overall) / 12, -1, 1);   // 高频相对量
  var bV = clamp((V - M) / 10, -1, 1);         // 人声突出度
  // 自动 EQ：缺低频补低频、缺高频补空气、人声弱则抬 2~4k
  var bands = state.modules.eq.bands;
  var base = defaultState().modules.eq.bands;
  for (var i = 0; i < bands.length; i++) bands[i] = deepClone(base[i]);
  bands[0].gain += -bL * 3.5; bands[1].gain += -bL * 2.5;   // 低频补偿
  bands[8].gain += -bH * 3.0; bands[9].gain += -bH * 2.0;   // 高频补偿
  if (bV < -0.1) { bands[6].gain += 2 * Math.abs(bV); bands[7].gain += 2.5 * Math.abs(bV); }
  // 自动激励：高频不足时加空气与柔和饱和
  state.modules.excite = { type: bH < -0.15 ? 'soft' : 'off', drive: 0.2, air: bH < -0.15 ? clamp(-bH * 5, 0, 5) : 0 };
  // 自动宽度：中频拥挤时略收宽，声场能量高时略展宽
  state.modules.stereo.width = clamp((bL + bH) * 0.15, -0.2, 0.35);
  // 自动低音增强：低频明显不足时开
  state.modules.bass.on = bL < -0.2;
  state.modules.bass.amount = clamp(-bL * 0.6, 0, 0.6);
  // 自动响度匹配：把测得 RMS 拉到目标 -18 dBFS 附近
  var target = 0.126; // ~ -18 dBFS
  var meas = a.loud / n;
  if (meas > 0.0001) {
    var g = clamp(20 * Math.log10(target / meas), -12, 12);
    state.modules.input.autoLoud = true;
    state.modules.input.autoGainDb = +g.toFixed(2);
  }
  state.preset = 'smart'; state.smart = true;
  saveState(); applyAll();
  window.__vfx_lastSmart = { L: +L.toFixed(1), M: +M.toFixed(1), H: +H.toFixed(1), V: +V.toFixed(1),
    autoGainDb: state.modules.input.autoGainDb, eq: bands.map(function (b) { return +b.gain.toFixed(1); }) };
}
function toggleSmart(on) {
  state.smart = !!on;
  if (!state.smart) { if (smartTimer) { clearInterval(smartTimer); smartTimer = null; } state.modules.input.autoLoud = false; }
  else startSmart();
  saveState(); updateUI();
}


// ---------------- UI ----------------
var ui = { btn: null, panel: null, diag: null, canvas: null, cctx: null, eqCanvas: null, eqc: null, timer: null, tab: 'presets' };
function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function num(v, d) { return (+v).toFixed(d == null ? 2 : d); }

function sec(title, key) {
  var wrap = el('div', 'vfx-sec');
  var head = el('div', 'vfx-sec-head');
  head.appendChild(el('span', 'vfx-sec-t', title));
  var caret = el('span', 'vfx-caret', '▾'); head.appendChild(caret);
  var body = el('div', 'vfx-sec-body');
  head.addEventListener('click', function (e) {
    e.preventDefault();
    var open = body.classList.toggle('vfx-open') || body.style.display === 'block';
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
    caret.textContent = body.style.display === 'none' ? '▸' : '▾';
  });
  wrap.appendChild(head); wrap.appendChild(body);
  wrap._body = body;
  return wrap;
}
function row(label, ctrl, valEl) {
  var r = el('div', 'vfx-row2');
  r.appendChild(el('label', 'vfx-lab', label));
  r.appendChild(ctrl);
  if (valEl) r.appendChild(valEl);
  return r;
}
function slider(min, max, step, val, onInput) {
  var s = el('input', 'vfx-rng'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = val;
  var v = el('span', 'vfx-val', '');
  s.addEventListener('input', function () { onInput(parseFloat(s.value), v); });
  s._val = v;
  return { wrap: row('', s, v), s: s, v: v };
}
function setSlider(sl, val, fmt) {
  sl.s.value = val; sl.v.textContent = fmt != null ? fmt : num(val);
}
function select(options, val, onChange) {
  var s = el('select', 'vfx-sel');
  for (var i = 0; i < options.length; i++) {
    var o = el('option', null, options[i].label); o.value = options[i].value; s.appendChild(o);
  }
  s.value = val;
  s.addEventListener('change', function () { onChange(s.value); });
  return s;
}

function buildPanel() {
  var panel = el('div', 'vfx-panel' + (state.open ? '' : ' vfx-hidden'));
  panel.id = 'vfx-panel';
  // 头部
  var head = el('div', 'vfx-head');
  var t = el('div', 'vfx-title', '蝰蛇音效 Pro');
  t.appendChild(el('small', null, '模块化 DSP · 手动深调 · 智能 · 生态'));
  head.appendChild(t);
  var hb = el('div', 'vfx-head-btns');
  var abBtn = el('button', 'vfx-mini', 'A/B'); abBtn.title = '对照开关';
  abBtn.addEventListener('click', function (e) { e.preventDefault(); toggleAB(); });
  var smartBtn = el('button', 'vfx-mini vfx-smart', '智能'); smartBtn.title = '智能自动调音';
  smartBtn.addEventListener('click', function (e) { e.preventDefault(); toggleSmart(!state.smart); });
  var close = el('button', 'vfx-close', '×'); close.addEventListener('click', function (e) { e.preventDefault(); togglePanel(); });
  hb.appendChild(abBtn); hb.appendChild(smartBtn); hb.appendChild(close);
  head.appendChild(hb); panel.appendChild(head);

  // 标签页
  var tabs = el('div', 'vfx-tabs');
  ['presets', 'eq', 'dyn', 'space', 'stereo', 'io', 'lib'].forEach(function (k) {
    var b = el('button', 'vfx-tab', ({ presets: '预设', eq: '均衡', dyn: '动态/激励', space: '混响', stereo: '声场', io: '输入/输出', lib: '生态' })[k]);
    b.setAttribute('data-tab', k);
    b.addEventListener('click', function (e) { e.preventDefault(); switchTab(k); });
    tabs.appendChild(b);
  });
  panel.appendChild(tabs);
  var pages = el('div', 'vfx-pages'); panel.appendChild(pages);
  ui.pages = pages;
  buildPresetsPage(pages);
  buildEQPage(pages);
  buildDynPage(pages);
  buildSpacePage(pages);
  buildStereoPage(pages);
  buildIOPage(pages);
  buildLibPage(pages);

  // 底部：可视化 + 诊断
  var vizWrap = el('div', 'vfx-viz');
  ui.canvas = el('canvas', 'vfx-spectrum'); ui.canvas.width = 320; ui.canvas.height = 64;
  vizWrap.appendChild(ui.canvas); ui.cctx = ui.canvas.getContext('2d');
  var meter = el('div', 'vfx-meter2'); var bar = el('div', 'vfx-meter2-bar'); meter.appendChild(bar);
  vizWrap.appendChild(meter); ui.meterBar = bar;
  panel.appendChild(vizWrap);
  ui.diag = el('div', 'vfx-diag', ''); panel.appendChild(ui.diag);
  return panel;
}
function switchTab(k) {
  ui.tab = k;
  var tabs = ui.panel.querySelectorAll('.vfx-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('vfx-active', tabs[i].getAttribute('data-tab') === k);
  var pg = ui.panel.querySelectorAll('.vfx-page');
  for (var j = 0; j < pg.length; j++) pg[j].style.display = (pg[j].getAttribute('data-page') === k) ? 'block' : 'none';
}
function page(parent, key) { var p = el('div', 'vfx-page'); p.setAttribute('data-page', key); p.style.display = 'none'; parent.appendChild(p); return p; }


// ---------------- 预设页 ----------------
function buildPresetsPage(parent) {
  var p = page(parent, 'presets');
  var inten = sec('全局音效强度', 'intensity');
  var sl = slider(0, 100, 1, state.intensity, function (v, ve) {
    state.intensity = v; ve.textContent = v + '%'; saveState(); applyEQ(); applyExcite();
  });
  setSlider(sl, state.intensity, state.intensity + '%');
  inten._body.appendChild(sl.wrap);
  inten._body.appendChild(el('p', 'vfx-hint', '强度整体缩放 EQ 提升量与激励湿度，0% 时所有效果归零，方便 A/B 对比。'));
  p.appendChild(inten);
  // 内置预设库
  GROUPS.forEach(function (g) {
    var items = PRESETS.filter(function (x) { return x.group === g; });
    if (!items.length) return;
    var s = sec(g, g);
    var grid = el('div', 'vfx-grid');
    items.forEach(function (it) {
      var b = el('button', 'vfx-item', it.name); b.setAttribute('data-id', it.id);
      b.addEventListener('click', function (e) { e.preventDefault(); applyPreset(it.id); updateUI(); });
      grid.appendChild(b);
    });
    s._body.appendChild(grid);
    p.appendChild(s);
  });
  // 用户预设
  var us = sec('我的预设', 'user');
  var ug = el('div', 'vfx-grid'); ug.id = 'vfx-user-grid'; us._body.appendChild(ug);
  var saveRow = el('div', 'vfx-row2');
  var nameInp = el('input', 'vfx-txt'); nameInp.placeholder = '预设名'; nameInp.id = 'vfx-preset-name';
  var saveBtn = el('button', 'vfx-btn', '保存当前');
  saveBtn.addEventListener('click', function (e) { e.preventDefault(); saveUserPreset(nameInp.value); });
  saveRow.appendChild(nameInp); saveRow.appendChild(saveBtn); us._body.appendChild(saveRow);
  p.appendChild(us);
}
function saveUserPreset(name) {
  name = (name || '').trim() || ('预设' + (Object.keys(USER_PRESETS).length + 1));
  USER_PRESETS[name] = { modules: deepClone(state.modules), intensity: state.intensity, ts: Date.now() };
  saveUserPresets(USER_PRESETS); renderUserPresets();
}
function delUserPreset(name) { delete USER_PRESETS[name]; saveUserPresets(USER_PRESETS); renderUserPresets(); }
function applyUserPreset(name) {
  var o = USER_PRESETS[name]; if (!o) return;
  state.modules = deepClone(o.modules); state.intensity = o.intensity != null ? o.intensity : 100;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) {
    state.modules.eq = { bands: defaultState().modules.eq.bands };
  }
  state.preset = 'user:' + name; state.smart = false; saveState(); applyAll();
}
function renderUserPresets() {
  var g = ui.panel && ui.panel.querySelector('#vfx-user-grid'); if (!g) return;
  g.innerHTML = '';
  Object.keys(USER_PRESETS).forEach(function (name) {
    var row = el('div', 'vfx-user-row');
    var b = el('button', 'vfx-item', name);
    b.addEventListener('click', function (e) { e.preventDefault(); applyUserPreset(name); updateUI(); });
    var d = el('button', 'vfx-del', '×'); d.addEventListener('click', function (e) { e.preventDefault(); delUserPreset(name); });
    row.appendChild(b); row.appendChild(d); g.appendChild(row);
  });
}

// ---------------- EQ 页 ----------------
function buildEQPage(parent) {
  var p = page(parent, 'eq');
  p.appendChild(el('p', 'vfx-hint', '10 段全参数均衡。点频段展开，调类型/频率/增益/Q。曲线实时显示。'));
  ui.eqCanvas = el('canvas', 'vfx-eqcurve'); ui.eqCanvas.width = 320; ui.eqCanvas.height = 90;
  p.appendChild(ui.eqCanvas); ui.eqc = ui.eqCanvas.getContext('2d');
  var bandsBox = el('div', 'vfx-bands'); p.appendChild(bandsBox); ui.bandsBox = bandsBox;
  var flat = el('button', 'vfx-btn', '全部归零');
  flat.addEventListener('click', function (e) {
    e.preventDefault();
    state.modules.eq.bands.forEach(function (b) { b.gain = 0; });
    applyEQ(); renderBands();
  });
  p.appendChild(flat);
}
function renderBands() {
  if (!ui.bandsBox) return;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) {
    state.modules.eq = { bands: defaultState().modules.eq.bands };
  }
  ui.bandsBox.innerHTML = '';
  state.modules.eq.bands.forEach(function (b, i) {
    var s = sec((EQ_FREQS[i] >= 1000 ? (EQ_FREQS[i] / 1000) + 'k' : EQ_FREQS[i]) + 'Hz  ·  ' + num(b.gain, 1) + 'dB', 'eq' + i);
    // 类型
    var typeSel = select([
      { value: 'peaking', label: '峰值' }, { value: 'lowshelf', label: '低架' },
      { value: 'highshelf', label: '高架' }, { value: 'lowpass', label: '低通' }, { value: 'highpass', label: '高通' }
    ], b.type, function (v) { b.type = v; applyEQ(); });
    s._body.appendChild(row('类型', typeSel));
    // 频率
    var fSl = slider(20, 20000, 1, b.freq, function (v, ve) { b.freq = v; ve.textContent = (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) + 'Hz'; applyEQ(); });
    setSlider(fSl, b.freq, (b.freq >= 1000 ? (b.freq / 1000).toFixed(1) + 'k' : b.freq) + 'Hz');
    s._body.appendChild(row('频率', fSl.wrap.querySelector('input'), fSl.v));
    // 增益
    var gSl = slider(-15, 15, 0.5, b.gain, function (v, ve) { b.gain = v; ve.textContent = num(v, 1) + 'dB'; applyEQ(); drawEQCurve(); });
    setSlider(gSl, b.gain, num(b.gain, 1) + 'dB');
    s._body.appendChild(row('增益', gSl.wrap.querySelector('input'), gSl.v));
    // Q
    var qSl = slider(0.1, 10, 0.1, b.q, function (v, ve) { b.q = v; ve.textContent = num(v, 1); applyEQ(); });
    setSlider(qSl, b.q, num(b.q, 1));
    s._body.appendChild(row('Q', qSl.wrap.querySelector('input'), qSl.v));
    ui.bandsBox.appendChild(s);
  });
}

// ---------------- 动态/激励页 ----------------
function buildDynPage(parent) {
  var p = page(parent, 'dyn');
  var ex = sec('激励 / 饱和', 'ex');
  var m = state.modules.excite;
  var tSel = select([
    { value: 'off', label: '关闭' }, { value: 'tube', label: '电子管' },
    { value: 'tape', label: '磁带' }, { value: 'soft', label: '柔和饱和' }
  ], m.type, function (v) { m.type = v; applyExcite(); });
  ex._body.appendChild(row('类型', tSel));
  [['驱动', 'drive', 0, 1, 0.05], ['空气感(dB)', 'air', 0, 12, 0.5]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], m[cfg[1]], function (v, ve) { m[cfg[1]] = v; ve.textContent = num(v, 1); applyExcite(); });
    setSlider(sl, m[cfg[1]], num(m[cfg[1]], 1)); ex._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  p.appendChild(ex);
  var cp = sec('压缩器', 'cp');
  var c = state.modules.comp;
  [['阈值(dB)', 'th', -60, 0, 1], ['拐点', 'knee', 0, 40, 1], ['比率', 'ratio', 1, 20, 0.5],
   ['启动(s)', 'at', 0, 1, 0.005], ['释放(s)', 'rel', 0, 1, 0.01], ['补偿(dB)', 'makeup', -12, 12, 0.5],
   ['限幅顶(dB)', 'ceiling', -12, 0, 0.5]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], c[cfg[1]], function (v, ve) { c[cfg[1]] = v; ve.textContent = num(v, 2); applyComp(); });
    setSlider(sl, c[cfg[1]], num(c[cfg[1]], 2)); cp._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  var lim = el('label', 'vfx-check'); var limCb = el('input'); limCb.type = 'checkbox'; limCb.checked = c.limiter;
  limCb.addEventListener('change', function () { c.limiter = limCb.checked; applyComp(); });
  lim.appendChild(limCb); lim.appendChild(document.createTextNode(' 真峰限幅')); cp._body.appendChild(lim);
  p.appendChild(cp);
}

// ---------------- 混响页 ----------------
function buildSpacePage(parent) {
  var p = page(parent, 'space');
  var s = sec('卷积混响', 'rev');
  var m = state.modules.reverb;
  var opts = Object.keys(IR_DEFS).map(function (k) { return { value: k, label: IR_DEFS[k].label }; });
  opts.push({ value: 'custom', label: '自定义 IR…' });
  var irSel = select(opts, m.ir, function (v) {
    m.ir = v;
    if (v === 'custom' && !CUSTOM_IR) openIRPicker();
    applyReverb();
  });
  s._body.appendChild(row('空间', irSel));
  [['湿度', 'wet', 0, 1, 0.01], ['预延时(ms)', 'predelay', 0, 200, 1], ['尺寸', 'size', 0.5, 4, 0.1]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], m[cfg[1]], function (v, ve) { m[cfg[1]] = v; ve.textContent = num(v, 2); applyReverb(); });
    setSlider(sl, m[cfg[1]], num(m[cfg[1]], 2)); s._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  var imp = el('button', 'vfx-btn', '导入自定义 IR (.wav)');
  imp.addEventListener('click', function (e) { e.preventDefault(); openIRPicker(); });
  s._body.appendChild(imp);
  s._body.appendChild(el('p', 'vfx-hint', CUSTOM_IR ? ('已载入：' + CUSTOM_IR_NAME) : '可选任意单/双声道 wav 作脉冲响应。'));
  p.appendChild(s);
}
function openIRPicker() {
  var inp = el('input'); inp.type = 'file'; inp.accept = '.wav,audio/wav';
  inp.style.display = 'none'; document.body.appendChild(inp);
  inp.addEventListener('change', function () {
    var f = inp.files && inp.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      ctx.decodeAudioData(fr.result.slice(0), function (buf) {
        CUSTOM_IR = buf; CUSTOM_IR_NAME = f.name;
        state.modules.reverb.ir = 'custom'; applyReverb();
        var h = ui.panel && ui.panel.querySelector('.vfx-hint');
        alert('已载入 IR：' + f.name);
        saveState();
      }, function () { alert('IR 解码失败，请用 wav 格式'); });
    };
    fr.readAsArrayBuffer(f);
    inp.remove();
  });
  inp.click();
}

// ---------------- 声场页 ----------------
function buildStereoPage(parent) {
  var p = page(parent, 'stereo');
  var s = sec('立体声场 / 中侧(M/S)', 'st');
  var m = state.modules.stereo;
  [['宽度', 'width', -1, 1, 0.05], ['中央(M)增益dB', 'mid', -12, 12, 0.5],
   ['侧向(S)增益dB', 'side', -12, 12, 0.5], ['侧向低频切除Hz', 'sideLowcut', 0, 1000, 10]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], m[cfg[1]], function (v, ve) { m[cfg[1]] = v; ve.textContent = num(v, 2); applyStereo(); });
    setSlider(sl, m[cfg[1]], num(m[cfg[1]], 2)); s._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  p.appendChild(s);
  var b = sec('低音谐波增强', 'bass');
  var bm = state.modules.bass;
  var on = el('label', 'vfx-check'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = bm.on;
  cb.addEventListener('change', function () { bm.on = cb.checked; applyBass(); });
  on.appendChild(cb); on.appendChild(document.createTextNode(' 开启')); b._body.appendChild(on);
  [['中心频率Hz', 'freq', 30, 250, 5], ['谐波量', 'amount', 0, 1, 0.05]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], bm[cfg[1]], function (v, ve) { bm[cfg[1]] = v; ve.textContent = num(v, 2); applyBass(); });
    setSlider(sl, bm[cfg[1]], num(bm[cfg[1]], 2)); b._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  p.appendChild(b);
}

// ---------------- 输入/输出页 ----------------
function buildIOPage(parent) {
  var p = page(parent, 'io');
  var i = sec('输入 / 自动响度', 'in');
  var m = state.modules.input;
  var au = el('label', 'vfx-check'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = m.autoLoud;
  cb.addEventListener('change', function () { m.autoLoud = cb.checked; if (!cb.checked) m.autoGainDb = 0; applyInput(); });
  au.appendChild(cb); au.appendChild(document.createTextNode(' 响度自动匹配(配合智能)')); i._body.appendChild(au);
  var sl = slider(-24, 24, 0.5, m.gain, function (v, ve) { m.gain = v; ve.textContent = num(v, 1) + 'dB'; applyInput(); });
  setSlider(sl, m.gain, num(m.gain, 1) + 'dB'); i._body.appendChild(row('输入增益', sl.wrap.querySelector('input'), sl.v));
  p.appendChild(i);
  var o = sec('输出', 'out');
  var om = state.modules.output;
  var sl2 = slider(-24, 12, 0.5, om.gain, function (v, ve) { om.gain = v; ve.textContent = num(v, 1) + 'dB'; applyOutput(); });
  setSlider(sl2, om.gain, num(om.gain, 1) + 'dB'); o._body.appendChild(row('输出增益', sl2.wrap.querySelector('input'), sl2.v));
  p.appendChild(o);
}

// ---------------- 生态页 ----------------
function buildLibPage(parent) {
  var p = page(parent, 'lib');
  p.appendChild(el('p', 'vfx-hint', '预设可导出为 JSON 分享，也可导入他人预设；自定义 IR 让用户扩展空间。'));
  var exp = el('button', 'vfx-btn', '导出当前为 JSON');
  exp.addEventListener('click', function (e) { e.preventDefault(); exportPreset(); });
  var imp = el('button', 'vfx-btn', '导入 JSON 预设');
  imp.addEventListener('click', function (e) { e.preventDefault(); importPreset(); });
  var row1 = el('div', 'vfx-row2'); row1.appendChild(exp); row1.appendChild(imp); p.appendChild(row1);
  var pkg = el('button', 'vfx-btn vfx-btn-wide', '复制当前配置(可贴给别人)');
  pkg.addEventListener('click', function (e) { e.preventDefault(); copyConfig(); });
  p.appendChild(pkg);
  ui.codeBox = el('textarea', 'vfx-code'); ui.codeBox.placeholder = '导入/导出内容显示在这里'; p.appendChild(ui.codeBox);
  var stat = el('div', 'vfx-stat', ''); p.appendChild(stat); ui.stat = stat;
}
function currentConfig() { return { v: 2, name: state.preset, intensity: state.intensity, modules: state.modules }; }
function exportPreset() {
  var txt = JSON.stringify(currentConfig());
  if (ui.codeBox) ui.codeBox.value = txt;
  try { navigator.clipboard.writeText(txt); } catch (e) {}
  if (ui.stat) ui.stat.textContent = '已导出 ' + txt.length + ' 字节';
}
function importPreset() {
  var txt = ui.codeBox ? ui.codeBox.value.trim() : '';
  if (!txt) { if (ui.stat) ui.stat.textContent = '先粘贴 JSON 再点导入'; return; }
  try {
    var o = JSON.parse(txt);
    if (!o.modules) throw new Error('缺 modules');
    state.modules = deepClone(o.modules); state.intensity = o.intensity != null ? o.intensity : 100;
    if (!state.modules.eq || !Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) {
      state.modules.eq = { bands: defaultState().modules.eq.bands };
    }
    state.preset = 'imported'; state.smart = false; saveState(); applyAll(); renderBands();
    if (ui.stat) ui.stat.textContent = '导入成功';
  } catch (e) { if (ui.stat) ui.stat.textContent = '导入失败：' + e.message; }
}
function copyConfig() {
  var txt = JSON.stringify(currentConfig());
  if (ui.codeBox) ui.codeBox.value = txt;
  try { navigator.clipboard.writeText(txt); } catch (e) {}
  if (ui.stat) ui.stat.textContent = '已复制';
}


// ---------------- A/B 对照 ----------------
function toggleAB() {
  if (state.ab) {
    var snap = state.ab; state.modules = snap; state.ab = null;
  } else {
    state.ab = deepClone(state.modules);
    // B：把主要效果关掉，只留中性链，方便对比
    var neutral = defaultState().modules;
    state.modules = neutral;
  }
  if (!Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) {
    state.modules.eq = { bands: defaultState().modules.eq.bands };
  }
  state.smart = false;
  saveState(); applyAll(); renderBands();
  if (ui.stat) ui.stat.textContent = state.ab ? 'B(中性) 已启用，再点回 A' : '已回到 A';
}

// ---------------- 装配 UI ----------------
function ensureUI() {
  if (ui.btn && ui.btn.parentNode) return;
  var btn = el('button', 'vfx-toggle', '蝰'); btn.id = 'vfx-toggle'; btn.title = '蝰蛇音效 Pro';
  btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); togglePanel(); });
  var host = document.querySelector('.extra-controls');
  if (host) { var ref = host.querySelector('.playback-speed'); if (ref) host.insertBefore(btn, ref.nextSibling); else host.appendChild(btn); }
  else document.body.appendChild(btn);
  ui.btn = btn;
  ui.panel = buildPanel();
  document.body.appendChild(ui.panel);
  renderBands(); renderUserPresets();
  switchTab(state.tab || 'presets');
  if (ui.timer) clearInterval(ui.timer);
  ui.timer = setInterval(diagTick, 100);
  updateUI();
}
function togglePanel() { state.open = !state.open; saveState(); if (ui.panel) ui.panel.classList.toggle('vfx-hidden', !state.open); }
function updateUI() {
  if (!ui.panel) return;
  var btns = ui.panel.querySelectorAll('.vfx-item[data-id]');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('vfx-active', btns[i].getAttribute('data-id') === state.preset);
  var sb = ui.panel.querySelector('.vfx-smart'); if (sb) sb.classList.toggle('vfx-on', state.smart);
}

// ---------------- 可视化 ----------------
function drawViz() {
  if (!ui.cctx || !nodes) return;
  var c = ui.cctx, W = ui.canvas.width, H = ui.canvas.height;
  c.clearRect(0, 0, W, H);
  var spec = readSpectrum();
  if (spec) {
    var step = Math.max(1, Math.floor(spec.length / 64));
    for (var x = 0; x < 64; x++) {
      var v = 0, cc = 0;
      for (var k = 0; k < step; k++) { var idx = x * step + k; if (idx < spec.length && spec[idx] > -100) { v += (spec[idx] + 100); cc++; } }
      var mag = cc ? (v / cc) / 100 : 0;
      var h = Math.max(1, mag * H);
      c.fillStyle = 'rgba(255,77,141,' + (0.35 + mag * 0.65) + ')';
      c.fillRect(x * (W / 64), H - h, (W / 64) - 1, h);
    }
  }
  if (ui.meterBar) ui.meterBar.style.width = Math.min(100, rms * 260).toFixed(0) + '%';
  drawEQCurve();
}
function drawEQCurve() {
  if (!ui.eqc || !nodes) return;
  var c = ui.eqc, W = ui.eqCanvas.width, H = ui.eqCanvas.height;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
  var bands = state.modules.eq.bands, k = clamp(state.intensity, 0, 100) / 100;
  c.strokeStyle = '#ff4d8d'; c.lineWidth = 2; c.beginPath();
  for (var x = 0; x <= W; x++) {
    var f = 20 * Math.pow(1000, x / W); // 20Hz..20kHz 对数
    var g = 0;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var q = clamp(b.q || 1, 0.1, 10);
      var ratio = Math.log(f / (b.freq || EQ_FREQS[i])) / Math.log(2);
      var w = Math.exp(-(ratio * ratio) / (2 * q * q * 0.3));
      g += (b.gain || 0) * k * w;
    }
    var y = H / 2 - clamp(g, -18, 18) / 18 * (H / 2 - 4);
    if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
  // 频点标记
  c.fillStyle = 'rgba(255,157,190,.9)';
  for (var j = 0; j < bands.length; j++) {
    var fx = Math.round(Math.log((bands[j].freq || EQ_FREQS[j]) / 20) / Math.log(1000) * W);
    if (fx >= 0 && fx <= W) { c.beginPath(); c.arc(fx, H / 2 - clamp(bands[j].gain * k, -18, 18) / 18 * (H / 2 - 4), 2.5, 0, 6.28); c.fill(); }
  }
}
function diagText() {
  return 'hook:' + (claimed ? 'cap' : 'wait') + ' ctx:' + (ctx ? ctx.state : '-') + ' chain:' + diag.chain +
    ' src:' + diag.src + ' rms:' + rms.toFixed(3) + '(' + dbVal() + 'dB) pk:' + peak.toFixed(2) +
    ' preset:' + state.preset + (state.smart ? ' [智能]' : '') +
    (diag.err !== '-' ? ' err:' + diag.err : '');
}
function updateDiag() { if (ui.diag) ui.diag.textContent = diagText(); }

// ---------------- 调试/自动化句柄 ----------------
window.__vfx = {
  diag: function () {
    return { installed: true, audio: claimed ? 'captured' : 'none', src: diag.src, ctx: ctx ? ctx.state : 'none',
      chain: diag.chain, rms: +rms.toFixed(4), peak: +peak.toFixed(4), preset: state.preset, intensity: state.intensity,
      smart: state.smart, ab: !!state.ab, err: diag.err, sampleRate: ctx ? ctx.sampleRate : null,
      lastSmart: window.__vfx_lastSmart || null };
  },
  params: function () {
    if (!nodes) return null;
    return { eq: nodes.eq.map(function (f) { return +f.gain.value.toFixed(2); }),
      eqTypes: nodes.eq.map(function (f) { return f.type; }),
      bassOn: +nodes.bassGain.gain.value.toFixed(3), exciteWet: +nodes.exciteWet.gain.value.toFixed(3),
      exciteType: state.modules.excite.type, air: +nodes.air.gain.value.toFixed(2),
      comp: { th: nodes.comp.threshold.value, ratio: nodes.comp.ratio.value, knee: nodes.comp.knee.value },
      limiter: { th: nodes.limiter.threshold.value, ratio: nodes.limiter.ratio.value },
      reverb: { wet: +nodes.revSend.gain.value.toFixed(3), ir: state.modules.reverb.ir },
      stereo: { width: state.modules.stereo.width, mid: +nodes.mid.gain.value.toFixed(3), side: +nodes.side.gain.value.toFixed(3) },
      input: +nodes.input.gain.value.toFixed(3), output: +nodes.output.gain.value.toFixed(3), vol: +nodes.vol.gain.value.toFixed(3) };
  },
  state: function () { return deepClone(state.modules); },
  apply: function (id) { applyPreset(id); return window.__vfx.diag(); },
  set: function (mod, key, val) { if (!state.modules[mod]) return null; state.modules[mod][key] = val; applyAll(); return window.__vfx.params(); },
  setEQ: function (i, obj) { if (!state.modules.eq.bands[i]) return null; for (var k in obj) state.modules.eq.bands[i][k] = obj[k]; applyEQ(); renderBands(); return window.__vfx.params().eq; },
  setIntensity: function (v) { state.intensity = clamp(v, 0, 100) | 0; saveState(); applyEQ(); applyExcite(); return window.__vfx.params().eq; },
  smart: function (on) { toggleSmart(on !== false); return window.__vfx.diag(); },
  ab: function () { toggleAB(); return window.__vfx.diag(); },
  exportCfg: function () { return JSON.stringify(currentConfig()); },
  importCfg: function (txt) { if (ui.codeBox) ui.codeBox.value = txt; importPreset(); return window.__vfx.state(); },
  spectrum: function () { var s = readSpectrum(); return s ? Array.from(s) : null; },
  presets: function () { return PRESETS.map(function (p) { return p.id + ':' + p.group; }); },
  userPresets: function () { return Object.keys(USER_PRESETS); },
  saveUserPreset: function (n) { saveUserPreset(n); return Object.keys(USER_PRESETS); },
  applyUserPreset: function (n) { applyUserPreset(n); return window.__vfx.diag(); }
};

// ---------------- 启动 ----------------
if (document.body) ensureUI();
else document.addEventListener('DOMContentLoaded', function () { ensureUI(); });
var _iv = setInterval(function () { if (document.body && !ui.btn) ensureUI(); if (ui.btn) clearInterval(_iv); }, 300);
if (console && console.log) console.log(LOG + ' v2 引擎已加载');

