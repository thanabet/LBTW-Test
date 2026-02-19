// src/audio/audioManager.js
// iOS-stable: SFX + MUSIC in ONE WebAudio AudioContext
// - Avoids HTMLAudio/WebAudio route switching (the "play blip then pause then resume" symptom)
// - Music is short (<= 5 min) => buffer+loop is fine
// Interface kept:
//  - toggleSfx() -> boolean
//  - toggleMusic() -> boolean
//  - isSfxEnabled(), isMusicEnabled()
//  - playSfx(key), playLoop(key), stopLoop(key)
//  - applyStoryState(now, state)

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

export class AudioManager {
  constructor(config){
    this.cfg = config || {};
    this.paths = {
      sfxBase:  this.cfg.sfxBasePath  || "assets/audio/sfx/",
      musicBase:this.cfg.musicBasePath|| "assets/audio/music/"
    };

    // enabled flags (UI state)
    this._sfxEnabled = false;
    this._musicEnabled = false;

    // unlock / init flags
    this._ctx = null;
    this._masterGain = null;
    this._sfxGain = null;
    this._musicGain = null;
    this._initialized = false;

    // volumes
    this._musicVol = clamp01(this.cfg.defaults?.musicVolume ?? 0.55);
    this._sfxVol   = clamp01(this.cfg.defaults?.sfxVolume ?? 1.0);
    this._musicFadeSec = Math.max(0.01, Number(this.cfg.defaults?.musicFadeSec ?? 1.2));

    // buffers
    this._sfxBuffers = new Map();   // key -> AudioBuffer
    this._musicBuffers = new Map(); // key -> AudioBuffer

    // loops (SFX loops like rain)
    this._loopNodes = new Map(); // key -> { src, gain }

    // music source
    this._musicKey = null;
    this._musicSrc = null;

    // toggle lock (prevents double taps racing)
    this._toggleMusicLock = false;

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

  /* ---------------- internal init/unlock ---------------- */

  async _ensureAudioContext(){
    if(this._initialized && this._ctx) return true;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) return false;

    this._ctx = new AudioCtx();

    // master -> destination
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = 1.0;
    this._masterGain.connect(this._ctx.destination);

    // sfx + music buses
    this._sfxGain = this._ctx.createGain();
    this._sfxGain.gain.value = this._sfxEnabled ? this._sfxVol : 0;

    this._musicGain = this._ctx.createGain();
    this._musicGain.gain.value = 0; // start silent (must tap to enable)

    this._sfxGain.connect(this._masterGain);
    this._musicGain.connect(this._masterGain);

    // resume on iOS (must be called from user gesture)
    if(this._ctx.state === "suspended"){
      try { await this._ctx.resume(); } catch(_){}
    }

    // tiny blip to hard-unlock some iOS versions
    try{
      const buf = this._ctx.createBuffer(1, 1, 22050);
      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this._ctx.destination);
      src.start(0);
    }catch(_){}

