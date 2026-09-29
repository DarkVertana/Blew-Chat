"use client";

import { useSetting } from "@/lib/local-settings";
import { Chevron, PanelHeader, SectionLabel, SettingsRow } from "./primitives";
import { Toggle } from "./toggle";

export function PrivacySettings() {
  const [readReceipts, setReadReceipts] = useSetting("blew:read-receipts", true);

  return (
    <div className="wa-scroll flex h-full flex-col overflow-y-auto">
      <PanelHeader title="Privacy" backHref="/settings" />

      <SectionLabel>Who can see my personal info</SectionLabel>
      <SettingsRow title="Last seen and online" subtitle="Everyone" onClick={() => {}} trailing={<Chevron />} />
      <SettingsRow title="Profile photo" subtitle="My contacts" onClick={() => {}} trailing={<Chevron />} />
      <SettingsRow title="About" subtitle="Everyone" onClick={() => {}} trailing={<Chevron />} />
      <SettingsRow
        title="Read receipts"
        subtitle="If turned off, you won't send or receive read receipts."
        trailing={<Toggle checked={readReceipts} onChange={setReadReceipts} label="Read receipts" />}
      />

      <SectionLabel>Messaging</SectionLabel>
      <SettingsRow title="Groups" subtitle="Everyone" onClick={() => {}} trailing={<Chevron />} />
      <SettingsRow title="Disappearing messages" subtitle="Off" onClick={() => {}} trailing={<Chevron />} />
      <SettingsRow title="Blocked contacts" subtitle="None" onClick={() => {}} trailing={<Chevron />} />
    </div>
  );
}
