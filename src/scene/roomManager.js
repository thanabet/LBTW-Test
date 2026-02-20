export class RoomManager {
  constructor(container){
    this.container = container;

    // Two sprites for crossfade (like sky)
    this.a = new PIXI.Sprite();
    this.b = new PIXI.Sprite();
    this.a.alpha = 0;
    this.b.alpha = 0;

    this.container.addChild(this.a, this.b);

    this._texByUrl = new Map();

    // config
    this._slots = []; // [{minute, key}]
    this._fadeSec = 3.0;       // time-slot fade
    this._lightFadeSec = 0.5;  // on/off fade (ตามที่พี่มี่ขอ)

    this._basePath = "assets/scene/room/";
    this._filePattern = "{key}_{light}.png"; // light = on/off

    // current state
    this._curUrl = null;
    this._activeSprite = this.a;
    this._inactiveSprite = this.b;

    // transition
    this._t = 0;
    this._dur = 0;
    this._inTransition = false;

    // scene rect (px) for cover placement
    this.rect = { x:0, y:0, w:100, h:100 };

    // last resolved target (to avoid restarting fades)
    this._lastTargetUrl = null;
  }

  async load(cfg){
    this._slots = (cfg?.slots || [])
      .map(s => ({ minute: RoomManager._parseTimeToMinute(s.start), key: s.key }))
      .filter(s => typeof s.minute === "number" && !!s.key)
      .sort((a,b)=>a.minute-b.minute);

    this._fadeSec = Math.max(0.01, Number(cfg?.fadeSec ?? 3.0) || 3.0);
    this._lightFadeSec = Math.max(0.01, Number(cfg?.lightFadeSec ?? 0.5) || 0.5);

    if(cfg?.basePath) this._basePath = String(cfg.basePath);
    if(cfg?.filePattern) this._filePattern = String(cfg.filePattern);

    // preload all URLs
    const urls = [];
    for(const s of this._slots){
      urls.push(this._resolveUrl(s.key, "off"));
      urls.push(this._resolveUrl(s.key, "on"));
    }
    const uniq = [...new Set(urls)];

    await Promise.all(uniq.map(async (url) => {
      try{
        const tex = await PIXI.Assets.load(url);
        this._texByUrl.set(url, tex);
      }catch(_){
        // missing asset is OK (will just not render)
      }
    }));
  }

  resizeToRect(sceneRectPx){
    this.rect = sceneRectPx;
    this._cover(this.a, this.rect);
    this._cover(this.b, this.rect);
    this.a.position.set(this.rect.x, this.rect.y);
    this.b.position.set(this.rect.x, this.rect.y);
  }

  // Apply immediately (no fade) — used on initial load / refresh
  setInitial(now, storyState){
    const target = this._computeTarget(now, storyState);
    this._applyInstant(target);
  }

  update(now, dtSec, storyState){
    const target = this._computeTarget(now, storyState);

    // Start transition if target changed
    if(target && target !== this._lastTargetUrl){
      const isLightOnly = this._isLightOnlyChange(this._lastTargetUrl, target);
      const dur = isLightOnly ? this._lightFadeSec : this._fadeSec;
      this._startTransition(target, dur);
    }

    // advance transition
    if(this._inTransition){
      this._t += dtSec;
      const k = Math.min(1, this._t / Math.max(0.001, this._dur));
      this._inactiveSprite.alpha = k;
      this._activeSprite.alpha = 1 - k;

      if(k >= 1){
        // swap
        const tmp = this._activeSprite;
        this._activeSprite = this._inactiveSprite;
        this._inactiveSprite = tmp;

        this._inactiveSprite.alpha = 0;
        this._activeSprite.alpha = 1;

        this._curUrl = this._lastTargetUrl;
        this._inTransition = false;
      }
    }
  }

  /* ---------------- internal ---------------- */

  _computeTarget(now, storyState){
    // default light = off
    const light = (storyState?.roomLight === "on") ? "on" : "off";
    const slotKey = this._pickSlotKey(now);
    if(!slotKey) return null;

    return this._resolveUrl(slotKey, light);
  }

  _pickSlotKey(now){
    if(!this._slots.length) return null;
    const t = now.getHours()*60 + now.getMinutes();
    let pick = this._slots[0];
    for(const s of this._slots){
      if(t >= s.minute) pick = s;
    }
    return pick?.key || null;
  }

  _resolveUrl(key, light){
    const file = this._filePattern
      .replace("{key}", key)
      .replace("{light}", light);
    const base = this._basePath.endsWith("/") ? this._basePath : (this._basePath + "/");
    return base + file;
  }

  _getTex(url){
    return this._texByUrl.get(url) || null;
  }

  _applyInstant(url){
    this._cancelTransition();
    this._lastTargetUrl = url;
    this._curUrl = url;

    const tex = this._getTex(url);
    if(tex){
      this._activeSprite.texture = tex;
      this._inactiveSprite.texture = tex;
    }

    this._activeSprite.alpha = 1;
    this._inactiveSprite.alpha = 0;
    this._cover(this._activeSprite, this.rect);
    this._cover(this._inactiveSprite, this.rect);
    this._activeSprite.position.set(this.rect.x, this.rect.y);
    this._inactiveSprite.position.set(this.rect.x, this.rect.y);
  }

  _startTransition(url, dur){
    // If we have no current texture yet, just apply instantly
    if(!this._curUrl){
      this._applyInstant(url);
      return;
    }

    const tex = this._getTex(url);
    if(!tex){
      // missing asset, ignore
      this._lastTargetUrl = this._curUrl;
      return;
    }

    // Prepare inactive sprite with new texture
    this._inactiveSprite.texture = tex;
    this._inactiveSprite.alpha = 0;
    this._cover(this._inactiveSprite, this.rect);
    this._inactiveSprite.position.set(this.rect.x, this.rect.y);

    // Active stays as-is
    this._cover(this._activeSprite, this.rect);
    this._activeSprite.position.set(this.rect.x, this.rect.y);

    this._t = 0;
    this._dur = Math.max(0.01, dur);
    this._inTransition = true;

    this._lastTargetUrl = url;
  }

  _cancelTransition(){
    this._inTransition = false;
    this._t = 0;
    this._dur = 0;
  }

  _isLightOnlyChange(prevUrl, nextUrl){
    if(!prevUrl || !nextUrl) return false;
    // assumes pattern ..._{on|off}.png
    const strip = (u) => u.replace(/_(on|off)\.png$/i, "");
    return strip(prevUrl) === strip(nextUrl);
  }

  _cover(sprite, rect){
    if(!sprite.texture?.width) return;
    const tw = sprite.texture.width;
    const th = sprite.texture.height;
    const s = Math.max(rect.w / tw, rect.h / th);
    sprite.scale.set(s);
  }

  static _parseTimeToMinute(str){
    const [hh, mm] = String(str).split(":").map(n => parseInt(n, 10));
    if(Number.isNaN(hh)) return null;
    return hh * 60 + (Number.isNaN(mm) ? 0 : mm);
  }
}