    this._initialized = true;
    return true;
  }

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

  async _fetchDecode(url){
    const res = await fetch(url, { cache: "force-cache" });
    if(!res.ok) return null;
    const arr = await res.arrayBuffer();
    return await this._ctx.decodeAudioData(arr);
  }

  async _getSfxBuffer(key){
    if(this._sfxBuffers.has(key)) return this._sfxBuffers.get(key);
    const url = this._sfxUrl(key);
    if(!url) return null;
    try{
      const buf = await this._fetchDecode(url);
      if(!buf) return null;
      this._sfxBuffers.set(key, buf);
      return buf;
    }catch(_){
      return null;
    }
  }

  async _getMusicBuffer(key){
    if(this._musicBuffers.has(key)) return this._musicBuffers.get(key);
    const url = this._musicUrl(key);
    if(!url) return null;
    try{
      const buf = await this._fetchDecode(url);
      if(!buf) return null;
      this._musicBuffers.set(key, buf);
      return buf;
    }catch(_){
      return null;
    }
  }

  /* ---------------- fades (WebAudio) ---------------- */

  _fadeGain(gainNode, toValue, sec){
    if(!this._ctx || !gainNode) return;
    const now = this._ctx.currentTime;
    const dur = Math.max(0.01, sec);
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(toValue, now + dur);
  }

  /* ---------------- toggles ---------------- */

  async toggleSfx(){
    // must be inside user gesture at least once
    const ok = await this._ensureAudioContext();
    if(!ok) return this._sfxEnabled;

    this._sfxEnabled = !this._sfxEnabled;
    this._sfxGain.gain.value = this._sfxEnabled ? this._sfxVol : 0;

    // if turning off, stop loops
    if(!this._sfxEnabled){
      this.stopLoop("rain_loop", { fadeSec: 0.25 });
    } else {
      // if rain should be active, restart loop gently
      if(this._rainActive){
        await this.playLoop("rain_loop", { fadeSec: 0.6 });
      }
    }

    return this._sfxEnabled;
  }

  async toggleMusic(){
    if(this._toggleMusicLock) return this._musicEnabled;
    this._toggleMusicLock = true;

    try{
      const ok = await this._ensureAudioContext();
      if(!ok) return this._musicEnabled;

      const next = !this._musicEnabled;

      if(next){
        this._musicEnabled = true;

        // pick desired track then start it
        const started = await this._applyDesiredMusic(new Date(), { force: true });

        if(!started){
          // if failed, revert to OFF so UI slash stays correct
          this._musicEnabled = false;
          this._fadeGain(this._musicGain, 0, 0.15);
          this._stopMusicSource();
          return false;
        }

        return true;
      } else {
        this._musicEnabled = false;
        await this.stopMusic({ fadeSec: 0.25 });
        return false;
      }
    } finally {
      setTimeout(()=>{ this._toggleMusicLock = false; }, 450);
    }
  }

  /* ---------------- SFX ---------------- */

  async playSfx(key, { volume=1.0 } = {}){
    if(!this._sfxEnabled) return;
    const ok = await this._ensureAudioContext();
    if(!ok) return;

    const buf = await this._getSfxBuffer(key);
    if(!buf) return;

    const src = this._ctx.createBufferSource();
    src.buffer = buf;

    const g = this._ctx.createGain();
    g.gain.value = clamp01(volume);

    src.connect(g);
    g.connect(this._sfxGain);

    try{ src.start(0); }catch(_){}
  }

  async playLoop(key, { volume=1.0, fadeSec=0.6 } = {}){
    if(!this._sfxEnabled) return;
    const ok = await this._ensureAudioContext();
    if(!ok) return;

    if(this._loopNodes.has(key)) return;

    const buf = await this._getSfxBuffer(key);
    if(!buf) return;

    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const g = this._ctx.createGain();
    g.gain.value = 0;

    src.connect(g);
    g.connect(this._sfxGain);

    try{ src.start(0); }catch(_){}

    this._loopNodes.set(key, { src, gain: g });

    const target = clamp01(volume);
    this._fadeGain(g, target, fadeSec);
  }

  stopLoop(key, { fadeSec=0.4 } = {}){
    if(!this._ctx) {
      this._loopNodes.delete(key);
      return;
    }
    const node = this._loopNodes.get(key);
    if(!node) return;

    const dur = Math.max(0.01, fadeSec);
    this._fadeGain(node.gain, 0, dur);

    setTimeout(()=>{
      try{ node.src.stop(); }catch(_){}
      try{ node.src.disconnect(); }catch(_){}
      try{ node.gain.disconnect(); }catch(_){}
      this._loopNodes.delete(key);
    }, (dur*1000) + 120);
  }

  /* ---------------- MUSIC (WebAudio loop) ---------------- */

  _stopMusicSource(){
    if(this._musicSrc){
      try{ this._musicSrc.stop(); }catch(_){}
      try{ this._musicSrc.disconnect(); }catch(_){}
      this._musicSrc = null;
    }
    this._musicKey = null;
  }

  async playMusic(key, { fadeSec=1.2 } = {}){
    if(!this._musicEnabled) return false;
    const ok = await this._ensureAudioContext();
    if(!ok) return false;

    if(this._musicKey === key && this._musicSrc){
      // ensure volume
      this._fadeGain(this._musicGain, this._musicVol, Math.min(0.2, fadeSec));
      return true;
    }

    const buf = await this._getMusicBuffer(key);
    if(!buf) return false;

    // fade out old
    const outDur = Math.max(0.01, fadeSec);
    if(this._musicSrc){
      this._fadeGain(this._musicGain, 0, outDur);
      await new Promise(r => setTimeout(r, outDur*1000 + 60));
      this._stopMusicSource();
    }

    // create new loop source
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this._musicGain);

    this._musicSrc = src;
    this._musicKey = key;

    // start + fade in
    this._musicGain.gain.value = 0;
    try{ src.start(0); }catch(_){ return false; }

    this._fadeGain(this._musicGain, this._musicVol, outDur);
    return true;
  }

  async stopMusic({ fadeSec=0.6 } = {}){
    if(!this._ctx) return;

    const dur = Math.max(0.01, fadeSec);
    this._fadeGain(this._musicGain, 0, dur);
    await new Promise(r => setTimeout(r, dur*1000 + 60));
    this._stopMusicSource();
  }

  /* ---------------- STORY + AUTO ---------------- */

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

  async applyStoryState(now, state){
    // Rain audio follows cloudProfile overcast
    const profile = state?.cloudProfile || "none";
    const shouldRain = (profile === "overcast");

    if(shouldRain !== this._rainActive){
      this._rainActive = shouldRain;

      if(this._sfxEnabled){
        if(shouldRain) await this.playLoop("rain_loop", { fadeSec: 1.0 });
        else this.stopLoop("rain_loop", { fadeSec: 1.0 });
      }
    }

    // Music override from story
    const musicTrack = state?.audio?.musicTrack;
    if(typeof musicTrack !== "undefined"){
      this._storyMusicOverride = musicTrack; // string or null
    }

    if(this._musicEnabled){
      await this._applyDesiredMusic(now, { force: false });
    }
  }

  async _applyDesiredMusic(now, { force=false } = {}){
    let desired = null;

    if(typeof this._storyMusicOverride === "string"){
      desired = this._storyMusicOverride;
    } else {
      if(this._auto?.enabled === false) desired = null;
      else desired = this._autoKeyForTime(now);
    }

    if(!desired){
      if(this._musicSrc) await this.stopMusic({ fadeSec: 0.8 });
      return false;
    }

    if(force || desired !== this._musicKey){
      return await this.playMusic(desired, { fadeSec: this._musicFadeSec });
    }

    return true;
  }
}
