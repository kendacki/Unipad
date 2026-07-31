import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon — Unipad brand mark. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0A0A",
          borderRadius: 36,
          color: "#FF6A00",
          fontSize: 110,
          fontWeight: 800,
          fontFamily: "Arial, sans-serif",
          letterSpacing: -4,
        }}
      >
        U
      </div>
    ),
    { ...size },
  );
}
