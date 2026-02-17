import { SkyManager } from "./skyManager.js";

export class SceneEngine {
  constructor({ hostEl, sceneLayout }){
    this.hostEl = hostEl;
    this.layout = sceneLayout;
    this.app = null;
    this.sky = null;
    this.sceneRectPx = null;

    // reuse mask graphic (กันสะสม)
    this._maskG = null;
  }

  _percentRectToPx(rectPct, w, h){
    return {
      x: (rectPct.x/100) * w,
      y: (rectPct.y/100) * h,
      w: (rectPct.w/100) * w,
      h: (rectPct.h/100) * h
    };
  }

  // ✅ รองรับ 2 แบบ:
  // 1) initSky([urls]) แบบเดิม
  // 2) initSky({ urls, keyframes }) แบบใหม่
  async initSky(arg){
    if(!this.app){
      this.app = new PIXI.Application();
      await this.app.init({
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.max(1, window.devicePixelRatio || 1),
        autoDensity: true
      });
      this.hostEl.appendChild(this.app.canvas);
    }

    this.sky = new SkyManager(this.app.stage);

    if(Array.isArray(arg)){
      await this.sky.load({ urls: arg });
    }else{
      await this.sky.load(arg);
    }
  }

  resize(){
    if(!this.app) return;

    const rect = this.hostEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this.app.renderer.resize(w, h);

    this.sceneRectPx = this._percentRectToPx(this.layout.sceneRect, w, h);

    // mask เฉพาะพื้นที่ scene (reuse)
    if(!this._maskG){
      this._maskG = new PIXI.Graphics();
      this.app.stage.addChild(this._maskG);
      this.app.stage.mask = this._maskG;
    }

    this._maskG.clear();
    this._maskG.rect(this.sceneRectPx.x, this.sceneRectPx.y, this.sceneRectPx.w, this.sceneRectPx.h);
    this._maskG.fill({ color: 0xffffff, alpha: 1 });

    if(this.sky){
      this.sky.resizeToRect(this.sceneRectPx);
    }
  }

  updateSkyByTime(now){
    if(!this.sky) return;
    this.sky.updateByTime(now);
  }
}
