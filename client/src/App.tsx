import { useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { AppShell } from './components/layout/AppShell';
import { createIdentity, loadIdentity, type Identity } from './lib/identity';
import { RealtimeProvider } from './state/realtime';

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());

  if (!identity) return <LoginScreen onSubmit={(name) => setIdentity(createIdentity(name))} />;

  return (
    <RealtimeProvider identity={identity}>
      <AppShell />
    </RealtimeProvider>
  );
}
