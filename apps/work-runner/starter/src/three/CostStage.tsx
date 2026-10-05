import { ThreeCanvas } from "@remotion/three";

type CostStageProps = {
  value: number;
  progress: number;
  width: number;
  height: number;
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function CostModel({ value, progress }: Pick<CostStageProps, "value" | "progress">) {
  const usage = clamp(value / 100);
  const spin = progress * Math.PI * 2;
  const cardRotation: [number, number, number] = [0.12 + progress * 0.18, spin, -0.08];
  const cardScale = 0.92 + Math.sin(progress * Math.PI * 2) * 0.035;

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight castShadow intensity={2.1} position={[4, 6, 6]} />
      <pointLight color="#e26f45" intensity={12} distance={8} position={[-3, 1, 2]} />
      <pointLight color="#8fc3ff" intensity={10} distance={10} position={[3, 1, -3]} />

      <mesh position={[0, -1.65, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color="#111b27" roughness={0.82} metalness={0.12} />
      </mesh>
      <gridHelper args={[14, 28, "#304153", "#1b2938"]} position={[0, -1.63, 0]} />

      <group position={[0, 0.05, 0]}>
        <mesh castShadow position={[0, 0.14, 0]} rotation={cardRotation} scale={cardScale}>
          <boxGeometry args={[2.8, 1.75, 0.24]} />
          <meshStandardMaterial color="#edf4e9" metalness={0.5} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.14, 0.14]} rotation={cardRotation} scale={cardScale * 1.002}>
          <boxGeometry args={[2.45, 1.4, 0.015]} />
          <meshStandardMaterial color="#182534" metalness={0.16} roughness={0.46} />
        </mesh>

        <mesh position={[0, 0.14, 0.3]} rotation={[0, 0, spin * 0.12]}>
          <torusGeometry args={[0.7, 0.035, 16, 96, Math.max(0.05, usage * Math.PI * 2)]} />
          <meshStandardMaterial
            color="#e26f45"
            emissive="#7c2e1b"
            emissiveIntensity={1.25}
            metalness={0.42}
            roughness={0.26}
          />
        </mesh>
        <mesh position={[0, 0.14, 0.31]} rotation={[0, 0, -spin * 0.18]}>
          <torusGeometry
            args={[0.48, 0.018, 12, 72, Math.max(0.05, (1 - usage) * Math.PI * 2)]}
          />
          <meshStandardMaterial color="#8fc3ff" emissive="#1d5f9a" emissiveIntensity={1.1} />
        </mesh>

        {[0, 1, 2].map((index) => {
          const angle = spin * (0.7 + index * 0.16) + index * ((Math.PI * 2) / 3);
          return (
            <mesh
              key={index}
              castShadow
              position={[Math.cos(angle) * 1.55, 0.18 + Math.sin(angle * 1.4) * 0.35, Math.sin(angle) * 1.55]}
              scale={0.7 + usage * 0.35}
            >
              <sphereGeometry args={[0.11, 20, 20]} />
              <meshStandardMaterial
                color={index === 1 ? "#e26f45" : "#b7d7ff"}
                emissive={index === 1 ? "#7c2e1b" : "#1d5f9a"}
                emissiveIntensity={1.4}
                metalness={0.6}
                roughness={0.2}
              />
            </mesh>
          );
        })}
      </group>
    </>
  );
}

export function CostStage({ value, progress, width, height }: CostStageProps) {
  return (
    <ThreeCanvas
      width={width}
      height={height}
      orthographic={false}
      camera={{ fov: 32, position: [0, 1.1, 8] }}
      shadows
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#0c121b"]} />
      <fog attach="fog" args={["#0c121b", 7, 16]} />
      <CostModel value={value} progress={progress} />
    </ThreeCanvas>
  );
}
