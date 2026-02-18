class CloudLayer {
  constructor(container){
    this.container = container;

    // ✅ ใช้ TilingSprite 2 อันซ้อนกันเพื่อ crossfade แบบเต็มพื้นที่
    this.a = new PIXI.TilingSprite({ texture: PIXI.Texture.EMPTY, width: 1, height: 1 });
    this.b = new PIXI.TilingSprite({ texture: PIXI.Texture.EMPTY, width: 1, height: 1 });

    this.a.alpha = 0;
    this.b.alpha = 0;

    this.container.addChild(this.a, this.b);

    // scene rect (px)
    this.rect = { x:0, y:0, w:100, h:100 };
    // band rect (px)
    this.bandRect = { x:0, y:0, w:100, h:100 };

    this._kfs = []; // [{ minute, url }]
    this._texByUrl = null;

    this._enabled = false;
    this._speed = 0;
    this._scale = 1;
    this._baseAlpha = 1;

    // vertical placement controls (percent of sceneRect)
    this._bandRectPct = null;
    this._yAlign = "center";  // "top" | "center" | "bottom"
    this._yOffsetPct = 0;

    // scroll
    this._scrollX = 0;

    // cache to avoid resetting textures constantly
    this._lastTexUrlA = null;
    this._lastTexUrlB = null;
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
      this._lastTexUrlA = null;
      this._lastTexUrlB = null;
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
  }

  resizeToRect(sceneRectPx){
    this.rect = sceneRectPx;
    this._applyBandRect();

    // resize tiling sprites to band
    this.a.width = this.bandRect.w;
    this.a.height = this.bandRect.h;
    this.b.width = this.bandRect.w;
    this.b.height = this.bandRect.h;

    // position by yAlign
    this.a.x = this.bandRect.x;
    this.b.x = this.bandRect.x;
    this.a.y = this._computeBandY(this.bandRect);
    this.b.y = this._computeBandY(this.bandRect);

    // re-apply tiling scales if textures already set
    this._applyTilingScale(this.a);
    this._applyTilingScale(this.b);
  }

  update(now, dtSec){
    if(!this._enabled || !this._kfs.length) return;

    // 1) crossfade by time (alpha sum stays constant)
    this._applyBlend(now, false);

    // 2) scroll left
    this._scrollX -= this._speed * dtSec;

    // apply scroll to both layers so they stay aligned
    this.a.tilePosition.x = this._scrollX;
    this.b.tilePosition.x = this._scrollX;
  }

  /* ---------- internals ---------- */

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

  _computeBandY(bandRect){
    // yAlign controls how band is anchored relative to itself (mostly for consistency)
    // since TilingSprite height equals bandRect.h, top/center/bottom ends up same,
    // but we keep it for future flexibility
    if(this._yAlign === "top") return bandRect.y;
    if(this._yAlign === "bottom") return bandRect.y;
    return bandRect.y;
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
    const s = CloudManager._smoothstep(Math.max(0, Math.min(1, t)));

    // ✅ set textures only when needed (prevents flicker)
    if(force || this._lastTexUrlA !== k0.url){
      this._lastTexUrlA = k0.url;
      this.a.texture = this._texByUrl.get(k0.url);
      this._applyTilingScale(this.a);
    }
    if(force || this._lastTexUrlB !== k1.url){
      this._lastTexUrlB = k1.url;
      this.b.texture = this._texByUrl.get(k1.url);
      this._applyTilingScale(this.b);
    }

    // ✅ alpha sum stays constant == baseAlpha (no “drop”)
    this.a.alpha = (1 - s) * this._baseAlpha;
    this.b.alpha = s * this._baseAlpha;
  }

  _applyTilingScale(tilingSprite){
    const tex = tilingSprite.texture;
    if(!tex?.width) return;

    // cover within bandRect, then multiply by profile scale
    const tw = tex.width;
    const th = tex.height;

    const s = Math.max(this.bandRect.w / tw, this.bandRect.h / th) * this._scale;
    tilingSprite.tileScale.set(s);
  }
}

export class CloudManager {
  constructor(container){
    this.container = container;

    this._profiles = {};
    this._profileName = "none";
    this._enabled = false;

    this._texByUrl = new Map();

    // 2 layers: far behind near
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

  static _smoothstep(t){
    return t*t*(3-2*t);
  }
}

