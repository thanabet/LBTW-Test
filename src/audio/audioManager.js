// src/audio/audioManager.js
// Stable + iOS-friendly:
// - SFX uses WebAudio (buffers)
// - MUSIC uses HTMLAudio streaming (no heavy decode)
// Fixes:
// - iOS: play() may "succeed" but not actually playing yet -> wait for canplay/playing BEFORE crossfade
// - add toggle lock to prevent rapid re-entry messing state
// - robust fade helpers

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function once(el, evt, timeoutMs = 2000){
  return new Promise((resolve, reject) => {
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
      // don't hard fail; just continue
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

    // unlock flags
    this._unlockedSfx = false;
    this._unlockedMusic = false;

    // enabled flags
    this._sfxEnabled = false;
    this._musicEnabled = false;

    // volumes
    this._musicVol = clamp01(this.cfg.defaults?.musicVolume ?? 0.55);
    this._sfxVol   = clamp01(this.cfg.defaults?.sfxVolume ?? 1.0);

    // WebAudio for SFX
    this._ctx = null;
    this._sfxGain = null;
    this._buffers = new Map();
    this._loopNodes = new Map();

    // HTMLAudio for Music (two players for crossfade)
    this._musicA = new Audio();
    this._musicB = new Audio();
    for (const a of [this._musicA, this._musicB]) {
      a.loop = true;
      a.preload = "auto";
      a.crossOrigin = "anonymous";
      a.volume = 0;
      a.muted = false;
      // iOS hint
      a.playsInline = true;
    }
    this._musicIsA = true;
    this._musicKey = null;

    // toggle lock (prevents “กดรัวแล้ว state เพี้ยน”)
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

    // fade default
    this._musicFadeSec = Math.max(0.01, Number(this.cfg.defaults?.musicFadeSec ?? 1.2));
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

    // tiny silent blip to fully unlock some iOS versions
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

    // Must be inside a user gesture (HUD tap). We'll attempt a play() on current src if exists.
    const a = this._musicA;
    try{
      // If no src yet, just mark as not unlocked; unlock will be confirmed when first real play happens.
      if(!a.src){
        this._unlockedMusic = true; // allow first real play attempt
        return true;
      }

      a.volume = 0;
      const p = a.play();
      if(p && typeof p.then === "function"){
        await p;
      }
      a.pause();
      this._unlockedMusic = true;
    }catch(_){
      this._unlockedMusic = false;
    }
    return this._unlockedMusic;
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
    // prevent re-entry (double tap / iOS quirks)
    if(this._musicToggleLock) return this._musicEnabled;
    this._musicToggleLock = true;

    try{
      this._musicEnabled = !this._musicEnabled;

      if(this._musicEnabled){
        await this._ensureMusicUnlocked();
        // apply desired (auto/override)
        await this._applyDesiredMusic(new Date(), { forcePlay: true });
      } else {
        await this.stopMusic({ fadeSec: 0.25 });
      }

      return this._musicEnabled;
    } finally {
      // unlock after a short window
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

  /* ---------------- MUSIC (HTMLAudio streaming) ---------------- */

  async playMusic(key, { fadeSec=1.2, forcePlay=false } = {}){
    if(!this._musicEnabled) return;
    if(!this._unlockedMusic && !forcePlay) return;

    if(this._musicKey === key) return;

    const url = this._musicUrl(key);
    if(!url) return;

    const incoming = this._musicIsA ? this._musicB : this._musicA;
    const outgoing = this._musicIsA ? this._musicA : this._musicB;

    // setup incoming
    incoming.pause();
    incoming.muted = false;
    incoming.loop = true;
    incoming.preload = "auto";
    incoming.src = url;

    // iOS: sometimes currentTime=0 before metadata loaded can throw or be ignored; set after canplay
    incoming.volume = 0;

    // Ensure browser starts fetching
    try{ incoming.load(); }catch(_){}

    // Wait until it is actually ready (prevents "open again but silent")
    await once(incoming, "canplay", 1800);

    // Try play (must be inside user gesture for first time; subsequent usually ok)
    try{
      const p = incoming.play();
      if(p && typeof p.then === "function") await p;
      this._unlockedMusic = true;
    }catch(_){
      return; // blocked -> remain silent
    }

    // Wait for real playback start (super important on iOS)
    await once(incoming, "playing", 1200);

    // Now safe to reset time (some iOS likes this after playing)
    try{ incoming.currentTime = 0; }catch(_){}

    // crossfade
    const dur = Math.max(0.01, fadeSec);
    await this._crossfade(outgoing, incoming, dur);

    // finalize
    try{ outgoing.pause(); }catch(_){}
    outgoing.volume = 0;

    this._musicIsA = !this._musicIsA;
    this._musicKey = key;
  }

  async stopMusic({ fadeSec=0.6 } = {}){
    const dur = Math.max(0.01, fadeSec);
    const a = this._musicA;
    const b = this._musicB;

    await Promise.all([
      this._fadeTo(a, 0, dur),
      this._fadeTo(b, 0, dur)
    ]);

    try{ a.pause(); }catch(_){}
    try{ b.pause(); }catch(_){}

    // keep src (don’t clear) – clearing sometimes causes weird lock on iOS
    // Just reset time softly
    try{ a.currentTime = 0; }catch(_){}
    try{ b.currentTime = 0; }catch(_){}

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

  async _crossfade(outgoing, incoming, sec){
    const toIn = this._musicVol;
    await Promise.all([
      this._fadeTo(incoming, toIn, sec),
      this._fadeTo(outgoing, 0, sec)
    ]);
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
      // If iOS still locked, wait for user toggle; don't spam play()
      if(this._unlockedMusic){
        await this._applyDesiredMusic(now, { forcePlay: false });
      }
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
      if(this._musicKey) await this.stopMusic({ fadeSec: 0.8 });
      return;
    }

    if(desired !== this._musicKey){
      await this.playMusic(desired, { fadeSec: this._musicFadeSec, forcePlay });
    }
  }
}
