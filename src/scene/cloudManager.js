class CloudLayer {
  constructor(container){
    this.container = container;

    // ✅ 2 groups: current + next
    this.group0 = new PIXI.Container(); // current texture (wrap with 2 sprites)
    this.group1 = new PIXI.Container(); // next texture (wrap with 2 sprites)

    this.s00 = new PIXI.Sprite();
    this.s01 = new PIXI.Sprite();
    this.s10 = new PIXI.Sprite();
    this.s11 = new PIXI.Sprite();

    this.group0.addChild(this.s00, this.s01);
    this.group1.addChild(this.s10, this.s11);

    this.container.addChild(this.group0, this.group1);

    // start invisible
    this.group0.alpha = 0;
    this.group1.alpha = 0;

    this.rect = { x:0, y:0, w:100, h:100 };
    this.bandRect = { x:0, y:0, w:100, h:100 };

    this._texByUrl = null;

    this._enabled = false;
    this._speed = 0;
    this._scale = 1;
    this._baseAlpha = 1;

    // vertical placement controls
    this._bandRectPct = null; // {x,y,w,h} in percent of sceneRect
    this._yAlign = "center";  // "top" | "center" | "bottom"
    this._yOffsetPct = 0;     // percent of sceneRect.h

    // keyframes: [{ minute, url }]
    this._kfs = [];

    // current pair for blending
    this._curUrl = null;
    this._nextUrl = null;

    // shared scrolling offset
    this._x = 0;
  }

  bindTextureMap(texByUrl){
    this._texByUrl = texByUrl;
  }

  setProfileLayer(cfg){
    if(!cfg){
      this._enabled = false;
      this.group0.alpha = 0;
      this.group1.alpha = 0;
      this._kfs = [];
      this._bandRectPct = null;
      this._yAlign = "center";
      this._yOffsetPct = 0;
      this._curUrl = null;
      this._nextUrl = null;
      return;
    }

    this._enabled = true;
    this._speed = cfg.speedPxPerSec ?? 0;
    this._scale = cfg.scale ?? 1;
    this._baseAlpha = cfg.baseAlpha ?? 1;

    this._bandRectPct = cfg.bandRectPct || null;
    this._yAlign = cfg.yAlign || "center";
    this._yOffsetPct = cfg.yOffsetPct ?? 0;

    this._kfs = (cfg.keyframes || [])
      .map(k => ({ minute: CloudManager._parseTimeToMinute(k.time), url: k.src }))
      .filter(k => typeof k.minute === "number" && !!k.url && this._texByUrl?.has(k.url))
      .sort((a,b)=>a.minute-b.minute);

    this._applyBandRect();
    this._applyBlend(new Date(), true);
    this._resetWrapPositions();
  }

  resizeToRect(sceneRectPx){
    this.rect = sceneRectPx;
    this._applyBandRect();

    // re-cover current textures if set
    if(this._curUrl) this._applyTextureToGroup(this.group0, this._curUrl);
    if(this._nextUrl) this._applyTextureToGroup(this.group1, this._nextUrl);

    this._resetWrapPositions();
  }

  update(now, dtSec){
    if(!this._enabled || !this._kfs.length) return;

    // time blend (alpha on groups, not sprites)
    this._applyBlend(now, false);

    // move right -> left
    this._x -= this._speed * dtSec;

    // wrap based on max width of current/next tiling width
    const w0 = this._tileWidthOfGroup(this.group0);
    const w1 = this._tileWidthOfGroup(this.group1);
    const w = Math.max(w0, w1);

    if(w > 0){
      while(this._x <= -w) this._x += w;

      this._positionGroup(this.group0, this._x);
      this._positionGroup(this.group1, this._x);
    }
  }

  /* ---------- internal ---------- */

  _applyBandRect(){
    const r = this.rect;

    if(!this._bandRectPct){
      this.bandRect = { x:r.x, y:r.y, w:r.w, h:r.h };
      return;
    }

    const p = this._bandRectPct;
    const x = r.x + (p.x/100) * r.w;
    const y = r.y + (p.y/100) * r.h;
    const w = (p.w/100) * r.w;
    const h = (p.h/100) * r.h;

    const yOffset = (this._yOffsetPct/100) * r.h;

    this.bandRect = { x, y: y + yOffset, w, h };
  }

  _smoothstep(t){
    return t*t*(3-2*t);
  }

  _applyBlend(now, force){
    const kfs = this._kfs;
    if(!kfs.length) return;

    const m = now.getHours()*60 + now.getMinutes() + now.getSeconds()/60;

    let i1 = kfs.findIndex(k => k.minute > m);
    if(i1 === -1) i1 = 0;
    const i0 = (i1 - 1 + kfs.length) % kfs.length;

    const k0 = kfs[i0];
    const k1 = kfs[i1];

    const m0 = k0.minute;
    const m1 = (k1.minute > m0) ? k1.minute : (k1.minute + 1440);
    const mm = (m >= m0) ? m : (m + 1440);

    const t = (mm - m0) / (m1 - m0);
    const s = this._smoothstep(Math.max(0, Math.min(1, t)));

    // set textures only when changed
    if(force || this._curUrl !== k0.url){
      this._curUrl = k0.url;
      this._applyTextureToGroup(this.group0, this._curUrl);
      this._resetWrapPositions();
    }
    if(force || this._nextUrl !== k1.url){
      this._nextUrl = k1.url;
      this._applyTextureToGroup(this.group1, this._nextUrl);
      this._resetWrapPositions();
    }

    // alpha on GROUPS => wrap won’t affect alpha anymore ✅
    this.group0.alpha = (1 - s) * this._baseAlpha;
    this.group1.alpha = s * this._baseAlpha;
  }

  _applyTextureToGroup(group, url){
    const tex = this._texByUrl.get(url);
    if(!tex) return;

    const [s0, s1] = (group === this.group0) ? [this.s00, this.s01] : [this.s10, this.s11];

    s0.texture = tex;
    s1.texture = tex;

    this._coverSprite(s0, this.bandRect);
    this._coverSprite(s1, this.bandRect);
  }

  _coverSprite(sprite, bandRect){
    if(!sprite.texture?.width) return;

    const tw = sprite.texture.width;
    const th = sprite.texture.height;
    const s = Math.max(bandRect.w / tw, bandRect.h / th) * this._scale;

    sprite.scale.set(s);
  }

  _computeYForSprite(sprite){
    const r = this.bandRect;

    if(this._yAlign === "top") return r.y;
    if(this._yAlign === "bottom") return r.y + (r.h - sprite.height);
    return r.y + (r.h - sprite.height) / 2;
  }

  _tileWidthOfGroup(group){
    const s0 = (group === this.group0) ? this.s00 : this.s10;
    return s0.width || 0;
  }

  _positionGroup(group, xOffset){
    const r = this.bandRect;
    const [s0, s1] = (group === this.group0) ? [this.s00, this.s01] : [this.s10, this.s11];

    const w = s0.width || 0;
    if(w <= 0) return;

    const y = this._computeYForSprite(s0);

    s0.x = r.x + xOffset;
    s1.x = r.x + xOffset + w;

    s0.y = y;
    s1.y = y;
  }

  _resetWrapPositions(){
    this._x = 0;
    this._positionGroup(this.group0, 0);
    this._positionGroup(this.group1, 0);
  }
}

