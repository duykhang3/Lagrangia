import { useEffect } from 'react';
import { MainMenu } from './MainMenu';
import { useApp } from './store';
import { Workspace } from './Workspace';

export function App() {
  const current = useApp((s) => s.current);
  const lang = useApp((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return current ? <Workspace key={current} system={current} /> : <MainMenu />;
}
