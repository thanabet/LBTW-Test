// src/audio/audioManager.js
// iOS-stable version:
// - SFX uses WebAudio (buffers) ✅
// - MUSIC uses ONE HTMLAudio element (streaming) ✅
//   - fade out -> swap src -> play -> fade in
// Fixes:
// - "เปิดรอบสองแล้วเงียบ" (iOS dual-audio/crossfade bug)
// - UI lies (enabled but silent): toggleMusic returns false if playback didn't actually start

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function waitEvent(el, evt, timeoutMs = 2000){
  return new Promise((resolve) => {
    let done = false;
    const on = () => {
      if(done) return;
      done = true;
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      el.removeEventListener(evt, on);
      if(tid) clearTimeout(tid);
    };
    el.addEventListener(evt, on, { once: true });
    const tid = setTimeout(() => {
      if(done) return;
      done = true;
      cleanup();
      resolve(false);
    }, timeoutMs);
  });
}

export class AudioManager {
  constructor(config){
    this.cfg = config || {};
    this.paths = {
      sfxBase:  this.cfg.sfxBasePath  || "assets/audio/sfx/",
      musicBase:this.cfg.musicBasePath|| "assets/audio/music/"
    };

    // enabled flags
    this._sfxEnabled = false;
    this._musicEnabled = false;

    // unlock flags
    this._unlockedSfx = false;
    this._unlockedMusic = false;

    // volumes
    this._musicVol = clamp01(this.cfg.defaults?.musicVolume ?? 0.55);
    this._sfxVol   = clamp01(this.cfg.defaults?.sfxVolume ?? 1.0);

    this._musicFadeSec = Math.max(0.01, Number(this.cfg.defaults?.musicFadeSec ?? 1.2));

    // WebAudio for SFX
    this._ctx = null;
    this._sfxGain = null;
    this._buffers = new Map();
    this._loopNodes = new Map();

    // ONE HTMLAudio for Music (most stable on iOS)
    this._musicEl = new Audio();
    this._musicEl.loop = true;
    this._musicEl.preload = "auto";
    this._musicEl.crossOrigin = "anonymous";
    this._musicEl.volume = 0;
    this._musicEl.muted = false;
    this._musicEl.playsInline = true;

    this._musicKey = null;
    this._musicToggleLock = false;

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

    // Story override: undefined=no instruction, null=release to auto, string=forced
    this._storyMusicOverride = undefined;

    // rain follow cloudProfile
    this._rainActive = false;
  }

  isSfxEnabled(){ return this._sfxEnabled; }
  isMusicEnabled(){ return this._musicEnabled; }

  /* ---------------- unlock SFX (WebAudio) ---------------- */

  async _ensureSfxUnlocked(){
    if(this._unlockedSfx) return true;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) {
      this._unlockedSfx = true;
      return true;
    }

    this._ctx = new AudioCtx();
    this._sfxGain = this._ctx.createGain();
    this._sfxGain.gain.value = this._sfxEnabled ? this._sfxVol : 0;
    this._sfxGain.connect(this._ctx.destination);

    if(this._ctx.state === "suspended"){
      try { await this._ctx.resume(); } catch(_) {}
    }

