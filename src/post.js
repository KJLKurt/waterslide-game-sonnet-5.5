// Optional post-processing (bloom). Loaded lazily via dynamic import() so the default path pays nothing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createPost(renderer, scene, camera, width, height, pixelRatio) {
  const target = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, { type: THREE.HalfFloatType, samples: 2 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(width / 2, height / 2), 0.22, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    composer,
    render: (dt) => composer.render(dt),
    setSize: (w, h, pr) => { composer.setPixelRatio(pr); composer.setSize(w, h); bloom.setSize(w / 2, h / 2); },
    dispose: () => { composer.dispose(); target.dispose(); },
  };
}
