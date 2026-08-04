"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { m } from "framer-motion";
import { IconPortrait, LogoMark } from "@/components/Icons";
import { useToast } from "@/lib/toast";
import { shortPrincipal, useWallet } from "@/lib/wallet";
import { slideDown, springSnappy } from "@/lib/motion";

export function SiteHeader() {
  const toast = useToast();
  const pathname = usePathname();
  const { token, principal, displayName, connecting, connectSphere, disconnect } = useWallet();
  /** Drop detail / mint pages — e.g. /drops/nova-trinket */
  const onMintPage = /^\/drops\/[^/]+\/?$/.test(pathname || "");

  async function onConnect() {
    try {
      await connectSphere();
      toast.success("Sphere connected", "You’re ready to mint or launch with UCT.");
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <m.header
      className="site-header"
      variants={slideDown}
      initial="hidden"
      animate="show"
    >
      <div className="shell site-header-inner">
        <m.div whileHover={{ scale: 1.02 }} transition={springSnappy}>
          <Link href="/" className="brand">
            <LogoMark className="brand-mark" />
            <span className="brand-word">
              Uni<span>pad</span>
            </span>
          </Link>
        </m.div>
        <nav className="nav">
          <Link href="/drops">Drops</Link>
          <Link href="/launch">Create</Link>
          {principal ? <Link href="/wallet">My mints</Link> : null}
          {principal ? <Link href="/royalties">Earnings</Link> : null}
        </nav>
        <div className="header-actions">
          {token && principal ? (
            <>
              <m.div
                className="user-chip"
                title={displayName ?? principal}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={springSnappy}
              >
                <IconPortrait className="user-portrait" />
                <span className="user-chip-name">
                  {displayName ?? shortPrincipal(principal)}
                </span>
              </m.div>
              <m.button
                type="button"
                className={onMintPage ? "btn btn-primary" : "btn btn-ghost"}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                transition={springSnappy}
                onClick={() => {
                  disconnect();
                  toast.info("Signed out");
                }}
              >
                Sign out
              </m.button>
            </>
          ) : (
            <m.button
              type="button"
              className="btn btn-primary"
              disabled={connecting}
              whileHover={connecting ? undefined : { y: -1 }}
              whileTap={connecting ? undefined : { scale: 0.98 }}
              transition={springSnappy}
              onClick={onConnect}
              title="Opens Sphere wallet (extension or popup)"
            >
              {connecting ? "Opening Sphere…" : "Connect Sphere"}
            </m.button>
          )}
        </div>
      </div>
    </m.header>
  );
}
