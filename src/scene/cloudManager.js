class CloudLayer {
  constructor(container){
    this.container = container;

    // two sprites for wrap scrolling
    this.a = new PIXI.Sprite();
    this.b = new PIXI.Sprite();

    this.a.alpha = 0;
    this.b.alpha = 0;

    this.container.addChild(this.a, this.b);

    // scene rect (px) passed from SceneEngine
    this.rect = { x:0, y:0, w:100, h:100 };

    // band rect = vertical band (px) for this layer
    this.bandRect = { x:0, y:0, w:100, h:100 };

    this._kfs = []; // [{ minute, url }]
    this._texByUrl = null;

    this._enabled = false;
    this._speed = 0;
    this._scale = 1;
    this._baseAlpha = 1;

    // vertical placement controls (percent of sceneRect)
    this._bandRectPct = null; // {x,y,w,h} in percent of sceneRect
    this._yAlign = "center";  // "top" | "center" | "bottom"
    this._yOffsetPct = 0;     // percent of sceneRect.h

    this._x = 0;
  }

  bindTextureMap(texByUrl){
    this._texByUrl = texByUrl;
  }

  setProfileLayer(cfg){
    if(!cfg){
      this._enabled = false;
      this.a.alpha = 0;
      this.b.alpha = 0;
      this._kfs = [];
      this._bandRectPct = null;
      this._yAlign = "center";
      this._yOffsetPct = 0;
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
    this._applyBlend(new Date());
    this._resetWrapPositions();
  }

  resizeToRect(sceneRectPx){
    this.rect = sceneRectPx;
    this._applyBandRect();
    this._cover(this.a, this.bandRect);
    this._cover(this.b, this.bandRect);
    this._resetWrapPositions();
  }

  update(now, dtSec){
    if(!this._enabled || !this._kfs.length) return;

    // time blend
    this._applyBlend(now);

    // move right -> left
    this._x -= this._speed * dtSec;

    const w = this.a.width;
    if(w > 0){
      // wrap when fully out of left
      while(this._x <= -w) this._x += w;

      this.a.x = this.bandRect.x + this._x;
      this.b.x = this.bandRect.x + this._x + w;

      this.a.y = this._computeY(this.a, this.bandRect);
      this.b.y = this._computeY(this.b, this.bandRect);
    }
  }

  _applyBandRect(){
    const r = this.rect;

    // default: full scene rect
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

  _computeY(sprite, bandRect){
    if(this._yAlign === "top"){
      return bandRect.y;
    }
    if(this._yAlign === "bottom"){
      return bandRect.y + (bandRect.h - sprite.height);
    }
    // center
    return bandRect.y + (bandRect.h - sprite.height) / 2;
  }

  _applyBlend(now){
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
    const s = CloudManager._smoothstep(Math.max(0, Math.min(1, t)));

    const tex0 = this._texByUrl.get(k0.url);
    const tex1 = this._texByUrl.get(k1.url);

    if(this.a.texture !== tex0){
      this.a.texture = tex0;
      this._cover(this.a, this.bandRect);
      this._resetWrapPositions();
    }
    if(this.b.texture !== tex1){
      this.b.texture = tex1;
      this._cover(this.b, this.bandRect);
      this._resetWrapPositions();
    }

    this.a.alpha = (1 - s) * this._baseAlpha;
    this.b.alpha = s * this._baseAlpha;
  }

  _cover(sprite, bandRect){
    if(!sprite.texture?.width) return;

    const tw = sprite.texture.width;
    const th = sprite.texture.height;

    // object-fit: cover within band rect
    const s = Math.max(bandRect.w / tw, bandRect.h / th) * this._scale;
    sprite.scale.set(s);
  }

  _resetWrapPositions(){
    this._x = 0;
    const w = this.a.width || 0;

    this.a.x = this.bandRect.x;
    this.b.x = this.bandRect.x + w;

    this.a.y = this._computeY(this.a, this.bandRect);
    this.b.y = this._computeY(this.b, this.bandRect);
  }
}

export class CloudManager {
  constructor(container){
    this.container = container;

    this._profiles = {};
    this._profileName = "none";
    this._enabled = false;

    // preload textures referenced by config
    this._texByUrl = new Map();

    // 2 layers: far (behind) then near (front)
    this.layerFar = new CloudLayer(this.container);
    this.layerNear = new CloudLayer(this.container);

    this.layerFar.bindTextureMap(this._texByUrl);
    this.layerNear.bindTextureMap(this._texByUrl);

    this.rect = { x:0, y:0, w:100, h:100 };
  }

  async loadConfig(cloudConfig){
    this._profiles = cloudConfig.profiles || {};
    this._profileName = cloudConfig.defaultProfile || "none";

    // collect URLs
    const allUrls = new Set();
    for(const p of Object.values(this._profiles)){
      const layers = p?.layers || [];
      for(const layer of layers){
        for(const k of (layer.keyframes || [])){
          if(k?.src) allUrls.add(k.src);
        }
      }
    }

    // preload all textures once
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
    // convention: [0]=far, [1]=near
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

  static _smoothstep(t){
    return t*t*(3-2*t);
  }
}