export class CloudManager {
  constructor(container){
    this.container = container;

    this._profiles = {};
    this._profileName = "none";
    this._enabled = false;

    this._texByUrl = new Map();

    // 2 layers (far behind near)
    this.layerFar = new CloudLayer(this.container);
    this.layerNear = new CloudLayer(this.container);

    this.layerFar.bindTextureMap(this._texByUrl);
    this.layerNear.bindTextureMap(this._texByUrl);

    this.rect = { x:0, y:0, w:100, h:100 };
  }

  async loadConfig(cloudConfig){
    this._profiles = cloudConfig.profiles || {};
    this._profileName = cloudConfig.defaultProfile || "none";

    const allUrls = new Set();
    for(const p of Object.values(this._profiles)){
      const layers = p?.layers || [];
      for(const layer of layers){
        for(const k of (layer.keyframes || [])){
          if(k?.src) allUrls.add(k.src);
        }
      }
    }

    const urls = [...allUrls];
    await Promise.all(urls.map(async (u)=>{
      const tex = await PIXI.Assets.load(u);
      this._texByUrl.set(u, tex);
    }));

    this.setProfile(this._profileName);
  }

  setProfile(name){
    const p = this._profiles?.[name] || this._profiles?.["none"] || { enabled:false };
    this._profileName = name;
    this._enabled = !!p.enabled;

    if(!this._enabled){
      this.layerFar.setProfileLayer(null);
      this.layerNear.setProfileLayer(null);
      return;
    }

    const layers = p.layers || [];
    this.layerFar.setProfileLayer(layers[0] || null);
    this.layerNear.setProfileLayer(layers[1] || null);

    this.layerFar.resizeToRect(this.rect);
    this.layerNear.resizeToRect(this.rect);
  }

  resizeToRect(sceneRectPx){
    this.rect = sceneRectPx;
    this.layerFar.resizeToRect(sceneRectPx);
    this.layerNear.resizeToRect(sceneRectPx);
  }

  update(now, dtSec){
    if(!this._enabled) return;
    this.layerFar.update(now, dtSec);
    this.layerNear.update(now, dtSec);
  }

  static _parseTimeToMinute(str){
    const [hh, mm] = String(str).split(":").map(n => parseInt(n, 10));
    if(Number.isNaN(hh)) return null;
    return hh * 60 + (Number.isNaN(mm) ? 0 : mm);
  }
}


