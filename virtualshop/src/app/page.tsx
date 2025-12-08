"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader";
import { clone } from "three/examples/jsm/utils/SkeletonUtils";

type OutfitOption =
  | {
      id: string;
      label: string;
      kind: "procedural";
    }
  | {
      id: string;
      label: string;
      kind: "glb";
      url: string;
    };

// Mannequin-style humanoid (rigged) for clothing placement
const AVATAR_URL =
  "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models/2.0/RiggedFigure/glTF-Binary/RiggedFigure.glb";

const OUTFITS: OutfitOption[] = [
  {
    id: "basic-shirt",
    label: "Basic Shirt (procedural)",
    kind: "procedural",
  },
  {
    id: "body-overlay",
    label: "Body Overlay (human-like)",
    kind: "procedural",
  },
];

const HDRI_URL =
  "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/equirectangular/royal_esplanade_1k.hdr";
const RPM_CREATOR_URL = "https://demo.readyplayer.me/avatar?frameApi";

type BodyType = "slim" | "average" | "athletic" | "plus";

type Profile = {
  gender: "male" | "female";
  heightCm: number;
  weightKg: number;
  bodyType: BodyType;
};

export default function Home() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [outfitId, setOutfitId] = useState<string>(OUTFITS[0].id);
  const [loading, setLoading] = useState<string>("initializing...");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>({
    gender: "male",
    heightCm: 175,
    weightKg: 72,
    bodyType: "average",
  });

  const outfitRef = useRef<THREE.Object3D | null>(null);
  const avatarRef = useRef<THREE.Object3D | null>(null);
  const avatarModelRef = useRef<THREE.Object3D | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const hasLoadedInitialAvatar = useRef(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState("");
  const creatorFrameRef = useRef<HTMLIFrameElement | null>(null);

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

  const loadAvatarFromUrl = useCallback(
    (url: string) => {
      const controls = controlsRef.current;
      const camera = cameraRef.current;
      if (!controls || !avatarRef.current || !camera) return;

      setLoading("loading avatar...");
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
          const model = gltf.scene;
          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });

          // Re-center model: center on XZ, place feet on Y=0
          const box = new THREE.Box3().setFromObject(model);
          const center = new THREE.Vector3();
          box.getCenter(center);
          model.position.set(-center.x, -box.min.y, -center.z);

          if (avatarRef.current) {
            if (avatarModelRef.current) {
              avatarRef.current.remove(avatarModelRef.current);
            }
            if (outfitRef.current) {
              avatarRef.current.remove(outfitRef.current);
              outfitRef.current = null;
            }
            avatarModelRef.current = model;
            avatarRef.current.add(model);
            fitCameraToObject(camera, controls, avatarRef.current);
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
    },
    [fitCameraToObject],
  );

  const loadOutfit = useCallback(
    (outfit: OutfitOption) => {
      const controls = controlsRef.current;
      const camera = cameraRef.current;
      if (!controls || !avatarRef.current || !camera) return;

      setLoading("loading outfit...");
      setError(null);

      // Remove previous outfit
      if (outfitRef.current && avatarRef.current) {
        avatarRef.current.remove(outfitRef.current);
        outfitRef.current = null;
      }

      // Procedural outfits
      if (outfit.kind === "procedural") {
        // If we have the mannequin, clone it and recolor as a body overlay for a human-like silhouette
        if (outfit.id === "body-overlay" && avatarRef.current) {
          const cloned = clone(avatarRef.current);
          cloned.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.material = new THREE.MeshStandardMaterial({
                color: 0xc3d7ff,
                metalness: 0.08,
                roughness: 0.35,
                transparent: true,
                opacity: 0.72,
              });
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });
          cloned.scale.multiplyScalar(1.01);
          outfitRef.current = cloned;
          avatarRef.current.add(cloned);
          fitCameraToObject(camera, controls, avatarRef.current);
          setLoading(null);
          return;
        }

        // Basic shirt blocky placeholder
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({
          color: 0x98c1ff,
          metalness: 0.05,
          roughness: 0.5,
        });
        const torso = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.7, 0.35),
          bodyMat,
        );
        torso.position.set(0, 1.35, 0);
        torso.castShadow = true;
        torso.receiveShadow = true;
        group.add(torso);

        const sleeveMat = new THREE.MeshStandardMaterial({
          color: 0x6fa8ff,
          metalness: 0.05,
          roughness: 0.45,
        });
        const leftSleeve = new THREE.Mesh(
          new THREE.CylinderGeometry(0.11, 0.11, 0.4, 16),
          sleeveMat,
        );
        leftSleeve.rotation.z = Math.PI / 2;
        leftSleeve.position.set(-0.42, 1.42, 0);
        leftSleeve.castShadow = true;
        leftSleeve.receiveShadow = true;
        group.add(leftSleeve);

        const rightSleeve = leftSleeve.clone();
        rightSleeve.position.x = 0.42;
        group.add(rightSleeve);

        outfitRef.current = group;
        avatarRef.current.add(group);
        fitCameraToObject(camera, controls, avatarRef.current);
        setLoading(null);
        return;
      }

      // Fallback GLB outfit loader (if added later)
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(
        "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
      );
      const gltfLoader = new GLTFLoader();
      gltfLoader.setDRACOLoader(dracoLoader);

      gltfLoader.load(
        outfit.url,
        (gltf) => {
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

    const avatarRoot = new THREE.Group();
    avatarRoot.position.set(0, -1.1, 0);
    scene.add(avatarRoot);
    avatarRef.current = avatarRoot;

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
  }, [fitCameraToObject, loadAvatarFromUrl, loadOutfit, outfitId]);

  useEffect(() => {
    if (hasLoadedInitialAvatar.current) return;
    if (!avatarRef.current) return;
    hasLoadedInitialAvatar.current = true;
    const timer = window.setTimeout(() => {
      loadAvatarFromUrl(AVATAR_URL);
      const selected = OUTFITS.find((o) => o.id === outfitId);
      if (selected) {
        loadOutfit(selected);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAvatarFromUrl, loadOutfit, outfitId]);

  const applyProfileToAvatar = useCallback(
    (p: Profile) => {
      if (!avatarRef.current) return;
      const baseHeightMeters = 1.8;
      const targetHeightMeters = p.heightCm / 100;
      const scaleY = targetHeightMeters / baseHeightMeters;

      const weightRatio = (p.weightKg - 72) / 72; // relative to default 72kg
      const bodyTypeOffset: Record<BodyType, number> = {
        slim: -0.05,
        average: 0,
        athletic: 0.05,
        plus: 0.12,
      };
      const girthScale = 1 + Math.max(-0.2, Math.min(0.25, weightRatio * 0.25 + bodyTypeOffset[p.bodyType]));

      avatarRef.current.scale.set(girthScale, scaleY, girthScale);
      avatarRef.current.position.y = -1.1 * scaleY;
    },
    [],
  );

  useEffect(() => {
    applyProfileToAvatar(profile);
  }, [applyProfileToAvatar, profile]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.source !== "readyplayerme") return;
      if (event.data.eventName === "v1.frame.ready") {
        creatorFrameRef.current?.contentWindow?.postMessage(
          {
            target: "readyplayerme",
            type: "subscribe",
            eventName: "v1.avatar.exported",
          },
          "*",
        );
      }
      if (event.data.eventName === "v1.avatar.exported") {
        const avatarUrl = event.data?.data?.url as string | undefined;
        if (avatarUrl) {
          setCreatorOpen(false);
          loadAvatarFromUrl(avatarUrl);
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [loadAvatarFromUrl]);

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
                if (selected) loadOutfit(selected);
              }}
            >
              Load outfit
            </button>
            <button
              className="rounded-md border border-white/30 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              onClick={() => setCreatorOpen(true)}
            >
              Create avatar from selfie
            </button>
          </div>
        </header>

        <section className="grid gap-4 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wide text-zinc-400">
              Gender
            </label>
            <select
              className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none"
              value={profile.gender}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, gender: e.target.value as Profile["gender"] }))
              }
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wide text-zinc-400">
              Height (cm)
            </label>
            <input
              type="number"
              min={140}
              max={200}
              value={profile.heightCm}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  heightCm: Number(e.target.value) || prev.heightCm,
                }))
              }
              className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wide text-zinc-400">
              Weight (kg)
            </label>
            <input
              type="number"
              min={40}
              max={120}
              value={profile.weightKg}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  weightKg: Number(e.target.value) || prev.weightKg,
                }))
              }
              className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wide text-zinc-400">
              Body Type
            </label>
            <select
              className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none"
              value={profile.bodyType}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  bodyType: e.target.value as BodyType,
                }))
              }
            >
              <option value="slim">Slim</option>
              <option value="average">Average</option>
              <option value="athletic">Athletic</option>
              <option value="plus">Plus</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wide text-zinc-400">
              Profile Summary
            </label>
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              {profile.gender === "male" ? "Male" : "Female"} · {profile.heightCm}cm ·{" "}
              {profile.weightKg}kg · {profile.bodyType}
            </div>
          </div>
        </section>

        <section className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-wide text-zinc-400">
              Avatar GLB URL
            </label>
            <div className="flex gap-2">
              <input
                value={customAvatarUrl}
                onChange={(e) => setCustomAvatarUrl(e.target.value)}
                placeholder="https://.../avatar.glb"
                className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none"
              />
              <button
                className="shrink-0 rounded-md bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200"
                onClick={() => {
                  if (customAvatarUrl.trim()) {
                    loadAvatarFromUrl(customAvatarUrl.trim());
                  }
                }}
              >
                Load
              </button>
            </div>
            <p className="text-xs text-white/60">
              Ready Player Me 또는 임의 GLB URL을 붙여넣고 Load를 누르세요.
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/5 p-3 text-sm text-white/80">
            <span className="text-xs uppercase tracking-wide text-zinc-400">Tips</span>
            <ul className="list-disc space-y-1 pl-4">
              <li>HTTPS에 호스팅된 GLB여야 합니다.</li>
              <li>좌표계 Y-up, 스케일 1m 기준이 가장 적합합니다.</li>
              <li>스켈레톤/본 이름이 다르면 의상 자동 피팅은 제한적입니다.</li>
            </ul>
          </div>
        </section>

        {creatorOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
            <div className="relative h-[80vh] w-full max-w-5xl overflow-hidden rounded-xl border border-white/10 bg-[#0f0f19]">
              <button
                className="absolute right-3 top-3 rounded-md bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
                onClick={() => setCreatorOpen(false)}
              >
                Close
              </button>
              <iframe
                ref={creatorFrameRef}
                title="Ready Player Me Creator"
                src={RPM_CREATOR_URL}
                allow="camera *; microphone *; clipboard-read; clipboard-write"
                className="h-full w-full"
              />
            </div>
          </div>
        )}

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
