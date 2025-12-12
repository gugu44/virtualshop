"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls, GLTFLoader, DRACOLoader, RGBELoader } from "three-stdlib";
import { SkeletonUtils } from "three-stdlib";

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
  {
    id: "coat",
    label: "Coat (procedural)",
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
  const [loading, setLoading] = useState<string | null>("initializing...");
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
        if (outfit.id === "body-overlay" && avatarModelRef.current) {
          const cloned = SkeletonUtils.clone(avatarModelRef.current);
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

        if (outfit.id === "coat" && avatarModelRef.current) {
          const cloned = SkeletonUtils.clone(avatarModelRef.current);
          cloned.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.material = new THREE.MeshStandardMaterial({
                color: 0x2a3b55, // Dark blue
                metalness: 0.1,
                roughness: 0.6,
                side: THREE.DoubleSide,
              });
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });
          cloned.scale.multiplyScalar(1.03);
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

          // Re-apply currently selected outfit
          const currentOutfit = OUTFITS.find((o) => o.id === outfitId);
          if (currentOutfit) {
            loadOutfit(currentOutfit);
          }
        },
        undefined,
        (err) => {
          console.error("Avatar load error", err);
          setError("아바타 로드 실패");
          setLoading(null);
        },
      );
    },
    [fitCameraToObject, loadOutfit, outfitId],
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

  const [sidebarTab, setSidebarTab] = useState<"clothes" | "body">("clothes");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0b0b10] text-white">
      {/* Left: 3D Canvas */}
      <div className="relative flex-1 bg-gradient-to-b from-[#12121c] to-[#0b0b10]">
        <div ref={mountRef} className="h-full w-full" />

        {/* Overlay Header / Branding */}
        <div className="absolute left-6 top-6 pointer-events-none">
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">
            Virtual Shop
          </p>
          <h1 className="text-xl font-bold text-white drop-shadow-md">
            Fitting Room
          </h1>
        </div>

        {/* Loading / Error States */}
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-all duration-500">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              <p className="text-sm font-medium text-white tracking-wide uppercase">{loading}</p>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-lg bg-red-500/90 px-4 py-3 text-sm font-medium text-white shadow-lg backdrop-blur-md">
            {error}
          </div>
        )}
      </div>

      {/* Right: Sidebar Panel */}
      <aside className="item-center flex w-96 flex-col border-l border-white/10 bg-[#0f0f14] shadow-2xl z-10">
        {/* Sidebar Header / Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setSidebarTab("clothes")}
            className={`flex-1 py-4 text-sm font-semibold uppercase tracking-wide transition-colors ${sidebarTab === "clothes"
              ? "border-b-2 border-white text-white"
              : "text-zinc-500 hover:text-zinc-300"
              }`}
          >
            Clothes
          </button>
          <button
            onClick={() => setSidebarTab("body")}
            className={`flex-1 py-4 text-sm font-semibold uppercase tracking-wide transition-colors ${sidebarTab === "body"
              ? "border-b-2 border-white text-white"
              : "text-zinc-500 hover:text-zinc-300"
              }`}
          >
            Body & Avatar
          </button>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          {sidebarTab === "clothes" && (
            <div className="flex flex-col gap-6">
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Select Outfit
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {OUTFITS.map((item) => {
                    const isActive = outfitId === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setOutfitId(item.id);
                          const selected = OUTFITS.find((o) => o.id === item.id);
                          if (selected) loadOutfit(selected);
                        }}
                        className={`group relative flex aspect-[3/4] flex-col items-center justify-end overflow-hidden rounded-xl border transition-all duration-300 ${isActive
                          ? "border-white bg-white/10 ring-1 ring-white/50"
                          : "border-white/5 bg-white/5 hover:border-white/20 hover:bg-white/10"
                          }`}
                      >
                        {/* Placeholder for Outfit Image */}
                        <div className="absolute inset-0 flex items-center justify-center text-4xl opacity-20 transition-opacity group-hover:opacity-40">
                          {item.id.includes("shirt") ? "👕" : item.id.includes("coat") ? "🧥" : "👗"}
                        </div>

                        <div className="relative w-full bg-gradient-to-t from-black/90 to-transparent p-3 pt-8 text-center">
                          <span className={`block text-xs font-medium ${isActive ? "text-white" : "text-zinc-300"}`}>
                            {item.label}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {sidebarTab === "body" && (
            <div className="flex flex-col gap-8">
              {/* Profile Config section reused with better styling */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Measurements
                </h3>

                {/* Gender */}
                <div className="space-y-2">
                  <label className="text-xs text-zinc-400">Gender</label>
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-white/5 p-1">
                    {(["male", "female"] as const).map((g) => (
                      <button
                        key={g}
                        onClick={() => setProfile(p => ({ ...p, gender: g }))}
                        className={`rounded-md py-2 text-xs font-medium capitalize transition-all ${profile.gender === g
                          ? "bg-white text-black shadow-sm"
                          : "text-zinc-400 hover:text-white"
                          }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Body Type */}
                <div className="space-y-2">
                  <label className="text-xs text-zinc-400">Body Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {["slim", "average", "athletic", "plus"].map(val => (
                      <button
                        key={val}
                        onClick={() => setProfile(p => ({ ...p, bodyType: val as BodyType }))}
                        className={`rounded-md border p-2 text-xs capitalize transition-all ${profile.bodyType === val
                          ? "border-white bg-white/10 text-white"
                          : "border-white/10 bg-transparent text-zinc-400 hover:border-white/30"
                          }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sliders for Height/Weight */}
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Height</span>
                      <span className="text-white">{profile.heightCm} cm</span>
                    </div>
                    <input
                      type="range"
                      min={140}
                      max={200}
                      value={profile.heightCm}
                      onChange={(e) => setProfile(p => ({ ...p, heightCm: Number(e.target.value) }))}
                      className="h-1.5 w-full appearance-none rounded-full bg-white/10 outline-none hover:bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Weight</span>
                      <span className="text-white">{profile.weightKg} kg</span>
                    </div>
                    <input
                      type="range"
                      min={40}
                      max={120}
                      value={profile.weightKg}
                      onChange={(e) => setProfile(p => ({ ...p, weightKg: Number(e.target.value) }))}
                      className="h-1.5 w-full appearance-none rounded-full bg-white/10 outline-none hover:bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Avatar Section */}
              <div className="space-y-4 border-t border-white/10 pt-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Custom Avatar
                </h3>
                <button
                  className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition-transform active:scale-95 hover:opacity-90"
                  onClick={() => setCreatorOpen(true)}
                >
                  Create from Selfie
                </button>

                <div className="space-y-2">
                  <label className="text-xs text-zinc-400">Load GLB URL</label>
                  <div className="flex gap-2">
                    <input
                      value={customAvatarUrl}
                      onChange={(e) => setCustomAvatarUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-white/30"
                    />
                    <button
                      onClick={() => {
                        if (customAvatarUrl.trim()) loadAvatarFromUrl(customAvatarUrl.trim());
                      }}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20"
                    >
                      →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer info or CTA */}
        <div className="border-t border-white/10 bg-white/5 p-4">
          <button className="w-full rounded-lg bg-white py-3 text-sm font-bold text-black shadow-lg transition-transform hover:bg-zinc-200 active:scale-95">
            Add to Cart
          </button>
        </div>
      </aside>

      {/* Fullscreen Loading Overlay (Initial) - Optional if we want to block interaction */}

      {/* Ready Player Me Iframe Overlay */}
      {creatorOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="relative h-[85vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f19] shadow-2xl">
            <button
              className="absolute right-4 top-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-white/20 backdrop-blur-md"
              onClick={() => setCreatorOpen(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
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
    </div>
  );
}
