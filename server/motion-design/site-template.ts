/**
 * The Motion Design site scaffold.
 *
 * A standalone `index.html` opened via `file://` is why earlier slide
 * animations did not play: ScrollTrigger was often never registered, scripts
 * loaded in the wrong order, and there was no real HTTP origin or pin/scroller
 * setup. This Next.js App Router starter is served by `next dev`/`next start`,
 * and registers GSAP plugins only on the client inside `useGSAP`.
 */

export function motionSiteTemplate(name: string): Record<string, string> {
  const title = name.trim() || "Motion site";
  return {
    "package.json": `${JSON.stringify(
      {
        name: slug(title),
        private: true,
        version: "0.1.0",
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
          lint: "next lint",
        },
        dependencies: {
          "@gsap/react": "^2.1.2",
          "@react-three/drei": "^10.0.0",
          "@react-three/fiber": "^9.1.0",
          gsap: "^3.12.7",
          "framer-motion": "^12.0.0",
          next: "^15.2.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          three: "^0.174.0",
        },
        devDependencies: {
          "@types/node": "^22.0.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          "@types/three": "^0.174.0",
          typescript: "^5.8.0",
        },
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      },
      null,
      2,
    )}\n`,
    "next.config.ts": `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`,
    "next-env.d.ts": `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`,
    "app/globals.css": `:root {
  color-scheme: dark;
  --bg: #0c0d0b;
  --ink: #f4efe4;
  --muted: #b7b1a3;
}

* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); }
body { font-family: Georgia, "Times New Roman", serif; }
a { color: inherit; }
`,
    "app/layout.tsx": `import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: ${JSON.stringify(title)},
  description: "A cinematic motion site.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    "app/page.tsx": `import { Scene } from "@/components/scene";
import { ScrollFilm } from "@/components/scroll-film";

export default function Page() {
  return (
    <main>
      <ScrollFilm />
      <Scene />
    </main>
  );
}
`,
    "components/scroll-film.tsx": `"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motion } from "framer-motion";
import { useRef } from "react";

/**
 * Why a standalone index.html did not animate
 * ------------------------------------------
 * Opening the file via file:// has no HTTP origin, so ES-module CDNs and
 * ScrollTrigger's scroll measurements often fail. Scripts that listed
 * ScrollTrigger before GSAP, or never called gsap.registerPlugin(ScrollTrigger),
 * left every tween as a no-op. Pinning also needs an end distance — without
 * \`end: "+=200%"\` and a real document scroller there is nothing to scrub.
 *
 * Register plugins only after mount (useGSAP / useEffect). Doing it at module
 * top-level breaks under the App Router because \`window\` is missing on the server.
 */
export function ScrollFilm() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.registerPlugin(ScrollTrigger);
      const slides = gsap.utils.toArray<HTMLElement>(".slide");
      slides.forEach((slide) => {
        gsap.fromTo(
          slide.querySelector(".slide-inner"),
          { y: 80, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: slide,
              start: "top 75%",
              end: "top 25%",
              scrub: true,
            },
          },
        );
      });
      ScrollTrigger.create({
        trigger: root.current,
        start: "top top",
        end: "+=200%",
        pin: true,
        scrub: 1,
        anticipatePin: 1,
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="film">
      <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
        ${escapeJsxText(title)}
      </motion.h1>
      <div className="slide">
        <div className="slide-inner">
          <p>Start frame. Replace this copy with the approved journey.</p>
        </div>
      </div>
      <div className="slide">
        <div className="slide-inner">
          <p>Mid journey. ScrollTrigger is registered on the client.</p>
        </div>
      </div>
      <div className="slide">
        <div className="slide-inner">
          <p>End frame. Run \`npm run dev\` — do not open these files via file://.</p>
        </div>
      </div>
      <style>{\`
        .film { min-height: 100vh; padding: 12vh 8vw 40vh; }
        .film h1 { font-size: clamp(2.4rem, 7vw, 6rem); margin: 0 0 12vh; }
        .slide { min-height: 70vh; display: flex; align-items: center; }
        .slide-inner { max-width: 36rem; font-size: 1.4rem; line-height: 1.45; }
      \`}</style>
    </section>
  );
}
`,
    "components/scene.tsx": `"use client";

import { Canvas } from "@react-three/fiber";
import { Float } from "@react-three/drei";

export function Scene() {
  return (
    <div style={{ height: "80vh" }} aria-hidden="true">
      <Canvas camera={{ position: [0, 0, 4] }}>
        <color attach="background" args={["#0c0d0b"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 2]} intensity={1.2} />
        <Float speed={1.4} rotationIntensity={0.4} floatIntensity={0.6}>
          <mesh>
            <icosahedronGeometry args={[1.1, 0]} />
            <meshStandardMaterial color="#f4efe4" wireframe />
          </mesh>
        </Float>
      </Canvas>
    </div>
  );
}
`,
    "README.md": `# ${title}

Motion Design site. Scaffolded by AgentOS as a Next.js App Router (TypeScript) project.

\`\`\`
npm install
npm run dev
\`\`\`

Open http://localhost:3000. Do not open the files via \`file://\` — GSAP ScrollTrigger needs a real origin and a document scroller.

## Motion stack

- **GSAP + ScrollTrigger** — registered in \`useGSAP\` on the client (\`components/scroll-film.tsx\`)
- **Three.js** via \`@react-three/fiber\` (\`components/scene.tsx\`)
- **Framer Motion** for UI entrance

The \`motion-site-studio\` skill fills this starter from the brief. Credit approval still happens in AgentOS before any Higgsfield spend.
`,
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "motion-site";
}

function escapeJsxText(value: string): string {
  return value.replace(/[&<>{}]/g, "");
}
