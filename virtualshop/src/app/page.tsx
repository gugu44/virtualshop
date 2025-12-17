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
  }
  | {
    id: string;
    label: string;
    kind: "texture";
    url: string;
  };

// Mannequin-style humanoid (rigged) for clothing placement
const AVATAR_URL =
  "https://models.readyplayer.me/6940cd65100ae875d5bc78fd.glb";

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

const DEFAULT_OUTFIT_TRANSFORM = {
  posX: 0,
  posY: 0,
  posZ: 0,
  scale: 1,
  rotXDeg: 0,
  rotYDeg: 0,
  rotZDeg: 0,
};

export default function Home() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [outfitId, setOutfitId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"clothes" | "body" | "magic">("magic");
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
  const isCustomAvatar = useRef(false);

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState("");
  const [customOutfitUrl, setCustomOutfitUrl] = useState("");
  const [generatedOutfits, setGeneratedOutfits] = useState<OutfitOption[]>([]);
  const creatorFrameRef = useRef<HTMLIFrameElement | null>(null);
  const outfitFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (lastObjectUrlRef.current) {
        URL.revokeObjectURL(lastObjectUrlRef.current);
        lastObjectUrlRef.current = null;
      }
    };
  }, []);

  const [outfitTransform, setOutfitTransform] = useState(DEFAULT_OUTFIT_TRANSFORM);
  const [fitStep, setFitStep] = useState<"coarse" | "normal" | "fine">("normal");
  const outfitBaseTransformRef = useRef<{
    position: THREE.Vector3;
    scale: THREE.Vector3;
    rotation: THREE.Euler;
  } | null>(null);

  const stepValue = fitStep === "fine" ? 0.001 : fitStep === "coarse" ? 0.05 : 0.01;
  const stepDeg = fitStep === "fine" ? 0.5 : fitStep === "coarse" ? 5 : 1;

  const captureOutfitBaseTransform = useCallback((object: THREE.Object3D) => {
    outfitBaseTransformRef.current = {
      position: object.position.clone(),
      scale: object.scale.clone(),
      rotation: object.rotation.clone(),
    };
  }, []);

  const autoFitOutfitToAvatar = useCallback(() => {
    const outfit = outfitRef.current;
    const avatarModel = avatarModelRef.current;
    if (!outfit || !avatarModel) {
      setError("Auto Fit 실패: 아바타/의상이 아직 로드되지 않았습니다.");
      return;
    }

    setError(null);

    const avatarBox = new THREE.Box3().setFromObject(avatarModel);
    const outfitBox = new THREE.Box3().setFromObject(outfit);

    const avatarSize = new THREE.Vector3();
    const outfitSize = new THREE.Vector3();
    avatarBox.getSize(avatarSize);
    outfitBox.getSize(outfitSize);

    const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 1);
    const scaleFactor =
      Math.min(
        safe(avatarSize.x) / safe(outfitSize.x),
        safe(avatarSize.y) / safe(outfitSize.y),
        safe(avatarSize.z) / safe(outfitSize.z),
      ) * 0.95;

    outfit.scale.multiplyScalar(scaleFactor);

    const avatarCenter = new THREE.Vector3();
    const outfitCenter = new THREE.Vector3();
    avatarBox.getCenter(avatarCenter);
    new THREE.Box3().setFromObject(outfit).getCenter(outfitCenter);

    const delta = new THREE.Vector3().subVectors(avatarCenter, outfitCenter);
    outfit.position.add(delta);

    setOutfitTransform(DEFAULT_OUTFIT_TRANSFORM);
    captureOutfitBaseTransform(outfit);
  }, [captureOutfitBaseTransform]);

  const nudgeFit = useCallback((delta: Partial<typeof DEFAULT_OUTFIT_TRANSFORM>) => {
    setOutfitTransform((t) => ({
      ...t,
      ...delta,
      posX: t.posX + (delta.posX ?? 0),
      posY: t.posY + (delta.posY ?? 0),
      posZ: t.posZ + (delta.posZ ?? 0),
      scale: t.scale + (delta.scale ?? 0),
      rotXDeg: t.rotXDeg + (delta.rotXDeg ?? 0),
      rotYDeg: t.rotYDeg + (delta.rotYDeg ?? 0),
      rotZDeg: t.rotZDeg + (delta.rotZDeg ?? 0),
    }));
  }, []);

  useEffect(() => {
    const outfit = outfitRef.current;
    if (!outfit) return;

    const base = outfitBaseTransformRef.current ?? {
      position: outfit.position.clone(),
      scale: outfit.scale.clone(),
      rotation: outfit.rotation.clone(),
    };
    outfitBaseTransformRef.current = base;

    outfit.position.set(
      base.position.x + outfitTransform.posX,
      base.position.y + outfitTransform.posY,
      base.position.z + outfitTransform.posZ,
    );

    outfit.scale.set(
      base.scale.x * outfitTransform.scale,
      base.scale.y * outfitTransform.scale,
      base.scale.z * outfitTransform.scale,
    );

    outfit.rotation.set(base.rotation.x, base.rotation.y, base.rotation.z);
    outfit.rotation.x += THREE.MathUtils.degToRad(outfitTransform.rotXDeg);
    outfit.rotation.y += THREE.MathUtils.degToRad(outfitTransform.rotYDeg);
    outfit.rotation.z += THREE.MathUtils.degToRad(outfitTransform.rotZDeg);
  }, [outfitTransform]);

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

  // Process image for background removal (Chroma Key)
  const processImageForTransparency = useCallback((imageUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageUrl;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(imageUrl);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        // Sample bg color from top-left pixel
        const bgR = data[0], bgG = data[1], bgB = data[2];
        const tolerance = 40;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const diff = Math.sqrt(
            Math.pow(r - bgR, 2) + Math.pow(g - bgG, 2) + Math.pow(b - bgB, 2)
          );
          if (diff < tolerance) {
            data[i + 3] = 0; // Set alpha to 0
          }
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(imageUrl);
    });
  }, []);

  const loadTextureOutfit = useCallback(
    (textureUrl: string) => {
      // const controls = controlsRef.current;
      // const camera = cameraRef.current;
      if (!avatarRef.current) return;

      setError(null);

      // Remove previous outfit
      if (outfitRef.current && avatarRef.current) {
        avatarRef.current.remove(outfitRef.current);
        outfitRef.current = null;
      }

      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(
        textureUrl,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;

          // Paper Doll Geometry (Billboard)
          const geometry = new THREE.PlaneGeometry(0.6, 0.75);
          const material = new THREE.MeshStandardMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide,
            alphaTest: 0.1,
            roughness: 0.6,
            metalness: 0.1
          });

          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(0, 1.35, 0.12);
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          outfitRef.current = mesh;
          avatarRef.current?.add(mesh);
          setOutfitTransform(DEFAULT_OUTFIT_TRANSFORM);
          captureOutfitBaseTransform(mesh);

          setLoading(null);
        },
        undefined,
        (err) => {
          console.error("Texture load error", err);
          setError("이미지 로드 실패");
          setLoading(null);
        }
      );
    },
    [captureOutfitBaseTransform]
  );

  const loadOutfit = useCallback(
    (outfit: OutfitOption) => {
      const controls = controlsRef.current;
      const camera = cameraRef.current;
      if (!controls || !avatarRef.current || !camera) return;

      setLoading("loading outfit...");
      setError(null);

      if (outfit.kind === "texture") {
        loadTextureOutfit(outfit.url);
        return;
      }

      // Remove previous outfit if processing procedural or GLB
      // (For texture, loadTextureOutfit handles it inside)
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
          setOutfitTransform(DEFAULT_OUTFIT_TRANSFORM);
          captureOutfitBaseTransform(cloned);
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
          setOutfitTransform(DEFAULT_OUTFIT_TRANSFORM);
          captureOutfitBaseTransform(cloned);
          fitCameraToObject(camera, controls, avatarRef.current);
          setLoading(null);
          return;
        }

        // Improved Basic Shirt (T-Shirt shape)
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({
          color: 0x98c1ff,
          metalness: 0.1,
          roughness: 0.6,
        });

        // Main Torso
        const torso = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.7, 0.3),
          bodyMat,
        );
        torso.position.set(0, 1.35, 0);
        torso.castShadow = true;
        torso.receiveShadow = true;
        group.add(torso);

        // Sleeves
        const sleeveMat = bodyMat.clone();
        const sleeveGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.25, 16);

        const leftSleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
        leftSleeve.rotation.z = Math.PI / 3;
        leftSleeve.position.set(-0.35, 1.55, 0);
        leftSleeve.castShadow = true;
        leftSleeve.receiveShadow = true;
        group.add(leftSleeve);

        const rightSleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
        rightSleeve.rotation.z = -Math.PI / 3;
        rightSleeve.position.set(0.35, 1.55, 0);
        rightSleeve.castShadow = true;
        rightSleeve.receiveShadow = true;
        group.add(rightSleeve);

        // Neck (optional, to hide gaps)
        const neck = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.1, 0.1, 16),
          bodyMat
        );
        neck.position.set(0, 1.65, 0);
        group.add(neck);

        outfitRef.current = group;
        avatarRef.current.add(group);
        setOutfitTransform(DEFAULT_OUTFIT_TRANSFORM);
        captureOutfitBaseTransform(group);
        fitCameraToObject(camera, controls, avatarRef.current);
        setLoading(null);
        return;
      }

      // Fallback GLB outfit loader
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
          setOutfitTransform(DEFAULT_OUTFIT_TRANSFORM);
          captureOutfitBaseTransform(gltf.scene);
          if (avatarRef.current) {
            fitCameraToObject(camera, controls, avatarRef.current);
          }
          setLoading(null);
        },
        undefined,
        (err) => {
          console.error("Outfit load error", err);
          const msg = String((err as any)?.message ?? err ?? "");
          if (/draco|decoder|No DRACOLoader instance/i.test(msg)) {
            setError(
              "의상 로드 실패: DRACO 압축 GLB일 수 있어요. (1) DRACO 디코더를 받을 수 있게 네트워크 허용 또는 (2) 디코더를 public 경로로 제공해야 합니다.",
            );
          } else {
            setError("의상 로드 실패 (GLB URL/CORS/파일 손상 가능)");
          }
          setLoading(null);
        }
      );
    },
    [captureOutfitBaseTransform, fitCameraToObject, loadTextureOutfit]
  );

  const loadAvatarFromUrl = useCallback(
    (url: string) => {
      const controls = controlsRef.current;
      const camera = cameraRef.current;
      if (!controls || !avatarRef.current || !camera) return;

      // START GUARD: Preserve custom avatar
      if (url === AVATAR_URL && isCustomAvatar.current) {
        console.log("Blocking default avatar load to preserve custom avatar.");
        return;
      }
      if (url !== AVATAR_URL && url !== "") {
        isCustomAvatar.current = true;
      }
      // END GUARD

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

            avatarModelRef.current = model;
            avatarRef.current.add(model);

            // Only fit camera if it's the INITIAL load or explicit user action, 
            // but for "Load GLB URL" we probably DO want to fit camera.
            fitCameraToObject(camera, controls, avatarRef.current);
          }
          setLoading(null);

          // Re-apply currently selected outfit
          const currentOutfit = OUTFITS.find((o) => o.id === outfitId) || generatedOutfits.find((o) => o.id === outfitId);
          if (currentOutfit) {
            loadOutfit(currentOutfit);
          }
        },
        undefined,
        (err) => {
          console.error("Avatar load error", err);
          const msg = String((err as any)?.message ?? err ?? "");
          if (/draco|decoder|No DRACOLoader instance/i.test(msg)) {
            setError(
              "아바타 로드 실패: DRACO 압축 GLB일 수 있어요. (1) DRACO 디코더를 받을 수 있게 네트워크 허용 또는 (2) 디코더를 public 경로로 제공해야 합니다.",
            );
          } else {
            setError("아바타 로드 실패 (GLB URL/CORS/파일 손상 가능)");
          }
          setLoading(null);
        },
      );
    },
    [fitCameraToObject, loadOutfit, outfitId, generatedOutfits],
  );

  // Initialize Scene
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
      },
      undefined,
      (err) => {
        console.error("HDR load error", err);
        setError("HDRI 환경맵 로드 실패 (계속 진행합니다)");
      },
    );

    const avatarRoot = new THREE.Group();
    avatarRoot.position.set(0, -1.1, 0);
    scene.add(avatarRoot);
    avatarRef.current = avatarRoot;

    // Load initial avatar immediately if we want
    // But better to let the other useEffect handle it to respect isCustomAvatar logic
    // actually, we need at least an empty avatar root.

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
  }, []);

  // Initial Avatar Load
  useEffect(() => {
    if (hasLoadedInitialAvatar.current) return;
    // We wait for ref to be populated by the scene init effect
    // A small timeout ensures the scene is ready
    const timer = window.setTimeout(() => {
      if (avatarRef.current) {
        hasLoadedInitialAvatar.current = true;
        loadAvatarFromUrl(AVATAR_URL);
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [loadAvatarFromUrl]);

  // Handle Profile Changes
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

  // Handle RPM Events
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
            onClick={() => setSidebarTab("magic")}
            className={`flex-1 py-4 text-sm font-semibold uppercase tracking-wide transition-colors ${sidebarTab === "magic"
              ? "border-b-2 border-primary text-white"
              : "text-zinc-500 hover:text-zinc-300"
              }`}
          >
            Magic 2D
          </button>
          <button
            onClick={() => setSidebarTab("body")}
            className={`flex-1 py-4 text-sm font-semibold uppercase tracking-wide transition-colors ${sidebarTab === "body"
              ? "border-b-2 border-white text-white"
              : "text-zinc-500 hover:text-zinc-300"
              }`}
          >
            Body
          </button>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          {sidebarTab === "clothes" && (
            <div className="flex flex-col gap-8">
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Presets
                </h3>
                <p className="text-xs text-zinc-400">
                  아래 프리셋은 “진짜 의상 리깅”이 아니라, 아바타 위에 오버레이로 올리는 데모입니다.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {OUTFITS.map((item) => {
                    const isActive = outfitId === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setOutfitId(item.id);
                          loadOutfit(item);
                        }}
                        className={`rounded-xl border px-3 py-3 text-left text-xs font-medium transition-all ${isActive
                          ? "border-white bg-white/10 ring-1 ring-white/40"
                          : "border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10"
                          }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4 border-t border-white/10 pt-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Load Outfit GLB
                </h3>
                <div className="space-y-2">
                  <label className="text-xs text-zinc-400">GLB URL (의상)</label>
                  <div className="flex gap-2">
                    <input
                      value={customOutfitUrl}
                      onChange={(e) => setCustomOutfitUrl(e.target.value)}
                      placeholder="https://.../outfit.glb"
                      className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-white/30"
                    />
                    <button
                      onClick={() => {
                        const url = customOutfitUrl.trim();
                        if (!url) return;
                        const option: OutfitOption = {
                          id: `glb-${Date.now()}`,
                          label: "Custom GLB",
                          kind: "glb",
                          url,
                        };
                        setOutfitId(option.id);
                        loadOutfit(option);
                      }}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20"
                    >
                      Wear
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2">
                    <input
                      ref={outfitFileInputRef}
                      type="file"
                      accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        setError(null);
                        setLoading("loading outfit file...");

                        if (lastObjectUrlRef.current) {
                          URL.revokeObjectURL(lastObjectUrlRef.current);
                          lastObjectUrlRef.current = null;
                        }

                        const objectUrl = URL.createObjectURL(file);
                        lastObjectUrlRef.current = objectUrl;

                        const option: OutfitOption = {
                          id: `file-${Date.now()}`,
                          label: file.name,
                          kind: "glb",
                          url: objectUrl,
                        };
                        setOutfitId(option.id);
                        loadOutfit(option);

                        e.currentTarget.value = "";
                      }}
                    />
                    <button
                      onClick={() => outfitFileInputRef.current?.click()}
                      className="w-full rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      Upload GLB File
                    </button>
                  </div>
                  <p className="text-[11px] leading-4 text-zinc-500">
                    참고: 자연스럽게 “입히려면” 의상 GLB가 아바타 스켈레톤과 호환되는 SkinnedMesh여야 합니다. 아니면 아래 오프셋으로 대략 맞추는 방식만 가능합니다.
                  </p>
                </div>
              </div>

              <div className="space-y-4 border-t border-white/10 pt-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Fit (Offset)
                </h3>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      {(["coarse", "normal", "fine"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setFitStep(mode)}
                          className={`rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-all ${fitStep === mode
                            ? "bg-white text-black"
                            : "bg-white/10 text-white hover:bg-white/20"
                            }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={autoFitOutfitToAvatar}
                      className="rounded-md bg-blue-600/80 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-600"
                    >
                      Auto Fit
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Position X</span>
                      <span className="text-white">{outfitTransform.posX.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={-2}
                      max={2}
                      step={stepValue}
                      value={outfitTransform.posX}
                      onChange={(e) =>
                        setOutfitTransform((t) => ({ ...t, posX: Number(e.target.value) }))
                      }
                      className="h-1.5 w-full appearance-none rounded-full bg-white/10 outline-none hover:bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Position Y</span>
                      <span className="text-white">{outfitTransform.posY.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={-2}
                      max={2}
                      step={stepValue}
                      value={outfitTransform.posY}
                      onChange={(e) =>
                        setOutfitTransform((t) => ({ ...t, posY: Number(e.target.value) }))
                      }
                      className="h-1.5 w-full appearance-none rounded-full bg-white/10 outline-none hover:bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Position Z</span>
                      <span className="text-white">{outfitTransform.posZ.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={-2}
                      max={2}
                      step={stepValue}
                      value={outfitTransform.posZ}
                      onChange={(e) =>
                        setOutfitTransform((t) => ({ ...t, posZ: Number(e.target.value) }))
                      }
                      className="h-1.5 w-full appearance-none rounded-full bg-white/10 outline-none hover:bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Scale</span>
                      <span className="text-white">{outfitTransform.scale.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min={0.01}
                      max={10}
                      step={stepValue}
                      value={outfitTransform.scale}
                      onChange={(e) =>
                        setOutfitTransform((t) => ({ ...t, scale: Number(e.target.value) }))
                      }
                      className="h-1.5 w-full appearance-none rounded-full bg-white/10 outline-none hover:bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Rotate X</span>
                      <span className="text-white">{outfitTransform.rotXDeg.toFixed(0)}°</span>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={stepDeg}
                      value={outfitTransform.rotXDeg}
                      onChange={(e) =>
                        setOutfitTransform((t) => ({ ...t, rotXDeg: Number(e.target.value) }))
                      }
                      className="h-1.5 w-full appearance-none rounded-full bg-white/10 outline-none hover:bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Rotate Y</span>
                      <span className="text-white">{outfitTransform.rotYDeg.toFixed(0)}°</span>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={stepDeg}
                      value={outfitTransform.rotYDeg}
                      onChange={(e) =>
                        setOutfitTransform((t) => ({ ...t, rotYDeg: Number(e.target.value) }))
                      }
                      className="h-1.5 w-full appearance-none rounded-full bg-white/10 outline-none hover:bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Rotate Z</span>
                      <span className="text-white">{outfitTransform.rotZDeg.toFixed(0)}°</span>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={stepDeg}
                      value={outfitTransform.rotZDeg}
                      onChange={(e) =>
                        setOutfitTransform((t) => ({ ...t, rotZDeg: Number(e.target.value) }))
                      }
                      className="h-1.5 w-full appearance-none rounded-full bg-white/10 outline-none hover:bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2">
                    <button
                      onClick={() => nudgeFit({ posY: stepValue })}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      Y+
                    </button>
                    <button
                      onClick={() => nudgeFit({ posZ: -stepValue })}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      Z-
                    </button>
                    <button
                      onClick={() => nudgeFit({ scale: stepValue })}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      S+
                    </button>

                    <button
                      onClick={() => nudgeFit({ posX: -stepValue })}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      X-
                    </button>
                    <button
                      onClick={() => setOutfitTransform(DEFAULT_OUTFIT_TRANSFORM)}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      Reset
                    </button>
                    <button
                      onClick={() => nudgeFit({ posX: stepValue })}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      X+
                    </button>

                    <button
                      onClick={() => nudgeFit({ posY: -stepValue })}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      Y-
                    </button>
                    <button
                      onClick={() => nudgeFit({ posZ: stepValue })}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      Z+
                    </button>
                    <button
                      onClick={() => nudgeFit({ scale: -stepValue })}
                      className="rounded-md bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      S-
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      setOutfitTransform(DEFAULT_OUTFIT_TRANSFORM);
                      setError(null);
                    }}
                    className="w-full rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    Reset Fit
                  </button>
                </div>
              </div>
            </div>
          )}

          {sidebarTab === "magic" && (
            <div className="flex flex-col gap-6">
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  2D to 3D Outfit
                </h3>
                <p className="text-xs text-zinc-400">
                  Upload a 2D image (PNG/JPG) to instantly wrap it onto the 3D shirt.
                </p>

                <div className="flex w-full items-center justify-center">
                  <label className="flex h-64 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 bg-black/20 hover:border-white hover:bg-black/30 transition-all">
                    <div className="flex flex-col items-center justify-center pb-6 pt-5">
                      <svg className="mb-4 h-8 w-8 text-zinc-500" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" />
                      </svg>
                      <p className="mb-2 text-sm text-zinc-400"><span className="font-semibold text-white">Click to upload</span></p>
                      <p className="text-xs text-zinc-500">PNG, JPG (MAX. 5MB)</p>
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/png, image/jpeg"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = URL.createObjectURL(file);
                          // Dont block UI with global loading for this background process
                          // But maybe show a toast or local indicator? 
                          // For now just do it.

                          try {
                            // Process image (magic 2d)
                            const processedUrl = await processImageForTransparency(url);

                            const newOutfit: OutfitOption = {
                              id: `gen-${Date.now()}`,
                              label: `Generated Item ${generatedOutfits.length + 1}`,
                              kind: 'texture',
                              url: processedUrl
                            };

                            setGeneratedOutfits(prev => [newOutfit, ...prev]);

                            // DO NOT AUTO WEAR
                            // setOutfitId(newOutfit.id);
                            // loadTextureOutfit(processedUrl);

                          } catch (err) {
                            console.error(err);
                            setError("Error processing image");
                          }
                        }
                      }}
                    />
                  </label>
                </div>

                {/* Generated List */}
                {generatedOutfits.length > 0 && (
                  <div className="space-y-3 border-t border-white/10 pt-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      Generated Items
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      {generatedOutfits.map((item) => {
                        const isActive = outfitId === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              setOutfitId(item.id);
                              loadOutfit(item);
                            }}
                            className={`group relative flex aspect-[3/4] flex-col items-center justify-end overflow-hidden rounded-xl border transition-all duration-300 ${isActive
                              ? "border-white bg-white/10 ring-1 ring-white/50"
                              : "border-white/5 bg-white/5 hover:border-white/20 hover:bg-white/10"
                              }`}
                          >
                            <div
                              className="absolute inset-0 bg-cover bg-center opacity-70 transition-opacity group-hover:opacity-100"
                              style={{ backgroundImage: `url(${item.kind === 'texture' ? item.url : ''})` }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />

                            <div className="relative w-full p-3 pt-8 text-center z-10">
                              <span className={`block text-xs font-medium ${isActive ? "text-white" : "text-zinc-300"}`}>
                                {item.label}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
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
