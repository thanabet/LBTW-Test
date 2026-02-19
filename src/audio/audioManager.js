// src/audio/audioManager.js
// - Starts silent. Must be unlocked by a user gesture (HUD button tap).
// - Two channels: SFX + MUSIC
// - Auto music by time (when no story override)
// - Story override: state.audio.musicTrack (string) or null to release to auto

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

export class AudioManager {
  constructor(config){
    this.cfg = config || {};
    this.paths = {
      sfxBase:  this.cfg.sfxBasePath  || "assets/audio/sfx/",
      musicBase:this.cfg.musicBasePath|| "assets/audio/music/"
    };

    this._unlocked = false;

    this._sfxEnabled = false;
    this._musicEnabled = false;

    this._ctx = null;
    this._sfxGain = null;
    this._musicGain = null;

    this._buffers = new Map(); // key -> AudioBuffer

    // Music players (crossfade)
    this._musicA = null;
    this._musicB = null;
    this._musicIsA = true;
    this._musicKey = null;

    this._musicVol = clamp01(this.cfg.defaults?.musicVolume ?? 0.55);
    this._sfxVol   = clamp01(this.cfg.defaults?.sfxVolume ?? 1.0);

    // looping SFX (rain)
    this._loopNodes = new Map(); // key -> {src, gain}

    // Auto music table
    this._auto = this.cfg.autoMusic || {
      enabled: true,
      slots: [
        { start: "06:00", key: "lofi_morning" },
        { start: "10:00", key: "lofi_day" },
        { start: "17:00", key: "lofi_evening" },
        { start: "21:00", key: "lofi_night" }
      ]
    };

    // Story override state
    // undefined = no instruction, null = release to auto, string = forced track key
    this._storyMusicOverride = undefined;

    // Current “rain active” flag (from state.cloudProfile overcast)
    this._rainActive = false;
  }

  /* ---------------- getters ---------------- */

  isUnlocked(){ return this._unlocked; }
  isSfxEnabled(){ return this._sfxEnabled; }
  isMusicEnabled(){ return this._musicEnabled; }

  /* ---------------- unlock ---------------- */

  async unlock(){
    if(this._unlocked) return true;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) {
      // Fallback: still allow <audio> approach, but we keep everything silent
      this._unlocked = true;
      return true;
    }

    this._ctx = new AudioCtx();

    // master gains
    this._sfxGain = this._ctx.createGain();
    this._musicGain = this._ctx.createGain();

    this._sfxGain.gain.value = this._sfxEnabled ? this._sfxVol : 0;
    this._musicGain.gain.value = this._musicEnabled ? this._musicVol : 0;

    this._sfxGain.connect(this._ctx.destination);
    this._musicGain.connect(this._ctx.destination);

    // iOS: resume on gesture
    if(this._ctx.state === "suspended"){
      try{ await this._ctx.resume(); }catch(_){}
    }

