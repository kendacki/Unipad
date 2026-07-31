import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Tab icon — black pad + orange accent (Unipad brand). */
export default function Icon() {
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
          borderRadius: 6,
          color: "#FF6A00",
          fontSize: 20,
          fontWeight: 800,
          fontFamily: "Arial, sans-serif",
          letterSpacing: -1,
        }}
      >
        U
      </div>
    ),
    { ...size },
  );
}
