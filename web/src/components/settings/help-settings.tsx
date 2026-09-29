import { APP_NAME } from "@/lib/app";
import { Chevron, PanelHeader, SectionLabel, SettingsRow } from "./primitives";

export function HelpSettings() {
  return (
    <div className="wa-scroll flex h-full flex-col overflow-y-auto">
      <PanelHeader title="Help" backHref="/settings" />
      <SectionLabel>Support</SectionLabel>
      <SettingsRow title="Help center" href="/settings/help" trailing={<Chevron />} />
      <SettingsRow title="Contact us" subtitle="Questions? Need help?" href="/settings/help" trailing={<Chevron />} />
      <SettingsRow title="Terms and Privacy Policy" href="/settings/help" trailing={<Chevron />} />
      <SectionLabel>About</SectionLabel>
      <SettingsRow title="App info" subtitle={`${APP_NAME} Web 0.1.0`} />
      <SettingsRow title="Notes demo" subtitle="The original API-backed notes page" href="/notes" trailing={<Chevron />} />
    </div>
  );
}
