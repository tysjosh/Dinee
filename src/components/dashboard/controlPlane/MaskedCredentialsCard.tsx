"use client";

/**
 * Feature: platform-control-plane (Task 7.1)
 *
 * Shared, presentational card that renders a masked view of stored credentials.
 * Only the last-4 preview of each credential is ever shown — never plaintext or
 * ciphertext (Req 6.10, 7.4, 11). The last-4 rendering is delegated verbatim to
 * the reused pure helper `formatMaskedCredential` from
 * `platformIntegrationAdmin.logic.ts`.
 *
 * This is a pure presentational component: it fetches no data and holds no
 * state. It is consumed by both the Admin_Console (Task 7.2) and the
 * Partner_Console (Task 7.3).
 *
 * Requirements: 6.10, 7.4
 */

import React from "react";
import {
  type PlatformCredentialField,
  formatMaskedCredential,
} from "../platformIntegrationAdmin.logic";

export interface MaskedCredentialsCardProps {
  /** Last-4 preview per credential name — never a full value (Req 6.10, 7.4). */
  credentialsLast4: Record<string, string>;
  /** Field descriptors used to render each credential's human label. */
  credentialFields: PlatformCredentialField[];
}

export default function MaskedCredentialsCard({
  credentialsLast4,
  credentialFields,
}: MaskedCredentialsCardProps) {
  const labelFor = (name: string) =>
    credentialFields.find((f) => f.name === name)?.label ?? name;

  const names = Object.keys(credentialsLast4);
  if (names.length === 0) return null;

  return (
    <section className="card" aria-labelledby="stored-heading">
      <div className="card-header">
        <h2 id="stored-heading" className="text-base font-semibold text-white">
          Stored credentials
        </h2>
        <p className="text-sm text-gray-400">
          Only the last 4 characters of each stored credential are shown.
        </p>
      </div>
      <div className="card-content grid grid-cols-1 sm:grid-cols-2 gap-4">
        {names.map((name) => (
          <div key={name}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              {labelFor(name)}
            </p>
            <p className="text-sm text-white mt-1 font-mono">
              {formatMaskedCredential(credentialsLast4[name])}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