    // tiny silent blip (iOS unlock helper)
    try{
      const buf = this._ctx.createBuffer(1, 1, 22050);
      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this._ctx.destination);
      src.start(0);
    }catch(_){}

    this._unlockedSfx = true;
    return true;
  }

  /* ---------------- unlock MUSIC (HTMLAudio) ---------------- */

  async _ensureMusicUnlocked(){
    // With single HTMLAudio, "unlock" basically means: a play() succeeded at least once in a user gesture.
    if(this._unlockedMusic) return true;

    try{
      // If no src yet, we can't test. We'll allow first real play attempt to set unlocked.
      this._unlockedMusic = true;
      return true;
    }catch(_){
      this._unlockedMusic = false;
      return false;
    }
  }

  /* ---------------- toggles ---------------- */

  async toggleSfx(){
    this._sfxEnabled = !this._sfxEnabled;

    if(this._sfxEnabled){
      await this._ensureSfxUnlocked();
    }
    if(this._sfxGain){
      this._sfxGain.gain.value = this._sfxEnabled ? this._sfxVol : 0;
    }

    if(!this._sfxEnabled){
      this.stopLoop("rain_loop");
    } else {
      if(this._rainActive) this.playLoop("rain_loop", { fadeSec: 0.6 });
    }

    return this._sfxEnabled;
  }

  async toggleMusic(){
    if(this._musicToggleLock) return this._musicEnabled;
    this._musicToggleLock = true;

    try{
      const next = !this._musicEnabled;

      if(next){
        this._musicEnabled = true;
        await this._ensureMusicUnlocked();

        // try to start desired music
        const ok = await this._applyDesiredMusic(new Date(), { forcePlay: true });

        if(!ok){
          // if actually didn't start, revert to OFF so HUD slash stays correct
          this._musicEnabled = false;
          await this.stopMusic({ fadeSec: 0.15 });
          return false;
        }

        return true;
      } else {
        this._musicEnabled = false;
        await this.stopMusic({ fadeSec: 0.25 });
        return false;
      }
    } finally {
      setTimeout(()=>{ this._musicToggleLock = false; }, 450);
    }
  }

  /* ---------------- url helpers ---------------- */

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

  async playSfx(key, { volume=1.0 } = {}){
    if(!this._sfxEnabled) return;
    if(!this._unlockedSfx) return;
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
    if(!this._unlockedSfx) return;
    if(!this._ctx || !this._sfxGain) return;
    if(this._loopNodes.has(key)) return;

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

    const target = clamp01(volume);
    const now = this._ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(target, now + Math.max(0.01, fadeSec));
  }

  stopLoop(key, { fadeSec=0.4 } = {}){
    if(!this._ctx){
      this._loopNodes.delete(key);
      return;
    }
    const node = this._loopNodes.get(key);
    if(!node) return;

    const now = this._ctx.currentTime;
    const g = node.gain;
    const dur = Math.max(0.01, fadeSec);

    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + dur);

    setTimeout(()=>{
      try{ node.src.stop(); }catch(_){}
      try{ node.src.disconnect(); }catch(_){}
      try{ node.gain.disconnect(); }catch(_){}
      this._loopNodes.delete(key);
    }, (dur*1000)+120);
  }

  /* ---------------- MUSIC (single HTMLAudio) ---------------- */

  async playMusic(key, { fadeSec=1.2 } = {}){
    if(!this._musicEnabled) return false;

    if(this._musicKey === key && !this._musicEl.paused){
      // already playing desired
      return true;
    }

    const url = this._musicUrl(key);
    if(!url) return false;

    const dur = Math.max(0.01, fadeSec);

    // fade out if something is playing
    if(!this._musicEl.paused && this._musicEl.volume > 0.001){
      await this._fadeTo(this._musicEl, 0, dur);
      try{ this._musicEl.pause(); }catch(_){}
    }

    // swap track
    try{
      this._musicEl.src = url;
      this._musicEl.loop = true;
      this._musicEl.preload = "auto";
      this._musicEl.volume = 0;
      try{ this._musicEl.load(); }catch(_){}
    }catch(_){
      return false;
    }

    // wait ready (avoid silent play on iOS)
    await waitEvent(this._musicEl, "canplay", 2200);

    // play (this is where iOS may block if not in user gesture)
    try{
      const p = this._musicEl.play();
      if(p && typeof p.then === "function") await p;
      this._unlockedMusic = true;
    }catch(_){
      return false;
    }

    // wait real start (best effort)
    await waitEvent(this._musicEl, "playing", 1200);

    // fade in
    await this._fadeTo(this._musicEl, this._musicVol, dur);

    this._musicKey = key;
    return true;
  }

  async stopMusic({ fadeSec=0.6 } = {}){
    const dur = Math.max(0.01, fadeSec);

    await this._fadeTo(this._musicEl, 0, dur);

    try{ this._musicEl.pause(); }catch(_){}
    try{ this._musicEl.currentTime = 0; }catch(_){}

    this._musicKey = null;
  }

  _fadeTo(audioEl, target, sec){
    return new Promise((resolve)=>{
      const startVol = audioEl.volume;
      const endVol = clamp01(target);
      const durMs = sec * 1000;
      const t0 = performance.now();

      const step = (t)=>{
        const k = Math.min(1, (t - t0) / durMs);
        audioEl.volume = startVol + (endVol - startVol) * k;
        if(k >= 1) return resolve();
        requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    });
  }

  /* ---------------- STORY + AUTO ---------------- */

  async applyStoryState(now, state){
    // Rain audio follows cloudProfile overcast
    const profile = state?.cloudProfile || "none";
    const shouldRain = (profile === "overcast");

    if(shouldRain !== this._rainActive){
      this._rainActive = shouldRain;
      if(this._sfxEnabled && this._unlockedSfx){
        if(shouldRain) this.playLoop("rain_loop", { fadeSec: 1.0 });
        else this.stopLoop("rain_loop", { fadeSec: 1.0 });
      }
    }

    // Music override
    const musicTrack = state?.audio?.musicTrack;
    if(typeof musicTrack !== "undefined"){
      this._storyMusicOverride = musicTrack; // string or null
    }

    // Apply desired music
    if(this._musicEnabled){
      // don't spam play calls if music is locked; user gesture will fix
      await this._applyDesiredMusic(now);
    }
  }

  async _applyDesiredMusic(now){
    let desired = null;

    if(typeof this._storyMusicOverride === "string"){
      desired = this._storyMusicOverride;
    } else {
      if(this._auto?.enabled === false) desired = null;
      else desired = this._autoKeyForTime(now);
    }

    if(!desired){
      if(this._musicKey) await this.stopMusic({ fadeSec: 0.8 });
      return false;
    }

    if(desired !== this._musicKey){
      return await this.playMusic(desired, { fadeSec: this._musicFadeSec });
    }

    // ensure volume if somehow drifted
    if(!this._musicEl.paused && this._musicEl.volume < (this._musicVol * 0.8)){
      this._musicEl.volume = this._musicVol;
    }

    return true;
  }
}
