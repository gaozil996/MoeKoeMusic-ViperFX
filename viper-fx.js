/*
 * 蝰蛇音效（viper-fx）—— MoeKoe Music 实时音效插件（主世界脚本）
 *
 * 做法：用 content_scripts 的 world:MAIN 直接跑在页面主世界，hook window.Audio。
 * 应用播放器在 iE() 里 new Audio() 后立刻设 crossOrigin="anonymous"，我们在那一刻
 * 抢先 new AudioContext + createMediaElementSource 接管音频，建 EQ/压缩/混响/声场 DSP 链。
 * 应用之后若开了响度规格化再来抢同一元素会抛错，被它自己的 try/catch 吞掉降级，播放照常。
 * 接管后 audio.volume/muted 按 Web Audio 规范失效，这里拦 setter 同步到自建主增益，音量静音快捷键都恢复。
 * 不依赖任何跨世界通信，跨世界丢对象的坑整个没了。
 */
(function () {
  'use strict';
  if (window.__vfx_installed) return;
  window.__vfx_installed = true;

  var STORE_KEY = 'viper_fx_state';
  var LOG = '[蝰蛇音效]';

  // ---------- EQ 槽位（6 段） ----------
  var EQ_SLOTS = [
    { type: 'lowshelf',  f: 100,  g: 0, q: 0.7 },
    { type: 'peaking',   f: 300,  g: 0, q: 1.0 },
    { type: 'peaking',   f: 1000, g: 0, q: 1.0 },
    { type: 'peaking',   f: 3000, g: 0, q: 1.0 },
    { type: 'highshelf', f: 9000, g: 0, q: 0.7 },
    { type: 'peaking',   f: 65,   g: 0, q: 1.1 }
  ];
  var BASE_COMP = { th: -24, knee: 20, ratio: 3, at: 0.01, rel: 0.25 };

  // ---------- 预设（对齐酷狗蝰蛇官方分类） ----------
  var PRESETS = [
    { id: 'off', name: '关闭', group: '基础' },

    { id: '3d', name: '3D丽音', group: '官方旗舰',
      eq: [{ g: 2 }, { g: -1 }, { g: 1 }, { g: 1 }, { g: 2 }, { g: 2 }],
      comp: { th: -26, ratio: 2.5, at: 0.01, rel: 0.3 }, wet: 0.3, rev: 2.2, out: 1.0, width: 0.35 },

    { id: 'superbass', name: '超重低音', group: '官方旗舰',
      eq: [{ g: 7 }, { f: 300, g: -3 }, { g: -1 }, { f: 4000, g: 1.5 }, { g: 1.5 }, { f: 58, g: 9, q: 0.9 }],
      comp: { th: -22, ratio: 4, at: 0.006, rel: 0.18 }, wet: 0.05, rev: 1.0, out: 0.95, width: 0 },

    { id: 'purevocal', name: '纯净人声', group: '官方旗舰',
      eq: [{ g: -5 }, { f: 280, g: -3 }, { f: 900, g: 2 }, { f: 2800, g: 5.5, q: 1.3 }, { g: 3 }, { g: 0 }],
      comp: { th: -26, ratio: 3.5, at: 0.008, rel: 0.22 }, wet: 0.08, rev: 1.1, out: 1.05, width: 0 },

    { id: 'hifi', name: 'HiFi现场', group: '官方旗舰',
      eq: [{ g: 3 }, { g: 1 }, { f: 1500, g: 3 }, { f: 4000, g: 1 }, { g: 1 }, { g: 2 }],
      comp: { th: -22, ratio: 4, at: 0.007, rel: 0.2 }, wet: 0.36, rev: 2.4, out: 0.98, width: 0.25 },

    { id: 'slowdance', name: '慢摇', group: '低频',
      eq: [{ g: 9 }, { f: 260, g: -4 }, { g: -2 }, { f: 3500, g: 1 }, { g: 1 }, { f: 50, g: 11, q: 0.85 }],
      comp: { th: -20, ratio: 6, at: 0.005, rel: 0.15 }, wet: 0.08, rev: 1.4, out: 0.9, width: 0 },

    { id: 'dj', name: 'DJ舞曲', group: '低频',
      eq: [{ g: 6 }, { f: 350, g: -3 }, { g: 1 }, { f: 4500, g: 3 }, { g: 5, f: 8000 }, { f: 62, g: 8, q: 1.0 }],
      comp: { th: -18, ratio: 7, at: 0.004, rel: 0.12 }, wet: 0.06, rev: 1.2, out: 0.92, width: 0 },

    { id: 'pop', name: '流行', group: '人声',
      eq: [{ g: 4 }, { f: 300, g: -1.5 }, { g: 0.5 }, { f: 3200, g: 3 }, { g: 1.5 }, { f: 70, g: 4 }],
      comp: { th: -24, ratio: 4, at: 0.008, rel: 0.2 }, wet: 0.1, rev: 1.3, out: 1.0, width: 0 },

    { id: 'studio', name: '录音棚', group: '人声',
      eq: [{ g: 0 }, { g: 0 }, { g: 0 }, { g: 0 }, { g: 0.5 }, { g: 0 }],
      comp: { th: -20, ratio: 4, at: 0.005, rel: 0.15 }, wet: 0.05, rev: 1.0, out: 1.0, width: 0 },

    { id: 'surround', name: '环绕音效', group: '声场',
      eq: [{ g: 2 }, { g: -1 }, { g: 1 }, { g: 1 }, { g: 2 }, { g: 2 }],
      comp: { th: -26, ratio: 2.5, at: 0.01, rel: 0.3 }, wet: 0.3, rev: 2.2, out: 1.0, width: 0.3 },

    { id: 'spatial', name: '空间音频', group: '声场',
      eq: [{ g: 2.5 }, { g: -1 }, { g: 0 }, { g: 1 }, { g: 2.5 }, { g: 1.5 }],
      comp: { th: -25, ratio: 3, at: 0.01, rel: 0.3 }, wet: 0.4, rev: 2.8, out: 1.0, width: 0.4 },

    { id: 'panorama', name: '5.1全景', group: '声场',
      eq: [{ g: 3 }, { g: 0 }, { g: 1 }, { g: 1 }, { g: 3 }, { g: 2 }],
      comp: { th: -25, ratio: 3, at: 0.01, rel: 0.3 }, wet: 0.4, rev: 2.6, out: 1.0, width: 0.45 },

    { id: 'ethereal', name: '空灵', group: '声场',
      eq: [{ g: -3 }, { f: 400, g: -3 }, { g: -2 }, { g: 1 }, { f: 10000, g: 5 }, { g: 0 }],
      comp: { th: -28, ratio: 2.5, at: 0.015, rel: 0.35 }, wet: 0.5, rev: 3.4, out: 1.05, width: 0.3 },

    { id: 'live', name: '现场演唱会', group: '现场',
      eq: [{ g: 3 }, { g: 1 }, { f: 1500, g: 3 }, { f: 4000, g: 1 }, { g: 1 }, { g: 2 }],
      comp: { th: -22, ratio: 4, at: 0.007, rel: 0.2 }, wet: 0.36, rev: 2.4, out: 0.98, width: 0.2 },

    { id: 'underwater', name: '水下', group: '现场',
      eq: [{ type: 'lowpass', f: 520, g: 0, q: 0.8 }, { g: 3 }, { g: 1 }, { g: -2 }, { g: -14 }, { f: 80, g: 6 }],
      comp: { th: -24, ratio: 3, at: 0.01, rel: 0.3 }, wet: 0.45, rev: 3.0, out: 1.1, width: 0 },

    { id: 'hires', name: 'Hi-Res监听', group: '监听',
      eq: [{ g: 0 }, { g: 0 }, { g: 0 }, { g: 0.5 }, { f: 12000, g: 3 }, { g: 0 }],
      comp: { th: -30, ratio: 2, at: 0.02, rel: 0.4 }, wet: 0.03, rev: 0.9, out: 1.0, width: 0 },

    { id: 'classical', name: '古典', group: '监听',
      eq: [{ g: -2 }, { g: -1 }, { g: 0 }, { g: 1 }, { f: 9000, g: 3.5 }, { g: 0 }],
      comp: { th: -30, ratio: 2, at: 0.02, rel: 0.45 }, wet: 0.2, rev: 2.0, out: 1.02, width: 0 },

    { id: 'rock', name: '摇滚', group: '监听',
      eq: [{ g: 5, f: 120 }, { f: 500, g: -2 }, { g: 2 }, { f: 2200, g: 4 }, { g: 2 }, { f: 75, g: 4 }],
      comp: { th: -20, ratio: 5, at: 0.005, rel: 0.16 }, wet: 0.1, rev: 1.3, out: 0.97, width: 0 },

    { id: 'radio', name: '电台', group: '特效',
      eq: [{ type: 'highpass', f: 300, g: 0, q: 0.7 }, { f: 700, g: 3 }, { f: 1800, g: 5 }, { g: -1 }, { type: 'lowpass', f: 3400, g: 0, q: 0.7 }, { g: 0 }],
      comp: { th: -18, ratio: 8, at: 0.003, rel: 0.1 }, wet: 0.06, rev: 0.8, out: 1.1, width: 0 },

    { id: 'phone', name: '电话', group: '特效',
      eq: [{ type: 'highpass', f: 450, g: 0, q: 0.8 }, { f: 900, g: 4 }, { f: 1600, g: 7 }, { g: 1 }, { type: 'lowpass', f: 3000, g: 0, q: 0.8 }, { g: 0 }],
      comp: { th: -16, ratio: 10, at: 0.003, rel: 0.08 }, wet: 0.05, rev: 0.7, out: 1.15, width: 0 },

    { id: 'vinyl', name: '黑胶唱片', group: '特效',
      eq: [{ type: 'highpass', f: 35, g: 0, q: 0.7 }, { g: 1 }, { g: -1 }, { g: -2 }, { g: -4 }, { g: 2 }],
      comp: { th: -20, ratio: 4, at: 0.005, rel: 0.2 }, wet: 0.12, rev: 1.2, out: 1.02, width: 0.12 }
  ];
  var GROUPS = ['基础', '官方旗舰', '低频', '人声', '声场', '现场', '监听', '特效'];

  // ---------- 状态 ----------
  var state = { preset: 'off', intensity: 100, open: false };
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o.preset === 'string' && findPreset(o.preset)) state.preset = o.preset;
      if (o && typeof o.intensity === 'number') state.intensity = Math.max(0, Math.min(100, o.intensity | 0));
      if (o && typeof o.open === 'boolean') state.open = o.open;
    } catch (e) {}
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function findPreset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return PRESETS[0];
  }
  loadState();


  // ---------- 运行时 ----------
  var ctx = null, nodes = null, claimed = null, srcNode = null;
  var presetOut = 1.0, lastRev = null, rms = 0, rmsBuf = null;
  var claimedPlayed = false;
  var diag = { chain: '-', src: '-', err: '-', how: '-' };

  function propDesc(proto, name) {
    while (proto) {
      var d = Object.getOwnPropertyDescriptor(proto, name);
      if (d) return d;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }
  function hookProp(el, name, onChange) {
    var d = propDesc(Object.getPrototypeOf(el), name);
    if (!d || !d.get || !d.set) return false;
    try {
      Object.defineProperty(el, name, {
        configurable: true,
        enumerable: d.enumerable,
        get: function () { return d.get.call(this); },
        set: function (v) { d.set.call(this, v); onChange(v, this); }
      });
    } catch (e) { return false; }
    return true;
  }

  function makeIR(seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(rate * seconds));
    var buf = ctx.createBuffer(2, len, rate);
    var pre = Math.floor(rate * 0.012);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        if (i < pre) { d[i] = 0; continue; }
        var t = (i - pre) / (len - pre);
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.55;
      }
    }
    return buf;
  }

  function buildChain() {
    var inGain = ctx.createGain();
    var filters = [];
    for (var i = 0; i < EQ_SLOTS.length; i++) {
      var f = ctx.createBiquadFilter();
      f.type = EQ_SLOTS[i].type;
      f.frequency.value = EQ_SLOTS[i].f;
      f.Q.value = EQ_SLOTS[i].q;
      f.gain.value = 0;
      filters.push(f);
    }
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = BASE_COMP.th;
    comp.knee.value = BASE_COMP.knee;
    comp.ratio.value = BASE_COMP.ratio;
    comp.attack.value = BASE_COMP.at;
    comp.release.value = BASE_COMP.rel;
    var dry = ctx.createGain();
    var conv = ctx.createConvolver();
    conv.normalize = true;
    var wet = ctx.createGain();
    wet.gain.value = 0;
    var widthIn = ctx.createGain();
    widthIn.channelCount = 2; widthIn.channelCountMode = 'explicit'; widthIn.channelInterpretation = 'speakers';
    var splitter = ctx.createChannelSplitter(2);
    var merger = ctx.createChannelMerger(2);
    var gL = ctx.createGain(); gL.gain.value = 1; gL.channelCount = 1; gL.channelCountMode = 'explicit';
    var gR = ctx.createGain(); gR.gain.value = 1; gR.channelCount = 1; gR.channelCountMode = 'explicit';
    var xLR = ctx.createGain(); xLR.gain.value = 0; xLR.channelCount = 1; xLR.channelCountMode = 'explicit';
    var xRL = ctx.createGain(); xRL.gain.value = 0; xRL.channelCount = 1; xRL.channelCountMode = 'explicit';
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    var master = ctx.createGain();
    master.gain.value = 1;

    inGain.connect(filters[0]);
    for (var j = 0; j < filters.length - 1; j++) filters[j].connect(filters[j + 1]);
    filters[filters.length - 1].connect(comp);
    comp.connect(dry); dry.connect(widthIn);
    comp.connect(conv); conv.connect(wet); wet.connect(widthIn);
    widthIn.connect(splitter);
    splitter.connect(gL, 0, 0); gL.connect(merger, 0, 0);
    splitter.connect(gR, 1, 0); gR.connect(merger, 0, 1);
    splitter.connect(xLR, 1, 0); xLR.connect(merger, 0, 0);
    splitter.connect(xRL, 0, 0); xRL.connect(merger, 0, 1);
    merger.connect(analyser); analyser.connect(master); master.connect(ctx.destination);

    nodes = { inGain: inGain, filters: filters, comp: comp, dry: dry, conv: conv, wet: wet,
      widthIn: widthIn, splitter: splitter, merger: merger, gL: gL, gR: gR, xLR: xLR, xRL: xRL,
      analyser: analyser, master: master };
    rmsBuf = new Float32Array(analyser.fftSize);
    conv.buffer = makeIR(1.0, 2.0);
    lastRev = 1.0;
    diag.chain = 'ok';
  }

  function syncVolume() {
    if (!nodes || !claimed) return;
    var v = (claimed.muted === true) ? 0 : (claimed.volume || 1);
    try { nodes.master.gain.value = presetOut * v; } catch (e) {}
  }

  function installVolumeHooks(el) {
    var had = false;
    if (hookProp(el, 'volume', function () { syncVolume(); })) had = true;
    if (hookProp(el, 'muted', function () { syncVolume(); })) had = true;
    syncVolume();
    return had;
  }

  function installSetSinkHook(el) {
    var orig = el.setSinkId;
    if (typeof orig !== 'function') return;
    el.setSinkId = function () {
      var r = orig.apply(this, arguments);
      if (ctx && typeof ctx.setSinkId === 'function') { try { ctx.setSinkId(arguments[0]); } catch (e) {} }
      return r;
    };
  }

  function resume() {
    if (ctx && ctx.state !== 'running') {
      try { ctx.resume().catch(function () {}); } catch (e) {}
    }
  }
  function onPlay() { claimedPlayed = true; resume(); }

  function claim(el) {
    if (claimed === el) return;
    if (claimed) {
      try { if (srcNode) { srcNode.disconnect(); } } catch (e) {}
    }
    claimed = el;
    try { window.__vfx_el = el; } catch (e) {}
    diag.how = 'ctor';
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { diag.err = 'AudioContext: ' + e.message; return; }
    try { ctx.onstatechange = function () { updateDiag(); }; } catch (e) {}
    buildChain();
    try {
      srcNode = ctx.createMediaElementSource(el);
      srcNode.connect(nodes.inGain);
      diag.src = 'ok';
    } catch (e) {
      diag.src = 'fail';
      diag.err = 'capture: ' + e.message;
      return;
    }
    installVolumeHooks(el);
    installSetSinkHook(el);
    el.addEventListener('play', onPlay, true);
    resume();
    setTimeout(resume, 300); setTimeout(resume, 1000); setTimeout(resume, 2500);
    applyPreset(state.preset);
  }

  // 只在第一个 crossOrigin="anonymous" 的 audio 上抢（主播放器），其余放行。
  // 上传本地音乐时应用会建一个 preload="metadata" 的临时 audio 读时长，
  // 它不设 crossOrigin；这里再拦一层 preload setter，万一它也被设成 anonymous
  // 就撤销接管，避免把探测节点误当播放器。
  function maybeClaim(el) {
    if (claimed || el.preload === 'metadata') return;
    claim(el);
  }
  // 播放兜底：抢错了就换到真正在播的主播放器
  var origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.tagName === 'AUDIO' && this.crossOrigin === 'anonymous' && this !== claimed && !claimedPlayed) {
      claim(this);
    }
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
          // 探测音频的标记：若已被误抢则断开图，交还给宿主原生处理
          if (v === 'metadata' && claimed === el) {
            try { if (srcNode) srcNode.disconnect(); } catch (e) {}
            claimed = null; srcNode = null; claimedPlayed = false;
            diag.src = 'skip:probe'; diag.chain = '-';
          }
        });
      } catch (e) {}
      return el;
    };
    window.Audio.prototype = OrigAudio.prototype;
    try { Object.setPrototypeOf(window.Audio, OrigAudio); } catch (e) {}
  })();


  // ---------- 应用预设 ----------
  function applyPreset(id) {
    var p = findPreset(id);
    state.preset = p.id;
    saveState();
    if (!nodes) { updateUI(); return; }
    var iv = (typeof state.intensity === 'number') ? state.intensity : 100;
    var k = Math.max(0, Math.min(1, iv / 100));
    for (var i = 0; i < EQ_SLOTS.length; i++) {
      var base = EQ_SLOTS[i];
      var ov = (p.eq && p.eq[i]) || {};
      var f = nodes.filters[i];
      try {
        f.type = ov.type || base.type;
        f.frequency.value = (ov.f !== undefined) ? ov.f : base.f;
        f.Q.value = (ov.q !== undefined) ? ov.q : base.q;
        f.gain.value = (ov.g || 0) * k;
      } catch (e) {}
    }
    var c = p.comp || BASE_COMP;
    nodes.comp.threshold.value = c.th;
    nodes.comp.knee.value = (c.knee !== undefined) ? c.knee : BASE_COMP.knee;
    nodes.comp.ratio.value = 1 + (c.ratio - 1) * k;
    nodes.comp.attack.value = c.at;
    nodes.comp.release.value = c.rel;
    var wetEff = (p.wet || 0) * k;
    nodes.wet.gain.value = wetEff;
    try {
      if (wetEff > 0) nodes.comp.connect(nodes.conv); else nodes.comp.disconnect(nodes.conv);
    } catch (e) {}
    var w = (p.width || 0) * k;
    nodes.xLR.gain.value = -w; nodes.xRL.gain.value = -w;
    if (p.rev !== lastRev) { try { nodes.conv.buffer = makeIR(p.rev || 1.0, 2.0); } catch (e) {} lastRev = p.rev; }
    presetOut = p.out || 1.0;
    syncVolume();
    updateUI();
  }

  // ---------- UI ----------
  var ui = { btn: null, panel: null, diag: null, meter: null, foot: null, timer: null };
  function ensureUI() {
    if (ui.btn || !document.body) { if (ui.btn) ui.btn.parentNode || document.body.appendChild(ui.btn); return; }
    var btn = document.createElement('button');
    btn.id = 'vfx-toggle';
    btn.className = 'vfx-toggle';
    btn.title = '蝰蛇音效';
    btn.textContent = '蝰';
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); togglePanel(); });
    ui.btn = btn;
    var host = document.querySelector('.extra-controls');
    if (host) {
      var ref = host.querySelector('.playback-speed');
      if (ref) host.insertBefore(btn, ref.nextSibling); else host.appendChild(btn);
    } else { document.body.appendChild(btn); }

    var panel = document.createElement('div');
    panel.id = 'vfx-panel';
    panel.className = 'vfx-panel' + (state.open ? '' : ' vfx-hidden');
    var html = '<div class="vfx-head"><div class="vfx-title">蝰蛇音效<small>Web Audio 实时 DSP · 21 组预设</small></div>' +
      '<button class="vfx-close" id="vfx-close" aria-label="关闭">×</button></div>';
    html += '<div class="vfx-row"><span class="vfx-label">音效强度</span>' +
      '<input type="range" id="vfx-intensity" min="0" max="100" value="' + state.intensity + '">' +
      '<span class="vfx-iv">' + state.intensity + '%</span></div>';
    for (var g = 0; g < GROUPS.length; g++) {
      var items = PRESETS.filter(function (x) { return x.group === GROUPS[g]; });
      if (!items.length) continue;
      html += '<div class="vfx-group-title">' + GROUPS[g] + '</div><div class="vfx-grid">';
      for (var i = 0; i < items.length; i++) {
        html += '<button class="vfx-item" data-id="' + items[i].id + '">' + items[i].name + '</button>';
      }
      html += '</div>';
    }
    html += '<div class="vfx-meter"><div class="vfx-meter-bar" id="vfx-meter-bar"></div></div>';
    html += '<div class="vfx-diag" id="vfx-diag"></div>';
    html += '<div class="vfx-foot"><span>当前</span><span class="vfx-state" id="vfx-state">' + findPreset(state.preset).name + '</span></div>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    ui.panel = panel;
    ui.diag = panel.querySelector('#vfx-diag');
    ui.meter = panel.querySelector('#vfx-meter-bar');
    ui.foot = panel.querySelector('#vfx-state');
    panel.querySelector('#vfx-close').addEventListener('click', function (e) { e.preventDefault(); togglePanel(); });
    panel.querySelector('#vfx-intensity').addEventListener('input', function (e) {
      state.intensity = parseInt(e.target.value, 10) || 0;
      panel.querySelector('.vfx-iv').textContent = state.intensity + '%';
      saveState(); applyPreset(state.preset);
    });
    var btns = panel.querySelectorAll('.vfx-item');
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        applyPreset(this.getAttribute('data-id'));
      });
    }
    if (ui.timer) clearInterval(ui.timer);
    ui.timer = setInterval(diagTick, 150);
    updateUI();
  }
  function togglePanel() {
    state.open = !state.open; saveState();
    if (ui.panel) ui.panel.classList.toggle('vfx-hidden', !state.open);
  }
  function updateUI() {
    if (!ui.panel) return;
    var btns = ui.panel.querySelectorAll('.vfx-item');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('vfx-active', btns[i].getAttribute('data-id') === state.preset);
    }
    if (ui.foot) ui.foot.textContent = findPreset(state.preset).name;
  }
  function diagText() {
    return 'hook:' + (claimed ? 'cap' : 'wait') + ' | ctx:' + (ctx ? ctx.state : '-') +
      ' | chain:' + diag.chain + ' | src:' + diag.src + ' | rms:' + rms.toFixed(4) +
      ' | vol:' + (claimed ? (claimed.muted ? 'mute' : claimed.volume.toFixed(2)) : '-') +
      (diag.err !== '-' ? ' | err:' + diag.err : '');
  }
  function updateDiag() {
    if (ui.diag) ui.diag.textContent = diagText();
    if (ui.meter) ui.meter.style.width = Math.min(100, rms * 260).toFixed(1) + '%';
  }
  function diagTick() {
    if (nodes && nodes.analyser) {
      try {
        nodes.analyser.getFloatTimeDomainData(rmsBuf);
        var s = 0;
        for (var i = 0; i < rmsBuf.length; i++) s += rmsBuf[i] * rmsBuf[i];
        rms = Math.sqrt(s / rmsBuf.length);
      } catch (e) { rms = 0; }
    }
    updateDiag();
  }

  // ---------- 调试句柄（实机验证用） ----------
  window.__vfx = {
    diag: function () {
      return { installed: true, audio: claimed ? 'captured' : 'none', how: diag.how, src: diag.src,
        ctx: ctx ? ctx.state : 'none', chain: diag.chain, rms: +rms.toFixed(5),
        volume: claimed ? claimed.volume : null, muted: claimed ? claimed.muted : null,
        preset: state.preset, intensity: state.intensity, out: +presetOut.toFixed(3),
        master: nodes ? +nodes.master.gain.value.toFixed(3) : null,
        sampleRate: ctx ? ctx.sampleRate : null, err: diag.err };
    },
    params: function () {
      if (!nodes) return null;
      return { eq: nodes.filters.map(function (f) { return +f.gain.value.toFixed(2); }),
        ratio: +nodes.comp.ratio.value.toFixed(2), wet: +nodes.wet.gain.value.toFixed(3),
        widthL: +nodes.xLR.gain.value.toFixed(3), out: +presetOut.toFixed(3),
        master: +nodes.master.gain.value.toFixed(3) };
    },
    apply: function (id) { applyPreset(id); return window.__vfx.diag(); },
    setIntensity: function (v) { state.intensity = Math.max(0, Math.min(100, v | 0)); saveState(); applyPreset(state.preset); return window.__vfx.diag(); },
    presets: function () { return PRESETS.map(function (p) { return p.id; }); }
  };

  // ---------- 启动 ----------
  if (document.body) ensureUI();
  else document.addEventListener('DOMContentLoaded', function () { ensureUI(); });
  var _iv = setInterval(function () { if (document.body) { ensureUI(); clearInterval(_iv); } }, 300);
  if (console && console.log) console.log(LOG + ' 主世界脚本已加载');
})();
