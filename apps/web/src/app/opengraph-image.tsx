import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const alt = "Unipad — Launch & mint NFTs on Unicity";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social / link-preview image shown when the Vercel URL is shared. */
export default async function OpenGraphImage() {
  let heroSrc: string | null = null;
  try {
    const bytes = await readFile(join(process.cwd(), "public", "hero-character.png"));
    heroSrc = `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    heroSrc = null;
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "linear-gradient(135deg, #111111 0%, #0a0a0a 55%, #1a0f08 100%)",
          color: "#ffffff",
          fontFamily: "Arial, sans-serif",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 520,
            height: 520,
            borderRadius: 999,
            background: "rgba(255, 106, 0, 0.18)",
            left: -80,
            bottom: -120,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 360,
            height: 360,
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.05)",
            right: 40,
            top: -80,
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "64px 56px",
            width: heroSrc ? "58%" : "100%",
            gap: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 800,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            <span>Uni</span>
            <span style={{ color: "#FF6A00" }}>pad</span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: "rgba(255,255,255,0.88)",
              lineHeight: 1.35,
              maxWidth: 560,
            }}
          >
            Launch an NFT drop or mint one with UCT. Fair minting on Unicity.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 12,
              fontSize: 20,
              color: "#FF6A00",
              fontWeight: 700,
            }}
          >
            Pay with UCT · No gas wars
          </div>
        </div>

        {heroSrc ? (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              width: "42%",
              height: "100%",
              paddingRight: 24,
              paddingBottom: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroSrc}
              alt=""
              width={460}
              height={540}
              style={{
                objectFit: "contain",
                objectPosition: "bottom center",
              }}
            />
          </div>
        ) : null}
      </div>
    ),
    { ...size },
  );
}
