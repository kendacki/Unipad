"use client";

import Link from "next/link";
import { LogoMark } from "@/components/Icons";
import { useToast } from "@/lib/toast";
import { ALLOW_DEV_MOCK } from "@/lib/sphereConnect";
import { shortPrincipal, useWallet } from "@/lib/wallet";

export function SiteHeader() {
  const toast = useToast();
  const { token, principal, displayName, connecting, connectSphere, connectMock, disconnect, mock } =
    useWallet();

  async function onConnect() {
    // Keep this handler sync-to-await so Sphere's window.open stays in the click gesture
    try {
      const result = await connectSphere();
      if (result.mock) {
        toast.info(
          "Demo wallet connected",
          result.reason ?? "Sphere’s hosted wallet blocks localhost — using demo mode.",
        );
        return;
      }
      toast.success("Sphere connected", "You’re ready to mint or launch with UCT.");
    } catch (err) {
      toast.error(err);
    }
  }

  async function onDemo() {
    try {
      await connectMock("buyer");
      toast.success("Demo wallet", "Local mock session — mint and launch without Sphere.");
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
                {mock ? " · demo" : ""}
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
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={connecting}
                onClick={onConnect}
                title="Opens Sphere wallet (extension or popup)"
              >
                {connecting ? "Opening Sphere…" : "Connect Sphere"}
              </button>
              {ALLOW_DEV_MOCK ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={connecting}
                  onClick={onDemo}
                  title="Local demo wallet — Sphere popup is blocked on localhost"
                >
                  Demo wallet
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
