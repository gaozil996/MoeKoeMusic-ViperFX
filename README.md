# 蝰蛇音效（viper-fx）

仿酷狗蝰蛇音效的实时音效插件，给 MoeKoe Music 加一套可一键切换的音效。21 组预设覆盖超重低音、纯净人声、3D丽音、HiFi现场、空间音频、现场演唱会、黑胶唱片等场景，基于 Web Audio 实时 DSP，含 6 段均衡、动态压缩、卷积混响、声场扩展与音量补偿。

## 做法

用 `manifest.json` 的 `content_scripts` 声明 `world: "MAIN"`，脚本直接跑在页面主世界，避开隔离世界跨脚本通信的坑。

1. hook `window.Audio`。应用播放器在 `AudioController` 里 `const n = new Audio; n.crossOrigin = "anonymous"`，游离节点从不进 DOM。我们在它设 `crossOrigin` 的那一刻抢先 `new AudioContext()` + `createMediaElementSource(n)` 接管音频，建一条 DSP 链输出。
2. 应用自身若开了「响度规格化」，之后会再调一次 `createMediaElementSource(n)`，因同一元素不能建两个 source 而抛错，被它自己的 try/catch 吞掉降级，播放照常，声音从本插件的链出来。响度规格化默认关闭，所以通常这层冲突根本不触发。
3. 接管后 `audio.volume` / `audio.muted` 按 Web Audio 规范不再影响输出，这里拦这两个属性的 setter，同步到自建主增益，于是音量滑块、静音、全局快捷键、滚轮调音量都恢复。
4. 倍速、进度、播放暂停、切歌都不受影响（那一层是解码/播放控制，Web Audio 只截 PCM 流）。

## 预设分组

基础 / 官方旗舰（3D丽音、超重低音、纯净人声、HiFi现场）/ 低频（慢摇、DJ舞曲）/ 人声（流行、录音棚）/ 声场（环绕音效、空间音频、5.1全景、空灵）/ 现场（现场演唱会、水下）/ 监听（Hi-Res监听、古典、摇滚）/ 特效（电台、电话、黑胶唱片）。

面板右下角「蝰」按钮打开，可选预设、调「音效强度」(0-100%)，底部显示当前预设，面板内有一行诊断（接管状态、AudioContext、DSP 链、实时 RMS、音量），用于确认效果生效。

## 安装

把 `viper-fx` 目录整个放进 `%APPDATA%\moekoemusic\extensions\`，重启 MoeKoe，在 设置 → 插件 里能看到它。

## 已知限制

- 应用若开启响度规格化，本插件会接管、应用的响度规格化自动降级（不是 bug，是同一元素只能有一个 source）。
- 本插件用 `blob:`/网络音频，本地歌曲与在线歌曲都能接管。
- 混响用随机衰减脉冲响应，是近似的「空间感」，不是酷狗的官方脉冲样本。
- 切换音频输出设备（`setSinkId`）已做跟随，但个别设备可能行为不一致。
- 调试句柄挂在 `window.__vfx`，可 `window.__vfx.diag()` / `apply('superbass')` / `params()` 查看链状态。
