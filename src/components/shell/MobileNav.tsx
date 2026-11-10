"use client";

import Link from "next/link";
import { useState } from "react";
import { MODULES, type ModuleId } from "@/lib/client/modules";
import { Icon } from "@/components/ui/Icon";
import { Dialog } from "@/components/ui/primitives";
import styles from "./shell.module.css";

const PRIMARY: ModuleId[] = ["swap", "balance", "send", "earn"];

export function MobileNav({ active }: { active: ModuleId }) {
  const [more, setMore] = useState(false);
  const inMore = !PRIMARY.includes(active);
  return (
    <>
      <nav aria-label="Tools" className={`${styles.mobileNav} glass`}>
        {MODULES.filter((m) => PRIMARY.includes(m.id)).map((m) => (
          <Link key={m.id} href={m.href} className={styles.mobileItem} aria-current={active === m.id ? "page" : undefined}>
            <Icon name={m.icon} size={20} />
            <span>{m.short}</span>
          </Link>
        ))}
        <button type="button" className={styles.mobileItem} aria-haspopup="dialog" aria-expanded={more} aria-current={inMore ? "page" : undefined} onClick={() => setMore(true)}>
          <Icon name="more" size={20} />
          <span>More</span>
        </button>
      </nav>
      <Dialog open={more} onClose={() => setMore(false)} labelledBy="more-title" size="sm">
        <div className={styles.moreSheet}>
          <h2 id="more-title">More tools</h2>
          {MODULES.filter((m) => !PRIMARY.includes(m.id)).map((m) => (
            <Link key={m.id} href={m.href} className={styles.moreItem} aria-current={active === m.id ? "page" : undefined} onClick={() => setMore(false)}>
              <Icon name={m.icon} size={20} />
              {m.label}
            </Link>
          ))}
        </div>
      </Dialog>
    </>
  );
}
