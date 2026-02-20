// src/audio/audioManager.js
// SFX: WebAudio
// MUSIC: HTMLAudio
// FIX: UI slash updates instantly (no wait for async start)

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

    this._sfxEnabled = false;
    this._musicEnabled = false;

    this._unlockedSfx = false;
    this._unlockedMusic = false;

    this._musicVol = clamp01(this.cfg.defaults?.musicVolume ?? 0.55);
    this._sfxVol   = clamp01(this.cfg.defaults?.sfxVolume ?? 1.0);
    this._musicFadeSec = Math.max(0.01, Number(this.cfg.defaults?.musicFadeSec ?? 1.0));

    this._ctx = null;
    this._sfxGain = null;
    this._buffers = new Map();
    this._loopNodes = new Map();

    this._musicEl = new Audio();
    this._musicEl.loop = true;
    this._musicEl.preload = "auto";
    this._musicEl.crossOrigin = "anonymous";
    this._musicEl.volume = 0;
    this._musicEl.playsInline = true;

    this._musicKey = null;
    this._musicSwapLock = false;
    this._musicToggleLock = false;

    this._fadeToken = 0;
    this._rafId = null;

    this._auto = this.cfg.autoMusic || { enabled: true, slots: [] };
    this._storyMusicOverride = undefined;
  }

  isSfxEnabled(){ return this._sfxEnabled; }
  isMusicEnabled(){ return this._musicEnabled; }

  /* ========================= TOGGLE MUSIC ========================= */

  async toggleMusic(){
    if(this._musicToggleLock) return this._musicEnabled;
    this._musicToggleLock = true;

    const wantOn = !this._musicEnabled;

    // ---- IMPORTANT CHANGE ----
    // Commit state immediately for UI responsiveness
    this._musicEnabled = wantOn;

    if(wantOn){
      // Start async but DO NOT wait before returning
      this._startMusicAsync();
      this._musicToggleLock = false;
      return true;
    } else {
      // Fade down + pause immediately
      this._stopMusicAsync();
      this._musicToggleLock = false;
      return false;
    }
  }

  async _startMusicAsync(){
    try{
      const desired = this._getDesiredMusic(new Date());
      if(!desired) return;

      const url = this._musicUrl(desired);
      if(!url) return;

      if(this._musicEl.src !== location.origin + "/" + url){
        this._musicEl.src = url;
        this._musicEl.load();
        await once(this._musicEl, "canplay", 2000);
      }

      await this._musicEl.play();
      this._musicKey = desired;

      await this._fadeMusicTo(this._musicVol, 0.35);
    }catch(err){
      console.warn("Music start failed:", err);
      // revert state if play truly failed
      this._musicEnabled = false;
    }
  }

  async _stopMusicAsync(){
    await this._fadeMusicTo(0, 0.25);
    try{ this._musicEl.pause(); }catch(_){}
  }

  /* ========================= FADE ========================= */

  _fadeMusicTo(target, sec){
    const endVol = clamp01(target);
    const startVol = this._musicEl.volume;
    const durMs = Math.max(10, sec*1000);
    const t0 = performance.now();
    const token = ++this._fadeToken;

    if(this._rafId){
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    return new Promise((resolve)=>{
      const step = (t)=>{
        if(token !== this._fadeToken) return resolve();
        const k = Math.min(1, (t - t0) / durMs);
        this._musicEl.volume = startVol + (endVol - startVol) * k;
        if(k >= 1){
          this._rafId = null;
          return resolve();
        }
        this._rafId = requestAnimationFrame(step);
      };
      this._rafId = requestAnimationFrame(step);
    });
  }

  /* ========================= AUTO MUSIC ========================= */

  _getDesiredMusic(now){
    if(typeof this._storyMusicOverride === "string"){
      return this._storyMusicOverride;
    }
    if(!this._auto?.enabled) return null;

    const slots = (this._auto.slots || []).slice();
    if(!slots.length) return null;

    const t = now.getHours()*60 + now.getMinutes();
    let pick = slots[0];
    for(const s of slots){
      const [h,m] = s.start.split(":").map(Number);
      const min = h*60 + m;
      if(t >= min) pick = s;
    }
    return pick.key;
  }

  _musicUrl(key){
    const file = this.cfg.music?.[key];
    if(!file) return null;
    return this.paths.musicBase + file;
  }
}