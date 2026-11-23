import * as T from 'three';

export function disposeScene(root: T.Object3D): void {
  const geometry = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
  root.traverse(object => {
    if (object instanceof T.InstancedMesh) object.dispose();
    if (object instanceof T.Mesh || object instanceof T.Points || object instanceof T.Line) {
      geometry.add(object.geometry);
      for (const item of Array.isArray(object.material) ? object.material : [object.material]) materials.add(item);
    }
    if (object instanceof T.DirectionalLight || object instanceof T.SpotLight || object instanceof T.PointLight) object.shadow.dispose();
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    if (material instanceof T.ShaderMaterial) for (const uniform of Object.values(material.uniforms)) {
      if (uniform.value instanceof T.Texture) textures.add(uniform.value);
    }
  }
  for (const item of geometry) item.dispose();
  for (const item of materials) item.dispose();
  for (const item of textures) item.dispose();
  root.clear();
}

interface Instance {
  x: number; y: number; z: number; w: number; h: number; d: number; angle: number; tint: number | undefined;
}

/** CPU staging for static batches; only the instance buffer survives mounting. */
export class Batch {
  private items: Instance[] = [];
  constructor(private geometry: T.BufferGeometry, private material: T.Material) {}
  get count(): number { return this.items.length; }
  add(x: number, y: number, z: number, w: number, h: number, d: number, tint?: number, angle = 0): void {
    this.items.push({ x, y, z, w, h, d, angle, tint });
  }
  mount(parent: T.Object3D, name: string, shadow = false, receive = true): T.InstancedMesh | undefined {
    if (!this.items.length) return;
    const mesh = new T.InstancedMesh(this.geometry, this.material, this.items.length);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = receive;
    const transform = new T.Object3D(), color = new T.Color();
    for (const [index, item] of this.items.entries()) {
      transform.position.set(item.x, item.y, item.z);
      transform.scale.set(item.w, item.h, item.d);
      transform.rotation.y = item.angle;
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      if (item.tint !== undefined) mesh.setColorAt(index, color.setHex(item.tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
    this.items = [];
    return mesh;
  }
}

export function flatPolygon(points: readonly { x: number; z: number }[]): T.ShapeGeometry {
  const shape = new T.Shape();
  points.forEach(({ x, z }, i) => i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z));
  shape.closePath();
  return new T.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}
