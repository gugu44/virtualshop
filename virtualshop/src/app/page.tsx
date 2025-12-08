"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib/controls/OrbitControls";
import { GLTFLoader } from "three-stdlib/loaders/GLTFLoader";
import { DRACOLoader } from "three-stdlib/loaders/DRACOLoader";
import { RGBELoader } from "three-stdlib/loaders/RGBELoader";

type OutfitOption = {
  id: string;
  label: string;
  url: string;
};

const AVATAR_URL =
  "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models/2.0/CesiumMan/glTF-Binary/CesiumMan.glb";

const OUTFITS: OutfitOption[] = [
  {
    id: "helmet",
    label: "Damaged Helmet",
    url: "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb",
  },
  {
    id: "duck",
    label: "Duck",
    url: "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models/2.0/Duck/glTF-Binary/Duck.glb",
  },
];

const HDRI_URL =
  "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/equirectangular/royal_esplanade_1k.hdr";

export default function Home() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [outfitId, setOutfitId] = useState<string>(OUTFITS[0].id);
  const [loading, setLoading] = useState<string>("initializing...");
  const [error, setError] = useState<string | null>(null);

  const outfitRef = useRef<THREE.Object3D | null>(null);
  const avatarRef = useRef<THREE.Object3D | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const fitCameraToObject = useCallback(
    (camera: THREE.PerspectiveCamera, controls: OrbitControls, object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      const fitHeightDistance =
        maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360));
      const fitWidthDistance = fitHeightDistance / camera.aspect;
      const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.5;

      camera.position.set(center.x, center.y + size.y * 0.2, distance + center.z);
      camera.near = Math.max(0.1, distance / 50);
      camera.far = distance * 50;
      camera.updateProjectionMatrix();

      controls.target.copy(center);
      controls.update();
    },
    [],
  );

  const loadOutfit = useCallback(
    (url: string) => {
      const controls = controlsRef.current;
      const camera = cameraRef.current;
      if (!controls || !avatarRef.current || !camera) return;

      setLoading("loading outfit...");
      setError(null);

      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(
        "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
      );
      const gltfLoader = new GLTFLoader();
      gltfLoader.setDRACOLoader(dracoLoader);

      gltfLoader.load(
        url,
        (gltf) => {
          if (outfitRef.current && avatarRef.current) {
            avatarRef.current.remove(outfitRef.current);
          }
          outfitRef.current = gltf.scene;
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });
          avatarRef.current?.add(gltf.scene);
          if (avatarRef.current) {
            fitCameraToObject(camera, controls, avatarRef.current);
          }
          setLoading(null);
        },
        undefined,
        (err) => {
          console.error("Outfit load error", err);
          setError("의상 로드 실패");
          setLoading(null);
        },
      );
    },
    [fitCameraToObject],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f4f4f5");

    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1000,
    );
    camera.position.set(0, 1.6, 4);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.physicallyCorrectLights = true;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.5;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI / 2;
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(3, 6, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    scene.add(dirLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.2 }),
    );
    ground.receiveShadow = true;
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    scene.add(ground);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const rgbeLoader = new RGBELoader();
    rgbeLoader.load(
      HDRI_URL,
      (texture) => {
        const envMap = pmrem.fromEquirectangular(texture).texture;
        scene.environment = envMap;
        texture.dispose();
        setLoading("loading avatar...");
      },
      undefined,
      (err) => {
        console.error("HDR load error", err);
        setError("HDRI 환경맵 로드 실패 (계속 진행합니다)");
        setLoading("loading avatar...");
      },
    );

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
    );
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    const avatarRoot = new THREE.Group();
    avatarRoot.position.set(0, -1.1, 0);
    scene.add(avatarRoot);

    gltfLoader.load(
      AVATAR_URL,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        avatarRoot.add(model);
        avatarRef.current = avatarRoot;
        fitCameraToObject(camera, controls, avatarRoot);
        const selected = OUTFITS.find((o) => o.id === outfitId);
        if (selected) {
          loadOutfit(selected.url);
        }
        setLoading(null);
      },
      undefined,
      (err) => {
        console.error("Avatar load error", err);
        setError("아바타 로드 실패");
        setLoading(null);
      },
    );

    let frameId: number;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(tick);
    };
    tick();

    const handleResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      renderer.dispose();
      pmrem.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [fitCameraToObject, loadOutfit, outfitId]);

  return (
    <div className="min-h-screen bg-[#0b0b10] text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-zinc-400">
              Web VTO Minimal Demo
            </p>
            <h1 className="text-2xl font-semibold text-white">
              Avatar + Outfit Loader (Three.js)
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <select
              className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none"
              value={outfitId}
              onChange={(e) => setOutfitId(e.target.value)}
              aria-label="Select outfit"
            >
              {OUTFITS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200"
              onClick={() => {
                const selected = OUTFITS.find((o) => o.id === outfitId);
                if (selected) loadOutfit(selected.url);
              }}
            >
              Load outfit
            </button>
          </div>
        </header>

        <div className="relative h-[70vh] overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-[#12121c] to-[#0b0b10]">
          <div ref={mountRef} className="h-full w-full" />
          {loading && (
            <div className="pointer-events-none absolute left-0 top-0 flex h-full w-full items-center justify-center bg-black/30 text-sm text-white">
              {loading}
            </div>
          )}
          {error && (
            <div className="absolute bottom-4 left-4 rounded-md bg-red-500/80 px-3 py-2 text-xs text-white shadow-lg">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
