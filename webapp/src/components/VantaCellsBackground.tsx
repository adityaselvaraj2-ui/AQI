import { useEffect, useRef } from "react";
import * as THREE from "three";

interface VantaCellsProps {
  color1?: number;
  color2?: number;
  size?: number;
  speed?: number;
  opacity?: number;
}

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 iResolution;
uniform vec2 iMouse;
uniform float iTime;
uniform vec3 color1;
uniform vec3 color2;
uniform float size;

float length2(vec2 p) { return dot(p, p); }

float noise(vec2 p) {
    return fract(sin(fract(sin(p.x) * 43.13311) + p.y) * 31.0011);
}

float worley(vec2 p) {
    float d = 1e30;
    for (int xo = -1; xo <= 1; ++xo) {
        for (int yo = -1; yo <= 1; ++yo) {
            vec2 tp = floor(p) + vec2(float(xo), float(yo));
            d = min(d, length2(p - tp - vec2(noise(tp))));
        }
    }
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    float timeOffset = 0.15 * sin(iTime * 2.0 + 10.0 * (uv.x - uv.y));
    return 3.0 * exp(-4.0 * abs(2.0 * d - 1.0 + timeOffset));
}

float fworley(vec2 p) {
    return sqrt(sqrt(sqrt(
        1.1 *
        worley(p * 5.0 + 0.3 + iTime * 0.0525) *
        sqrt(worley(p * 50.0 / size + 0.3 + iTime * -0.15)) *
        sqrt(sqrt(worley(p * -10.0 + 9.3)))
    )));
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 mouseOffset = (iMouse - 0.5) * 0.15;
    float t = fworley((uv + mouseOffset) * iResolution.xy / 1500.0);
    t *= exp(-length2(abs(0.7 * uv - 1.0)));

    float tExp = pow(t, 0.5 - t);
    vec3 c1 = color1 * (1.0 - t);
    vec3 c2 = color2 * tExp;

    gl_FragColor = vec4(pow(t, 1.0 - t) * (c1 + c2), 1.0);
}
`;

export function VantaCellsBackground({
  color1 = 0x3dbdbd,
  color2 = 0xcdeae8,
  size = 1.0,
  speed = 2.8,
  opacity = 0.72,
}: VantaCellsProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 300;
    const height = container.clientHeight || 200;

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    camera.position.z = 1;

    const c1 = new THREE.Color(color1);
    const c2 = new THREE.Color(color2);

    const uniforms = {
      iResolution: { value: new THREE.Vector2(width, height) },
      iMouse: { value: new THREE.Vector2(0.5, 0.5) },
      iTime: { value: 0 },
      color1: { value: new THREE.Vector3(c1.r, c1.g, c1.b) },
      color2: { value: new THREE.Vector3(c2.r, c2.g, c2.b) },
      size: { value: size },
    };

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.left = "0";
    renderer.domElement.style.pointerEvents = "none";
    renderer.domElement.style.opacity = String(opacity);

    container.appendChild(renderer.domElement);

    // Mouse & Touch tracking
    let targetMouseX = 0.5;
    let targetMouseY = 0.5;
    let currentMouseX = 0.5;
    let currentMouseY = 0.5;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const rect = container.getBoundingClientRect();
      const clientX = "touches" in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
      const clientY = "touches" in e ? (e.touches[0]?.clientY ?? 0) : e.clientY;
      if (rect.width > 0 && rect.height > 0) {
        targetMouseX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        targetMouseY = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      }
    };

    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    window.addEventListener("touchmove", handlePointerMove, { passive: true });

    // ResizeObserver for dynamic responsiveness
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          renderer.setSize(w, h);
          uniforms.iResolution.value.set(w * dpr, h * dpr);
        }
      }
    });
    resizeObserver.observe(container);

    let animId: number;
    let prevTime = performance.now();

    const animate = (now: number) => {
      const delta = (now - prevTime) / 1000;
      prevTime = now;

      // Advance time with requested speed (2.80)
      uniforms.iTime.value += delta * speed * 0.7;

      // Smooth mouse interpolation
      currentMouseX += (targetMouseX - currentMouseX) * 0.05;
      currentMouseY += (targetMouseY - currentMouseY) * 0.05;
      uniforms.iMouse.value.set(currentMouseX, currentMouseY);

      renderer.render(scene, camera);
      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("touchmove", handlePointerMove);
      resizeObserver.disconnect();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [color1, color2, size, speed, opacity]);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{
        maskImage: "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 72%, rgba(0,0,0,0.35) 90%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 72%, rgba(0,0,0,0.35) 90%, transparent 100%)",
      }}
    />
  );
}
