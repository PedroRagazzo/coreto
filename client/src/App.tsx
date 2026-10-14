import { useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { AppShell } from './components/layout/AppShell';
import { clearIdentity, loadIdentity, saveIdentity, type Identity } from './lib/identity';
import { RealtimeProvider } from './state/realtime';

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());

  if (!identity) {
    return (
      <LoginScreen
        onLogin={(next) => {
          saveIdentity(next);
          setIdentity(next);
        }}
      />
    );
  }

  return (
    <RealtimeProvider
      identity={identity}
      // O servidor não reconhece mais a sessão (por exemplo, o banco foi apagado): volta para o login.
      onSessionInvalid={() => {
        clearIdentity();
        setIdentity(null);
      }}
    >
      <AppShell />
    </RealtimeProvider>
  );
}