    // tiny silent blip to fully unlock on some iOS versions
    try{
      const buf = this._ctx.createBuffer(1, 1, 22050);
      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this._ctx.destination);
      src.start(0);
    }catch(_){}

    this._unlocked = true;
    return true;
  }

  /* ---------------- toggles ---------------- */

  async toggleSfx(){
    this._sfxEnabled = !this._sfxEnabled;
    if(!this._unlocked && this._sfxEnabled){
      await this.unlock();
    }
    this._applyGains();
    if(!this._sfxEnabled){
      // stop any looping sfx immediately (rain)
      this.stopLoop("rain_loop");
    }else{
      // if rain already active, resume loop softly
      if(this._rainActive) this.playLoop("rain_loop", { fadeSec: 0.6 });
    }
    return this._sfxEnabled;
  }

  async toggleMusic(){
    this._musicEnabled = !this._musicEnabled;
    if(!this._unlocked && this._musicEnabled){
      await this.unlock();
    }
    this._applyGains();

    // If turning on, immediately apply desired track (auto or override)
    if(this._musicEnabled){
      await this._applyDesiredMusic(new Date());
    }else{
      // turning off -> fade out current music quickly
      await this.stopMusic({ fadeSec: 0.2 });
    }
    return this._musicEnabled;
  }

  _applyGains(){
    if(!this._ctx) return;
    if(this._sfxGain) this._sfxGain.gain.value = this._sfxEnabled ? this._sfxVol : 0;
    if(this._musicGain) this._musicGain.gain.value = this._musicEnabled ? this._musicVol : 0;
  }

  /* ---------------- config helpers ---------------- */

  _sfxUrl(key){
    const file = this.cfg.sfx?.[key];
    if(!file) return null;
    return this.paths.sfxBase + file;
  }

  _musicUrl(key){
    const file = this.cfg.music?.[key];
    if(!file) return null;
    return this.paths.musicBase + file;
  }

  _timeToMin(hhmm){
    const [h,m] = String(hhmm).split(":").map(n=>parseInt(n,10));
    return (h*60)+(m||0);
  }

  _autoKeyForTime(now){
    const slots = (this._auto?.slots || []).slice().map(s=>({
      startMin: this._timeToMin(s.start),
      key: s.key
    })).sort((a,b)=>a.startMin-b.startMin);

    if(!slots.length) return null;

    const t = now.getHours()*60 + now.getMinutes();
    let pick = slots[0];
    for(const s of slots){
      if(t >= s.startMin) pick = s;
    }
    return pick.key;
  }

  /* ---------------- SFX ---------------- */

  async playSfx(key, { volume=1.0 } = {}){
    if(!this._sfxEnabled) return;
    if(!this._unlocked) return; // must be unlocked by user gesture
    if(!this._ctx || !this._sfxGain) return;

    const url = this._sfxUrl(key);
    if(!url) return;

    const buf = await this._loadBuffer(key, url);
    if(!buf) return;

    const src = this._ctx.createBufferSource();
    src.buffer = buf;

    const g = this._ctx.createGain();
    g.gain.value = clamp01(volume);

    src.connect(g);
    g.connect(this._sfxGain);
    src.start(0);
  }

  async playLoop(key, { volume=1.0, fadeSec=0.6 } = {}){
    if(!this._sfxEnabled) return;
    if(!this._unlocked) return;
    if(!this._ctx || !this._sfxGain) return;
    if(this._loopNodes.has(key)) return; // already playing

    const url = this._sfxUrl(key);
    if(!url) return;

    const buf = await this._loadBuffer(key, url);
    if(!buf) return;

    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const g = this._ctx.createGain();
    g.gain.value = 0;

    src.connect(g);
    g.connect(this._sfxGain);

    src.start(0);

    this._loopNodes.set(key, { src, gain: g });

    // fade in
    const target = clamp01(volume);
    const now = this._ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(target, now + Math.max(0.01, fadeSec));
  }

  stopLoop(key, { fadeSec=0.4 } = {}){
    if(!this._ctx) {
      this._loopNodes.delete(key);
      return;
    }
    const node = this._loopNodes.get(key);
    if(!node) return;

    const now = this._ctx.currentTime;
    const g = node.gain;

    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + Math.max(0.01, fadeSec));

    setTimeout(()=>{
      try{ node.src.stop(); }catch(_){}
      try{ node.src.disconnect(); }catch(_){}
      try{ node.gain.disconnect(); }catch(_){}
      this._loopNodes.delete(key);
    }, (fadeSec*1000)+120);
  }

  /* ---------------- MUSIC ---------------- */

  async playMusic(key, { fadeSec=1.2 } = {}){
    if(!this._musicEnabled) return;
    if(!this._unlocked) return;
    if(!this._ctx || !this._musicGain) return;

    if(this._musicKey === key) return;

    const url = this._musicUrl(key);
    if(!url) return;

    const buf = await this._loadBuffer("music:"+key, url);
    if(!buf) return;

    // pick next player
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const g = this._ctx.createGain();
    g.gain.value = 0;

    src.connect(g);
    g.connect(this._musicGain);

    src.start(0);

    // crossfade A<->B
    const now = this._ctx.currentTime;
    const dur = Math.max(0.01, fadeSec);

    const old = this._musicIsA ? this._musicA : this._musicB;
    const oldKey = this._musicKey;

    // set new
    if(this._musicIsA){
      this._musicB = { src, gain: g, key };
    }else{
      this._musicA = { src, gain: g, key };
    }
    this._musicIsA = !this._musicIsA;
    this._musicKey = key;

    // fade in new
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + dur);

    // fade out old then stop
    if(old?.gain){
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + dur);

      setTimeout(()=>{
        try{ old.src.stop(); }catch(_){}
        try{ old.src.disconnect(); }catch(_){}
        try{ old.gain.disconnect(); }catch(_){}
      }, (dur*1000)+120);
    }
  }

  async stopMusic({ fadeSec=0.6 } = {}){
    if(!this._ctx) return;
    const now = this._ctx.currentTime;
    const dur = Math.max(0.01, fadeSec);

    const a = this._musicA;
    const b = this._musicB;

    for(const m of [a,b]){
      if(!m?.gain) continue;
      m.gain.gain.cancelScheduledValues(now);
      m.gain.gain.setValueAtTime(m.gain.gain.value, now);
      m.gain.gain.linearRampToValueAtTime(0, now + dur);
      setTimeout(()=>{
        try{ m.src.stop(); }catch(_){}
        try{ m.src.disconnect(); }catch(_){}
        try{ m.gain.disconnect(); }catch(_){}
      }, (dur*1000)+120);
    }

    this._musicA = null;
    this._musicB = null;
    this._musicKey = null;
  }

  /* ---------------- STORY + AUTO ---------------- */

  // called from main each tick with current state
  async applyStoryState(now, state){
    // 1) Rain audio follows cloudProfile overcast (auto-link)
    const profile = state?.cloudProfile || "none";
    const shouldRain = (profile === "overcast");
    if(shouldRain !== this._rainActive){
      this._rainActive = shouldRain;
      if(this._sfxEnabled && this._unlocked){
        if(shouldRain) this.playLoop("rain_loop", { fadeSec: 1.0 });
        else this.stopLoop("rain_loop", { fadeSec: 1.0 });
      }
    }

    // 2) Music override via state.audio.musicTrack
    const musicTrack = state?.audio?.musicTrack;
    if(typeof musicTrack !== "undefined"){
      // string => force, null => release to auto
      this._storyMusicOverride = musicTrack;
    }

    // 3) Auto/override apply
    if(this._musicEnabled && this._unlocked){
      await this._applyDesiredMusic(now);
    }
  }

  async _applyDesiredMusic(now){
    // decide desired key
    let desired = null;

    if(typeof this._storyMusicOverride === "string"){
      desired = this._storyMusicOverride;
    }else{
      // release to auto OR no instruction
      if(this._auto?.enabled === false) desired = null;
      else desired = this._autoKeyForTime(now);
    }

    if(!desired){
      // no music desired
      if(this._musicKey) await this.stopMusic({ fadeSec: 0.8 });
      return;
    }

    // play desired
    await this.playMusic(desired, { fadeSec: this.cfg.defaults?.musicFadeSec ?? 1.2 });
  }

  /* ---------------- buffer cache ---------------- */

  async _loadBuffer(cacheKey, url){
    if(this._buffers.has(cacheKey)) return this._buffers.get(cacheKey);

    try{
      const res = await fetch(url, { cache: "force-cache" });
      if(!res.ok) return null;
      const arr = await res.arrayBuffer();
      const buf = await this._ctx.decodeAudioData(arr);
      this._buffers.set(cacheKey, buf);
      return buf;
    }catch(_){
      return null;
    }
  }
}
