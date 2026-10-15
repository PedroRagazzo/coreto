import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyAppearance, loadSettings, saveSettings, type Settings } from '../lib/settings';

interface SettingsContextValue {
  settings: Settings;
  /** Altera uma parte das configurações; grava no aparelho e aplica na hora. */
  update(change: (current: Settings) => Settings): void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    saveSettings(settings);
    applyAppearance(settings.appearance);
  }, [settings]);

  const value = useMemo<SettingsContextValue>(() => ({ settings, update: (change) => setSettings(change) }), [settings]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings precisa estar dentro de <SettingsProvider>.');
  return value;
}
