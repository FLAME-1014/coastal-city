import * as T from 'three';
import { expect, it } from 'vitest';
import { disposeScene } from '../src/render/resources';
import { BuildingSystem } from '../src/render/buildings';
import { generateCity, SEED } from '../src/city/layout';

it('maps a raycast against instanced structures back to a stable building ID', () => {
  const layout = generateCity();
  const system = new BuildingSystem(layout, SEED);
  system.group.updateMatrixWorld(true);
  for (const b of layout.buildings.filter(b => b.landmark)) {
    const ray = new T.Raycaster(new T.Vector3(b.x, 170, b.z), new T.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(system.hitMeshes)[0];
    expect(hit && system.fromHit(hit)?.id).toBe(b.id);
  }
  disposeScene(system.group);
});

it('disposes shared resources, instance buffers, shader textures and shadow targets once', () => {
  const root = new T.Scene(), calls: string[] = [];
  const box = new T.BoxGeometry(), tex = new T.Texture();
  const mat = new T.MeshStandardMaterial({ map: tex });
  const shader = new T.ShaderMaterial({ uniforms: { texture: { value: tex } } });
  const instanced = new T.InstancedMesh(box, mat, 3);
  const light = new T.DirectionalLight(); light.shadow.map = new T.WebGLRenderTarget(8, 8);
  box.addEventListener('dispose', () => calls.push('box'));
  mat.addEventListener('dispose', () => calls.push('mat'));
  shader.addEventListener('dispose', () => calls.push('shader'));
  tex.addEventListener('dispose', () => calls.push('tex'));
  instanced.addEventListener('dispose', () => calls.push('instances'));
  light.shadow.map.addEventListener('dispose', () => calls.push('shadow'));
  root.add(instanced, new T.Mesh(box, mat), new T.Mesh(box, shader), light);
  disposeScene(root); disposeScene(root);
  expect(calls.sort()).toEqual(['box', 'instances', 'mat', 'shader', 'shadow', 'tex']);
  expect(root.children).toHaveLength(0);
});
