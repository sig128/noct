"use client";

import { useId, useState } from "react";
import type { DisclosureProfile, Visibility } from "@/lib/privacy/model";
import { Dialog } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import styles from "./swap.module.css";
import tx from "@/components/tx/tx.module.css";

const VIS: Record<Visibility, string> = { public: "Visible", hidden: "Hidden", not_applicable: "Not involved" };

export function DisclosurePreview({ profile, detail, tone }: { profile: DisclosureProfile; detail: string; tone?: "private" | "warn" }) {
  const [open, setOpen] = useState(false);
  const isPrivate = profile.privacyClass !== "public";
  return (
    <>
      <div className={styles.disclosure} data-tone={tone ?? (isPrivate ? "private" : undefined)}>
        <span className={styles.disclosureIcon}>
          <Icon name={isPrivate ? "rosette" : "globe"} size={16} />
        </span>
        <span>
          <strong>{profile.summary}</strong>
          {detail}
        </span>
        <button type="button" className={styles.disclosureLink} onClick={() => setOpen(true)}>
          Details
        </button>
      </div>
      <DisclosureSheet profile={profile} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function DisclosureSheet({ profile, open, onClose }: { profile: DisclosureProfile; open: boolean; onClose(): void }) {
  const id = useId();
  return (
    <Dialog open={open} onClose={onClose} labelledBy={id} size="md">
      <div className={tx.sheet}>
        <div className={tx.sheetHead}>
          <h2 id={id}>What this operation reveals</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <VisibilityGrid profile={profile} />
        <section>
          <h3 className={tx.h3}>Who can read the hidden parts</h3>
          <ul className={tx.list}>
            {profile.authorizedViewers.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={tx.h3}>Services that see request metadata</h3>
          <ul className={tx.list}>
            {profile.metadataExposure.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={tx.h3}>Custody</h3>
          <p className={tx.p}>{profile.custody}</p>
        </section>
        <section>
          <h3 className={tx.h3}>Depends on</h3>
          <ul className={tx.list}>
            {profile.dependencies.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </section>
        {profile.evidence.length > 0 ? (
          <section>
            <h3 className={tx.h3}>Evidence</h3>
            <ul className={tx.list}>
              {profile.evidence.map((e) => (
                <li key={e.claim}>
                  {e.claim} <span style={{ color: "var(--text-3)" }}>Source: {e.source}, checked {e.verifiedOn}.</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

export function VisibilityGrid({ profile }: { profile: DisclosureProfile }) {
  const items: [string, Visibility][] = [
    ["Sender", profile.sender],
    ["Recipient", profile.recipient],
    ["Token", profile.asset],
    ["Amount", profile.amount],
  ];
  return (
    <dl className={tx.visGrid}>
      {items.map(([label, v]) => (
        <div key={label} data-vis={v}>
          <dt>{label}</dt>
          <dd>
            {v === "hidden" ? <Icon name="eyeOff" size={14} /> : v === "public" ? <Icon name="eye" size={14} /> : null}
            {VIS[v]}
          </dd>
        </div>
      ))}
    </dl>
  );
}
