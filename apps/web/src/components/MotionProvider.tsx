"use client";

import { MotionConfig, LazyMotion, domAnimation } from "framer-motion";
import type { ReactNode } from "react";

/** Enables reduced-motion respect + lighter animation features site-wide. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
