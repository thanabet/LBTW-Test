import { SkyManager } from "./skyManager.js";
import { CloudManager } from "./cloudManager.js";

export class SceneEngine {
  constructor({ hostEl, sceneLayout }){
    this.hostEl = hostEl;
    this.layout = sceneLayout;

    this.app = null;

    // layers
    this.sky = null;
    this.clouds = null;

    // containers
    this.skyContainer = null;
    this.cloudContainer = null;

    this.sceneRectPx = null;

    // reuse mask graphic (กันสะสม)
    this._maskG = null;

    // avoid redundant profile set
    this._lastCloudProfile = null;
  }

  _percentRectToPx(rectPct, w, h){
    return {
      x: (rectPct.x/100) * w,
      y: (rectPct.y/100) * h,
      w: (rectPct.w/100) * w,
      h: (rectPct.h/100) * h
    };
  }

  async _ensurePixi(){
    if(this.app) return;

    this.app = new PIXI.Application();
    await this.app.init({
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.max(1, window.devicePixelRatio || 1),
      autoDensity: true
    });
    this.hostEl.appendChild(this.app.canvas);

    // create containers (order matters)
    this.skyContainer = new PIXI.Container();
    this.cloudContainer = new PIXI.Container();

    this.app.stage.addChild(this.skyContainer);
    this.app.stage.addChild(this.cloudContainer);
  }

  // ✅ รองรับ 2 แบบ:
  // 1) initSky([urls]) แบบเดิม
  // 2) initSky({ urls, keyframes, mode }) แบบใหม่
  async initSky(arg){
    await this._ensurePixi();

    this.sky = new SkyManager(this.skyContainer);

    if(Array.isArray(arg)){
      await this.sky.load({ urls: arg });
    }else{
      await this.sky.load(arg);
    }
  }

  async initClouds(cloudConfig){
    await this._ensurePixi();
    this.clouds = new CloudManager(this.cloudContainer);
    await this.clouds.loadConfig(cloudConfig);
  }

  setCloudProfile(profileName){
    if(!this.clouds) return;
    if(profileName === this._lastCloudProfile) return;
    this._lastCloudProfile = profileName;
    this.clouds.setProfile(profileName);
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

    if(this.sky) this.sky.resizeToRect(this.sceneRectPx);
    if(this.clouds) this.clouds.resizeToRect(this.sceneRectPx);
  }

  updateSkyByTime(now){
    // backward compatible
    if(!this.sky) return;
    this.sky.updateByTime(now);
  }

  update(now, dtSec, storyState){
    if(this.sky) this.sky.updateByTime(now);

    const profile = storyState?.cloudProfile;
    if(profile) this.setCloudProfile(profile);

    if(this.clouds) this.clouds.update(now, dtSec);
  }
}
