"use client";

import Link from "next/link";
import { LogoMark } from "@/components/Icons";
import { useToast } from "@/lib/toast";
import { shortPrincipal, useWallet } from "@/lib/wallet";

export function SiteHeader() {
  const toast = useToast();
  const { token, principal, displayName, connecting, connectSphere, disconnect } = useWallet();

  async function onConnect() {
    // Keep this handler sync-to-await so Sphere's window.open stays in the click gesture
    try {
      await connectSphere();
      toast.success("Sphere connected", "You’re ready to mint or launch with UCT.");
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <header className="site-header">
      <div className="shell site-header-inner">
        <Link href="/" className="brand">
          <LogoMark className="brand-mark" />
          <span className="brand-word">
            Uni<span>pad</span>
          </span>
        </Link>
        <nav className="nav">
          <Link href="/drops">Drops</Link>
          <Link href="/launch">Create</Link>
          {principal ? <Link href="/wallet">My mints</Link> : null}
          {principal ? <Link href="/royalties">Earnings</Link> : null}
        </nav>
        <div className="header-actions">
          {token && principal ? (
            <>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {displayName ?? shortPrincipal(principal)}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  disconnect();
                  toast.info("Signed out");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={connecting}
              onClick={onConnect}
              title="Opens Sphere wallet (extension or popup)"
            >
              {connecting ? "Opening Sphere…" : "Connect Sphere"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
