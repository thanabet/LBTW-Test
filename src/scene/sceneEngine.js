import { SkyManager } from "./skyManager.js";
import { CloudManager } from "./cloudManager.js";

const CLOUD_PROFILE_FADE_SEC = 30.0; // ✅ ปรับความเนียนตรงนี้ (วินาที)

export class SceneEngine {
  constructor({ hostEl, sceneLayout }){
    this.hostEl = hostEl;
    this.layout = sceneLayout;

    this.app = null;

    this.sky = null;

    // ✅ cloud crossfade system
    this.cloudCfg = null;

    this.cloudContainer = null;      // parent
    this.cloudLayerA = null;         // PIXI.Container (alpha)
    this.cloudLayerB = null;         // PIXI.Container (alpha)
    this.cloudsA = null;             // CloudManager
    this.cloudsB = null;             // CloudManager

    this._activeCloud = "A";         // "A" or "B"
    this._lastCloudProfile = "none";

    this._xfading = false;
    this._fadeT = 0;                 // seconds
    this._fadeDur = CLOUD_PROFILE_FADE_SEC;

    this.skyContainer = null;
    this.sceneRectPx = null;

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

    // layers
    this.skyContainer = new PIXI.Container();
    this.cloudContainer = new PIXI.Container();

    this.app.stage.addChild(this.skyContainer);
    this.app.stage.addChild(this.cloudContainer);

    // ✅ prepare 2 cloud layers (alpha crossfade)
    this.cloudLayerA = new PIXI.Container();
    this.cloudLayerB = new PIXI.Container();
    this.cloudContainer.addChild(this.cloudLayerA);
    this.cloudContainer.addChild(this.cloudLayerB);

    this.cloudLayerA.alpha = 1;
    this.cloudLayerB.alpha = 0;
  }

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

    // store cfg for creating both managers
    this.cloudCfg = cloudConfig;

    // create two managers
    this.cloudsA = new CloudManager(this.cloudLayerA);
    this.cloudsB = new CloudManager(this.cloudLayerB);

    await this.cloudsA.loadConfig(cloudConfig);
    await this.cloudsB.loadConfig(cloudConfig);

    // start both at none (safe)
    this.cloudsA.setProfile("none");
    this.cloudsB.setProfile("none");

    this._activeCloud = "A";
    this._lastCloudProfile = "none";
    this._xfading = false;
    this._fadeT = 0;

    // ensure sizing if we already have rect
    if(this.sceneRectPx){
      this.cloudsA.resizeToRect(this.sceneRectPx);
      this.cloudsB.resizeToRect(this.sceneRectPx);
    }
  }

  _normalizeProfile(p){
    const s = (p && String(p).trim()) ? String(p).trim() : "none";
    return s;
  }

  // ✅ start smooth crossfade between profiles
  _transitionCloudProfile(nextProfile){
    const next = this._normalizeProfile(nextProfile);
    if(next === this._lastCloudProfile) return;

    // determine front/back
    const front = (this._activeCloud === "A") ? { layer:this.cloudLayerA, mgr:this.cloudsA } : { layer:this.cloudLayerB, mgr:this.cloudsB };
    const back  = (this._activeCloud === "A") ? { layer:this.cloudLayerB, mgr:this.cloudsB } : { layer:this.cloudLayerA, mgr:this.cloudsA };

    // set back to new profile, make it start invisible
    back.mgr.setProfile(next);
    if(this.sceneRectPx) back.mgr.resizeToRect(this.sceneRectPx);

    back.layer.alpha = 0;
    front.layer.alpha = 1;

    this._xfading = true;
    this._fadeT = 0;
    this._fadeDur = CLOUD_PROFILE_FADE_SEC;

    // swap target active after fade completes
    this._pendingActive = (this._activeCloud === "A") ? "B" : "A";
    this._lastCloudProfile = next;
  }

  resize(){
    if(!this.app) return;

    const rect = this.hostEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this.app.renderer.resize(w, h);

    this.sceneRectPx = this._percentRectToPx(this.layout.sceneRect, w, h);

    // mask scene rect
    if(!this._maskG){
      this._maskG = new PIXI.Graphics();
      this.app.stage.addChild(this._maskG);
      this.app.stage.mask = this._maskG;
    }

    this._maskG.clear();
    this._maskG.rect(this.sceneRectPx.x, this.sceneRectPx.y, this.sceneRectPx.w, this.sceneRectPx.h);
    this._maskG.fill({ color: 0xffffff, alpha: 1 });

    if(this.sky) this.sky.resizeToRect(this.sceneRectPx);

    if(this.cloudsA) this.cloudsA.resizeToRect(this.sceneRectPx);
    if(this.cloudsB) this.cloudsB.resizeToRect(this.sceneRectPx);
  }

  _easeInOut(t){
    // smoothstep
    return t*t*(3 - 2*t);
  }

  update(now, dtSec, storyState){
    // sky always by time
    if(this.sky) this.sky.updateByTime(now);

    // read cloudProfile from either flat or nested state
    const profile =
      storyState?.cloudProfile ??
      storyState?.state?.cloudProfile ??
      "none";

    // trigger smooth transition if changed
    this._transitionCloudProfile(profile);

    // update both clouds while fading (so motion continues)
    if(this.cloudsA) this.cloudsA.update(now, dtSec);
    if(this.cloudsB) this.cloudsB.update(now, dtSec);

    // handle fade
    if(this._xfading){
      this._fadeT += dtSec;
      const t = Math.max(0, Math.min(1, this._fadeT / Math.max(0.001, this._fadeDur)));
      const s = this._easeInOut(t);

      if(this._activeCloud === "A"){
        this.cloudLayerA.alpha = 1 - s;
        this.cloudLayerB.alpha = s;
      }else{
        this.cloudLayerB.alpha = 1 - s;
        this.cloudLayerA.alpha = s;
      }

      if(t >= 1){
        // finalize
        this._xfading = false;

        // set active to the one that is now visible
        this._activeCloud = this._pendingActive;

        // optional: force the hidden layer alpha to 0 exactly
        if(this._activeCloud === "A"){
          this.cloudLayerA.alpha = 1;
          this.cloudLayerB.alpha = 0;
        }else{
          this.cloudLayerB.alpha = 1;
          this.cloudLayerA.alpha = 0;
        }
      }
    }
  }
}