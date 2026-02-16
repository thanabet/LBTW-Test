export class SkyManager {
  constructor(stage){
    this.stage = stage;
    this.textures = [];
    this.a = new PIXI.Sprite();
    this.b = new PIXI.Sprite();
    this.a.alpha = 1;
    this.b.alpha = 0;
    this.stage.addChild(this.a, this.b);

    this.currentIndex = 0;
    this.targetIndex = 0;
    this.fadeStart = 0;
    this.fadeDurationMs = 90_000; // 90s default (ปรับได้)
    this.rect = { x:0, y:0, w:100, h:100 };
  }

  async load(urls){
    this.textures = await Promise.all(urls.map(u => PIXI.Assets.load(u)));
    this.currentIndex = 0;
    this.a.texture = this.textures[0];
    this.b.texture = this.textures[0];
  }

  resizeToRect(rect){
    this.rect = rect;
    this._cover(this.a, rect);
    this._cover(this.b, rect);
  }

  _cover(sprite, rect){
    if(!sprite.texture?.width) return;
    const tw = sprite.texture.width;
    const th = sprite.texture.height;

    // cover rect
    const s = Math.max(rect.w / tw, rect.h / th);
    sprite.scale.set(s);

    sprite.x = rect.x + (rect.w - tw * s) / 2;
    sprite.y = rect.y + (rect.h - th * s) / 2;
  }

  _timeToIndex(now){
    const h = now.getHours() + now.getMinutes()/60;

    // mapping (ปรับได้)
    // 0..24
    if(h >= 5.5 && h < 8) return 0;     // sunrise
    if(h >= 8 && h < 17.5) return 1;    // day
    if(h >= 17.5 && h < 19) return 2;   // sunset
    if(h >= 19 && h < 22.5) return 3;   // early night
    return 4;                            // deep night
  }

  updateByTime(now){
    const idx = this._timeToIndex(now);

    if(idx !== this.targetIndex){
      // start fade
      this.targetIndex = idx;
      this.fadeStart = performance.now();

      // load next texture into B
      this.b.texture = this.textures[this.targetIndex];
      this._cover(this.b, this.rect);

      // reset fade
      this.b.alpha = 0;
      this.a.alpha = 1;
    }

    // do fade
    if(this.targetIndex !== this.currentIndex){
      const t = (performance.now() - this.fadeStart) / this.fadeDurationMs;
      const clamped = Math.max(0, Math.min(1, t));
      // smoothstep
      const s = clamped * clamped * (3 - 2 * clamped);

      this.b.alpha = s;
      this.a.alpha = 1 - s;

      if(clamped >= 1){
        // commit
        this.currentIndex = this.targetIndex;
        this.a.texture = this.textures[this.currentIndex];
        this._cover(this.a, this.rect);
        this.a.alpha = 1;
        this.b.alpha = 0;
      }
    }
  }
}
