// src/audio/audioManager.js
// Best practical iOS behavior:
// - SFX: WebAudio (fast, overlaps, loops) ✅
// - MUSIC: HTMLAudio keep-alive (never pause on toggle; just fade volume) ✅
//   => avoids stutter + avoids re-buffer/decode every toggle

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function once(el, evt, timeoutMs = 2000){
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
    this._musicFadeSec = Math.max(0.01, Number(this.cfg.defaults?.musicFadeSec ?? 1.0));

    // WebAudio for SFX
    this._ctx = null;
    this._sfxGain = null;
    this._buffers = new Map();
    this._loopNodes = new Map();

    // HTMLAudio for Music (keep-alive)
    this._musicEl = new Audio();
    this._musicEl.loop = true;
    this._musicEl.preload = "auto";
    this._musicEl.crossOrigin = "anonymous";
    this._musicEl.volume = 0;      // start silent
    this._musicEl.muted = false;
    this._musicEl.playsInline = true;

    this._musicKey = null;
    this._musicIsPlaying = false;  // actual play state
    this._musicToggleLock = false;
    this._musicSwapLock = false;

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

    // Story override
    this._storyMusicOverride = undefined;

    // rain follow cloudProfile overcast
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

    // tiny silent blip
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
    if(this._unlockedMusic) return true;

    // Needs user gesture. We'll mark unlocked after first successful play().
    // (We don't play here unless we already have a track set.)
    this._unlockedMusic = true;
    return true;
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
      this._musicEnabled = next;

      if(next){
        await this._ensureMusicUnlocked();
        const ok = await this._applyDesiredMusic(new Date(), { forcePlay: true });
        if(!ok){
          // failed to start -> revert so HUD slash stays honest
          this._musicEnabled = false;
          await this._fadeMusicTo(0, 0.15);
          return false;
        }
        // enabled and playing silently already; now fade up
        await this._fadeMusicTo(this._musicVol, 0.35);
        return true;
      } else {
        // IMPORTANT: keep-alive: do NOT pause, just fade to 0
        await this._fadeMusicTo(0, 0.25);
        return false;
      }
    } finally {
      setTimeout(()=>{ this._musicToggleLock = false; }, 350);
    }
  }

  /* ---------------- URL helpers ---------------- */

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

  /* ---------------- MUSIC (keep-alive HTMLAudio) ---------------- */

  async _fadeMusicTo(target, sec){
    const endVol = clamp01(target);
    const startVol = this._musicEl.volume;
    const durMs = Math.max(10, sec*1000);
    const t0 = performance.now();

    return new Promise((resolve)=>{
      const step = (t)=>{
        const k = Math.min(1, (t - t0) / durMs);
        this._musicEl.volume = startVol + (endVol - startVol) * k;
        if(k >= 1) return resolve();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  async _ensureMusicPlaying(url){
    // Already playing this track
    if(this._musicIsPlaying && this._musicEl.src && this._musicEl.src.includes(url)) return true;

    // Prevent concurrent swaps
    if(this._musicSwapLock) return true;
    this._musicSwapLock = true;

    try{
      // If currently playing something else: fade down first but keep alive
      await this._fadeMusicTo(0, 0.20);

      // swap src
      this._musicEl.pause(); // pause only during swap (short), then play again
      this._musicEl.src = url;
      this._musicEl.loop = true;
      this._musicEl.preload = "auto";
      this._musicEl.volume = 0;

      try{ this._musicEl.load(); }catch(_){}

      await once(this._musicEl, "canplay", 2200);

      try{
        const p = this._musicEl.play();
        if(p && typeof p.then === "function") await p;
      }catch(_){
        return false;
      }

      await once(this._musicEl, "playing", 1200);

      this._musicIsPlaying = true;
      return true;
    } finally {
      this._musicSwapLock = false;
    }
  }

  async playMusic(key){
    if(!this._musicEnabled) return false;

    const url = this._musicUrl(key);
    if(!url) return false;

    const ok = await this._ensureMusicPlaying(url);
    if(!ok) return false;

    this._musicKey = key;

    // If enabled, we fade up elsewhere; but safe guard:
    if(this._musicEnabled && this._musicEl.volume < this._musicVol*0.5){
      await this._fadeMusicTo(this._musicVol, 0.35);
    }

    return true;
  }

  async stopMusic(){
    // keep-alive: never fully stop unless you really want to
    await this._fadeMusicTo(0, 0.25);
    this._musicKey = null;
    return true;
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

    // Apply desired music (only if enabled)
    if(this._musicEnabled){
      await this._applyDesiredMusic(now, { forcePlay: false });
    }
  }

  async _applyDesiredMusic(now, { forcePlay=false } = {}){
    let desired = null;

    if(typeof this._storyMusicOverride === "string"){
      desired = this._storyMusicOverride;
    } else {
      if(this._auto?.enabled === false) desired = null;
      else desired = this._autoKeyForTime(now);
    }

    if(!desired){
      await this.stopMusic();
      return true;
    }

    if(forcePlay || desired !== this._musicKey){
      const ok = await this.playMusic(desired);
      if(!ok) return false;

      // fade target based on enabled state
      if(this._musicEnabled) await this._fadeMusicTo(this._musicVol, this._musicFadeSec);
      return true;
    }

    return true;
  }
}