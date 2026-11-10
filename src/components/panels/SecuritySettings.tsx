"use client";

import { useQuery } from "@tanstack/react-query";
import { useCapabilities } from "@/lib/client/hooks";
import { usePrivate, useSettings, useSettingsReady, useWallet } from "@/lib/client/stores";
import { GOVERNED_PROGRAMS, readProgramAuthority } from "@/lib/client/governance";
import { shortAddress } from "@/lib/tokens/sanitize";
import { ModulePanel } from "@/components/shell/ModulePanel";
import { Row, Segmented, Toggle } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { Select } from "./common";
import styles from "./panels.module.css";

export function SecuritySettings() {
  const s = useSettings();
  const priv = usePrivate();
  const caps = useCapabilities();
  return (
    <ModulePanel id="settings" title="Settings and security" lead="Preferences are kept in this browser. Keys, balances and history never are.">
      <section className={styles.section} aria-labelledby="pref-h">
        <h2 id="pref-h" className={styles.h2}>
          Preferences
        </h2>
        <Toggle checked={s.maskBalances} onChange={s.setMaskBalances} label="Hide amounts" description="Replaces balances and amounts with a tint everywhere, including previews." />
        <Toggle
          checked={s.demoMode}
          onChange={s.setDemoMode}
          label="Demo mode"
          description="Made-up balances, rates and quotes for presentation. Cannot sign or send anything, and is marked on every screen."
        />
        <div style={{ display: "grid", gap: 12, paddingTop: 8 }}>
          <div>
            <span className={styles.fieldLabel}>Network</span>
            <Segmented
              label="Network"
              value={s.network}
              onChange={s.setNetwork}
              options={[
                { value: "mainnet", label: "Mainnet" },
                { value: "devnet", label: "Devnet" },
              ]}
            />
            <p className={styles.hint} style={{ marginTop: 6 }}>
              Swaps and Jupiter Lend are mainnet only. Changing network locks the private balance and clears protected views.
            </p>
          </div>
          <Select
            label="Lock the private balance after inactivity"
            value={String(s.lockAfterMinutes)}
            onChange={(v) => s.setLockAfterMinutes(Number(v))}
            options={[
              { value: "0", label: "When this tab is hidden" },
              { value: "1", label: "1 minute" },
              { value: "5", label: "5 minutes" },
              { value: "10", label: "10 minutes" },
              { value: "30", label: "30 minutes" },
            ]}
          />
          <div>
            <button type="button" className="btn" disabled={priv.status === "locked"} onClick={() => priv.lock("Locked.")}>
              <Icon name="lock" size={16} /> Lock now
            </button>
          </div>
        </div>
      </section>

      <RecoveryFlow />

      <section className={styles.section} aria-labelledby="perm-h">
        <h2 id="perm-h" className={styles.h2} style={{ marginBottom: 8 }}>
          Permissions
        </h2>
        <dl>
          <Row label="Viewing access granted">None. Decryption happens in this tab.</Row>
          <Row label="Proof generation">Helius prover in an attested Nitro enclave; requests are encrypted to it</Row>
          <Row label="Spending">Only your wallet's signature, per transaction</Row>
          <Row label="Analytics">None on any screen</Row>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="providers-h">
        <div className={styles.sectionHead}>
          <h2 id="providers-h" className={styles.h2}>
            Providers on this deployment
          </h2>
          <span className={styles.meta}>{caps.data ? `Checked ${caps.data.verifiedOn}` : ""}</span>
        </div>
        {caps.isError ? (
          <p className={styles.meta}>The server's configuration could not be read.</p>
        ) : caps.data ? (
          <dl>
            <Row label="Swap routing">Jupiter Swap API v2 ({caps.data.jupiter.keyed ? "API key set" : "keyless, low rate limit"})</Row>
            <Row label="Private balances, devnet" tone={caps.data.privacy.devnet.enabled ? "accent" : "muted"}>
              {caps.data.privacy.devnet.enabled ? `Enabled (${caps.data.privacy.sdk})` : (caps.data.privacy.devnet.reason ?? "Off")}
            </Row>
            <Row label="Private balances, mainnet" tone={caps.data.privacy.mainnet.enabled ? "accent" : "muted"}>
              {caps.data.privacy.mainnet.enabled ? "Enabled by operator" : (caps.data.privacy.mainnet.reason ?? "Off")}
            </Row>
            <Row label="Independent oracle">{caps.data.pyth.configured ? "Pyth (Hermes-compatible API)" : "Not configured"}</Row>
            <Row label="Mainnet RPC">{caps.data.rpc.mainnet.publicDefault ? "Public endpoint (rate limited)" : "Dedicated endpoint"}</Row>
          </dl>
        ) : (
          <p className={styles.meta}>Reading…</p>
        )}
      </section>

      <Governance />
    </ModulePanel>
  );
}

function RecoveryFlow() {
  return (
    <section className={styles.section} aria-labelledby="recovery-h">
      <h2 id="recovery-h" className={styles.h2} style={{ marginBottom: 8 }}>
        Recovery
      </h2>
      <ol className={styles.steps}>
        <li>Your private keys are derived from your wallet's signature of one fixed message. There is no separate recovery phrase to lose.</li>
        <li>On a new device, connect the same wallet and unlock. The balance and history are rebuilt from the chain through the indexer.</li>
        <li>If NOCT is unavailable, any client built on the Privacy Rings SDK can derive the same keys from the same wallet and withdraw.</li>
        <li>If you lose your wallet's keys, the private balance is lost with them, as with the wallet itself.</li>
      </ol>
      <div className="note note-warn" style={{ marginTop: 12 }}>
        <Icon name="warning" size={16} />
        <span>Only sign the derivation message here. Anyone who obtains that signature can read your private balance and history; spending still needs your wallet.</span>
      </div>
    </section>
  );
}

function Governance() {
  const network = useSettings((s) => s.network);
  const demo = useSettings((s) => s.demoMode);
  const address = useWallet((s) => s.address);
  const ready = useSettingsReady();
  const q = useQuery({
    queryKey: ["governance", network],
    queryFn: () => Promise.all(GOVERNED_PROGRAMS.map((p) => readProgramAuthority(network, p.program, p.label))),
    enabled: ready && !demo,
    staleTime: 10 * 60_000,
  });
  return (
    <section className={styles.section} aria-labelledby="gov-h">
      <div className={styles.sectionHead}>
        <h2 id="gov-h" className={styles.h2}>
          Who can change the programs
        </h2>
        <span className={styles.meta}>{network}</span>
      </div>
      <p className={styles.lead}>A program with an upgrade authority can be replaced, including the rules about who can move funds. NOCT reads this from the chain rather than trusting a claim.</p>
      {demo ? (
        <p className={styles.meta}>Not read in demo mode.</p>
      ) : q.isLoading ? (
        <p className={styles.meta}>Reading program accounts…</p>
      ) : (
        <dl>
          {(q.data ?? []).map((p) => (
            <Row key={p.program} label={p.label} tone={p.state === "upgradeable" ? "warn" : p.state === "immutable" ? "accent" : "muted"}>
              {p.state === "upgradeable"
                ? `Upgradeable by ${shortAddress(p.authority!, 4, 4)}`
                : p.state === "immutable"
                  ? "Immutable"
                  : p.state === "missing"
                    ? "Not deployed on this network"
                    : p.state === "not_upgradeable_loader"
                      ? "Not upgradeable-loader program"
                      : "Could not be read"}
            </Row>
          ))}
        </dl>
      )}
      {!address ? null : null}
    </section>
  );
}
